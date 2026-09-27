import { aiEnabled, analyzePhoto, importFromUrl, parseRecipe, transcribe, voiceEnabled } from "./ai";
import { handleUpdate, type Update } from "./bot";
import { HttpError, Repo, type RecipeInput, type Settings } from "./db";
import { allowedIds, today, type Env } from "./env";
import { runReminders } from "./notify";
import { addDays, CATEGORIES, MEAL_TYPES } from "./nutrition";
import { aisleFor, AISLE_ORDER, splitProducts } from "./planner";
import { STARTER } from "./starter";
import { dayBrief, fillPlan, fromProducts, getBalance, getIdea, getSuggestions, markHave, sendShoppingList, shoppingFromPlan, swapPlan } from "./service";
import { escapeHtml, Telegram, verifyInitData } from "./telegram";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.TELEGRAM_API_BASE) Telegram.base = env.TELEGRAM_API_BASE;
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

  // Раз в час: утреннее меню и вечерние напоминания/оценки.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.TELEGRAM_API_BASE) Telegram.base = env.TELEGRAM_API_BASE;
    const origin = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app_origin'").first<string>("value");
    ctx.waitUntil(runReminders(env, new Date(controller.scheduledTime), origin ?? "").then((s) => s.length && console.log("sent", s)));
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
  if (update.update_id % 50 === 0) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM updates WHERE created_at < datetime('now', '-3 days')"),
      env.DB.prepare("DELETE FROM sent WHERE created_at < datetime('now', '-7 days')"),
    ]);
  }
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
      { command: "today", description: "🍽 Меню на сегодня" },
      { command: "week", description: "🗓 Меню на неделю" },
      { command: "shop", description: "🛒 Список покупок" },
      { command: "idea", description: "✨ Придумать блюдо" },
      { command: "menu", description: "🤔 Что приготовить сейчас" },
      { command: "balance", description: "📊 Чего не хватает в питании" },
      { command: "help", description: "❓ Как пользоваться" },
    ],
  });
  await tg.call("setChatMenuButton", { menu_button: { type: "web_app", text: "Кухня", web_app: { url: `${url.origin}/` } } });
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('app_origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(url.origin)
    .run();
  const me = await tg.call<{ username: string }>("getMe");
  return json({ ok: true, bot: `@${me.username}`, webhook: `${url.origin}/telegram/webhook`, ai: aiEnabled(env), voice: voiceEnabled(env), allowed: [...allowedIds(env)] });
}

async function authUser(request: Request, env: Env): Promise<{ id: number; first_name?: string }> {
  const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
  if (!initData && env.DEV_AUTH === "1") return { id: [...allowedIds(env)][0] ?? 0, first_name: "Тест" };
  const user = await verifyInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!user) throw new HttpError(401, "Откройте приложение из Telegram");
  if (!allowedIds(env).has(user.id)) throw new HttpError(403, `Нет доступа. Ваш Telegram ID: ${user.id}`);
  return user;
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const needAi = (env: Env) => {
  if (!aiEnabled(env)) throw new HttpError(400, "ИИ не подключён (нет ANTHROPIC_API_KEY)");
};

async function fileFromForm(request: Request, field: string, maxMb: number): Promise<File> {
  const form = await request.formData();
  const file = form.get(field);
  if (!file || typeof file === "string") throw new HttpError(400, "Файл не получен");
  if (file.size > maxMb * 1024 * 1024) throw new HttpError(413, `Файл больше ${maxMb} МБ`);
  return file;
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await authUser(request, env);
  const userId = user.id;
  const repo = new Repo(env.DB);
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;
  const body = async <T>() => (await request.json()) as T;
  const q = (k: string) => url.searchParams.get(k);
  const date = isDate(q("date")) ? q("date")! : today(env);
  let m: RegExpMatchArray | null;

  // ---------- общее ----------
  if (path === "/config" && method === "GET") {
    // Запоминаем человека, чтобы бот мог ему писать (в личке chat_id = id пользователя).
    if (!(await repo.listUsers()).some((u) => u.id === userId)) await repo.touchUser(userId, userId, user.first_name ?? "");
    const [settings, users] = await Promise.all([repo.getSettings(), repo.listUsers()]);
    return json({
      userId,
      today: today(env),
      ai: aiEnabled(env),
      voice: voiceEnabled(env),
      settings,
      me: users.find((u) => u.id === userId) ?? null,
      mealTypes: MEAL_TYPES,
      aisles: AISLE_ORDER,
      categories: CATEGORIES.map(({ keywords, ...c }) => c),
    });
  }
  if (path === "/settings" && method === "PUT") return json(await repo.updateSettings(await body<Partial<Settings>>()));
  if (path === "/me" && method === "PUT") {
    const { notify } = await body<{ notify: boolean }>();
    await repo.setUserNotify(userId, Boolean(notify));
    return json({ ok: true });
  }
  if (path === "/brief" && method === "GET") return json(await dayBrief(env, date));

  // ---------- рецепты ----------
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
    const { text, source } = await body<{ text: string; source?: string }>();
    if (!text?.trim()) throw new HttpError(400, "Пустой текст");
    needAi(env);
    return json(await parseRecipe(env, text, source === "voice" ? "voice" : "text"));
  }
  if (path === "/recipes/import" && method === "POST") {
    const { url: link } = await body<{ url: string }>();
    needAi(env);
    try {
      return json(await importFromUrl(env, String(link ?? "").trim()));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }

  // ---------- голос и фото ----------
  if (path === "/transcribe" && method === "POST") {
    if (!voiceEnabled(env)) throw new HttpError(400, "Распознавание голоса не подключено");
    const file = await fileFromForm(request, "audio", 25);
    const text = await transcribe(env, await file.arrayBuffer(), file.name || "voice.webm", file.type || "audio/webm");
    return json({ text });
  }
  if (path === "/photo" && method === "POST") {
    needAi(env);
    const file = await fileFromForm(request, "image", 10);
    const result = await analyzePhoto(env, await file.arrayBuffer(), file.type || "image/jpeg");
    if (result.kind === "recipe" && result.recipe_text.trim()) return json({ kind: "recipe", recipe: await parseRecipe(env, result.recipe_text, "photo") });
    if (result.kind === "products" && result.products.length) return json({ kind: "products", products: result.products, matches: await fromProducts(env, result.products) });
    return json({ kind: "other", comment: result.comment });
  }
  if (path === "/products" && method === "POST") {
    const { products } = await body<{ products: string[] }>();
    const list = (products ?? []).map(String).map((s) => s.trim()).filter(Boolean);
    return json({ products: list, matches: await fromProducts(env, list) });
  }

  // ---------- что ели ----------
  if (path === "/meals" && method === "GET") {
    const from = isDate(q("from")) ? q("from")! : addDays(date, -6);
    const to = isDate(q("to")) ? q("to")! : date;
    return json(await repo.listMeals(from, to));
  }
  if (path === "/meals" && method === "POST") {
    const input = await body<{ date: string; meal_type: string; recipe_id?: number; title?: string; categories?: string[]; leftovers?: boolean }>();
    const meal = await repo.addMeal(input, userId);
    // «Приготовила с запасом» — ставим это же блюдо на завтра как «доедаем».
    if (input.leftovers) await repo.setPlan({ date: addDays(meal.date, 1), meal_type: meal.meal_type, recipe_id: meal.recipe_id, title: meal.title, leftovers: true });
    return json(meal, 201);
  }
  if ((m = path.match(/^\/meals\/(\d+)$/)) && method === "DELETE") return await repo.deleteMeal(Number(m[1])), json({ ok: true });
  if ((m = path.match(/^\/meals\/(\d+)\/rate$/)) && method === "POST") {
    const { rating } = await body<{ rating: number }>();
    return json(await repo.rateMeal(Number(m[1]), Number(rating)));
  }

  // ---------- меню ----------
  if (path === "/plan" && method === "GET") {
    const from = isDate(q("from")) ? q("from")! : date;
    const to = isDate(q("to")) ? q("to")! : addDays(from, 6);
    return json(await repo.listPlan(from, to));
  }
  if (path === "/plan" && method === "PUT") return json(await repo.setPlan(await body()));
  if ((m = path.match(/^\/plan\/(\d+)$/)) && method === "DELETE") return await repo.deletePlan(Number(m[1])), json({ ok: true });
  if (path === "/plan/fill" && method === "POST") {
    const { start, days, replace } = await body<{ start?: string; days?: number; replace?: boolean }>();
    const d = Math.min(14, Math.max(1, Number(days) || 7));
    return json(await fillPlan(env, isDate(start) ? start : date, d, Boolean(replace)));
  }
  if (path === "/plan/swap" && method === "POST") {
    const { date: d, meal_type } = await body<{ date: string; meal_type: string }>();
    if (!isDate(d)) throw new HttpError(400, "Неверная дата");
    const item = await swapPlan(env, d, meal_type);
    if (!item) throw new HttpError(404, "Нет других подходящих рецептов — добавьте ещё рецептов в книгу");
    return json(item);
  }

  // ---------- покупки ----------
  if (path === "/shopping" && method === "GET") return json(await repo.listShopping());
  if (path === "/shopping" && method === "POST") {
    const { name, amount } = await body<{ name: string; amount?: string }>();
    await repo.addShopping([{ name, amount, aisle: aisleFor(name) }]);
    return json(await repo.listShopping(), 201);
  }
  if ((m = path.match(/^\/shopping\/(\d+)$/))) {
    if (method === "PATCH") return await repo.updateShopping(Number(m[1]), await body()), json({ ok: true });
    if (method === "DELETE") return await repo.deleteShopping(Number(m[1])), json({ ok: true });
  }
  if (path === "/shopping/from-plan" && method === "POST") {
    const { from, to } = await body<{ from?: string; to?: string }>();
    const f = isDate(from) ? from : date;
    return json(await shoppingFromPlan(env, f, isDate(to) ? to : addDays(f, 6)));
  }
  if (path === "/shopping/clear" && method === "POST") {
    const { what } = await body<{ what: "checked" | "all" }>();
    await repo.clearShopping(what === "all" ? "all" : "checked");
    return json({ ok: true });
  }
  if (path === "/shopping/send" && method === "POST") {
    // Отправить список в чат — себе или всей семье (мужу в магазин).
    const { to } = await body<{ to?: "me" | "family" }>().catch(() => ({ to: "me" as const }));
    try {
      return json({ sent: await sendShoppingList(env, userId, to === "family") });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }
  if (path === "/shopping/have" && method === "POST") {
    // «Что уже есть дома»: голосом/текстом — отмечаем найденное как «есть».
    const { text, products } = await body<{ text?: string; products?: string[] }>();
    const list = products?.length ? products : splitProducts(String(text ?? ""));
    if (!list.length) throw new HttpError(400, "Не поняла, какие продукты есть");
    const { matched } = await markHave(env, list);
    return json({ products: list, matched: matched.map((i) => i.name) });
  }

  // ---------- готовые рецепты для старта ----------
  if (path === "/starter" && method === "GET") {
    const have = new Set((await repo.listRecipes()).map((r) => r.title.toLowerCase()));
    return json(STARTER.map((r) => ({ key: r.key, title: r.title, meal_types: r.meal_types, minutes: r.minutes, added: have.has(r.title.toLowerCase()) })));
  }
  if (path === "/starter" && method === "POST") {
    const { keys } = await body<{ keys: string[] }>();
    const have = new Set((await repo.listRecipes()).map((r) => r.title.toLowerCase()));
    const picked = STARTER.filter((r) => keys?.includes(r.key) && !have.has(r.title.toLowerCase()));
    for (const { key, ...r } of picked) await repo.createRecipe({ ...r, source: "starter" }, userId);
    return json({ added: picked.length });
  }

  // ---------- подсказки ----------
  if (path === "/balance" && method === "GET") {
    const days = Math.min(60, Math.max(1, Number(q("days")) || 7));
    return json(await getBalance(env, days, date));
  }
  if (path === "/suggest" && method === "GET") return json(await getSuggestions(env, q("meal") || undefined, date, 8));
  if (path === "/idea" && method === "POST") {
    needAi(env);
    const { meal, wish, products } = await body<{ meal?: string; wish?: string; products?: string[] }>();
    return json(await getIdea(env, meal || undefined, wish || undefined, products?.length ? products : undefined));
  }

  return json({ error: "Not found" }, 404);
}
