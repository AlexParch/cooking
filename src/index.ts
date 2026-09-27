import { aiEnabled, parseRecipe } from "./ai";
import { handleUpdate, type Update } from "./bot";
import { HttpError, Repo, type RecipeInput } from "./db";
import { allowedIds, today, type Env } from "./env";
import { addDays, CATEGORIES, MEAL_TYPES } from "./nutrition";
import { getBalance, getIdea, getSuggestions } from "./service";
import { Telegram, verifyInitData } from "./telegram";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/telegram/webhook" && request.method === "POST") return await webhook(request, env, url.origin);
      if (url.pathname === "/setup") return await setup(env, url);
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: (e as Error).message ?? "Ошибка сервера" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function webhook(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const update = (await request.json()) as Update;
  // Telegram может прислать тот же update повторно — обрабатываем один раз.
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO updates (update_id) VALUES (?)").bind(update.update_id).run();
  if (!fresh.meta.changes) return new Response("ok");
  try {
    await handleUpdate(env, update, origin);
  } catch (e) {
    // Всегда отвечаем 200, иначе Telegram будет бесконечно повторять.
    console.error("update failed", e);
  }
  if (update.update_id % 50 === 0) await env.DB.prepare("DELETE FROM updates WHERE created_at < datetime('now', '-3 days')").run();
  return new Response("ok");
}

/** Одноразовая настройка: webhook, команды и кнопка меню. Открыть /setup?key=WEBHOOK_SECRET */
async function setup(env: Env, url: URL): Promise<Response> {
  if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  await tg.call("setWebhook", {
    url: `${url.origin}/telegram/webhook`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  await tg.call("setMyCommands", {
    commands: [
      { command: "menu", description: "Что приготовить сейчас" },
      { command: "idea", description: "Придумать новое блюдо" },
      { command: "balance", description: "Баланс питания за неделю" },
      { command: "today", description: "Что ели сегодня" },
      { command: "help", description: "Как пользоваться" },
    ],
  });
  await tg.call("setChatMenuButton", { menu_button: { type: "web_app", text: "Кухня", web_app: { url: `${url.origin}/` } } });
  const me = await tg.call<{ username: string }>("getMe");
  return json({ ok: true, bot: `@${me.username}`, webhook: `${url.origin}/telegram/webhook`, ai: aiEnabled(env), allowed: [...allowedIds(env)] });
}

async function authUser(request: Request, env: Env): Promise<number> {
  const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
  if (!initData && env.DEV_AUTH === "1") return [...allowedIds(env)][0] ?? 0;
  const user = await verifyInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!user) throw new HttpError(401, "Откройте приложение из Telegram");
  if (!allowedIds(env).has(user.id)) throw new HttpError(403, `Нет доступа. Ваш Telegram ID: ${user.id}`);
  return user.id;
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const userId = await authUser(request, env);
  const repo = new Repo(env.DB);
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;
  const body = async <T>() => (await request.json()) as T;
  const date = isDate(url.searchParams.get("date")) ? url.searchParams.get("date")! : today(env);
  let m: RegExpMatchArray | null;

  if (path === "/config" && method === "GET")
    return json({ userId, today: today(env), ai: aiEnabled(env), mealTypes: MEAL_TYPES, categories: CATEGORIES.map(({ keywords, ...c }) => c) });

  if (path === "/recipes" && method === "GET") return json(await repo.listRecipes());
  if (path === "/recipes" && method === "POST") return json(await repo.createRecipe(await body<RecipeInput>(), userId), 201);
  if ((m = path.match(/^\/recipes\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === "GET") {
      const r = await repo.getRecipe(id);
      return r ? json(r) : json({ error: "Не найдено" }, 404);
    }
    if (method === "PUT") return json(await repo.updateRecipe(id, await body<RecipeInput>()));
    if (method === "DELETE") return await repo.deleteRecipe(id), json({ ok: true });
  }
  if (path === "/recipes/parse" && method === "POST") {
    const { text } = await body<{ text: string }>();
    if (!text?.trim()) throw new HttpError(400, "Пустой текст");
    if (!aiEnabled(env)) throw new HttpError(400, "ИИ не подключён (нет ANTHROPIC_API_KEY)");
    return json(await parseRecipe(env, text, "text"));
  }

  if (path === "/meals" && method === "GET") {
    const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : addDays(date, -6);
    const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : date;
    return json(await repo.listMeals(from, to));
  }
  if (path === "/meals" && method === "POST") return json(await repo.addMeal(await body(), userId), 201);
  if ((m = path.match(/^\/meals\/(\d+)$/)) && method === "DELETE") return await repo.deleteMeal(Number(m[1])), json({ ok: true });

  if (path === "/balance" && method === "GET") {
    const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days")) || 7));
    return json(await getBalance(env, days, date));
  }
  if (path === "/suggest" && method === "GET") return json(await getSuggestions(env, url.searchParams.get("meal") ?? undefined, date, 8));
  if (path === "/idea" && method === "POST") {
    if (!aiEnabled(env)) throw new HttpError(400, "ИИ не подключён (нет ANTHROPIC_API_KEY)");
    const { meal, wish } = await body<{ meal?: string; wish?: string }>();
    return json(await getIdea(env, meal || undefined, wish || undefined));
  }

  return json({ error: "Not found" }, 404);
}
