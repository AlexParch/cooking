import { aiEnabled, parseRecipe, transcribe } from "./ai";
import { Repo, type Recipe, type RecipeInput } from "./db";
import { allowedIds, currentMeal, today, type Env } from "./env";
import { balanceSummary, categoryByKey, MEAL_TYPES, type MealType } from "./nutrition";
import { getBalance, getIdea, getSuggestions } from "./service";
import { escapeHtml as h, Telegram } from "./telegram";

interface Message {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; duration: number };
}
interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: Message;
  data?: string;
}
export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

const HELP = `Я помогаю вести семейную книгу ПП-рецептов и следить за разнообразием.

🎙 <b>Пришлите голосовое</b> с рецептом — я его расшифрую, оформлю и сохраню.
📝 Или пришлите рецепт текстом.

/menu — что приготовить сейчас (из ваших рецептов)
/idea — придумать новое блюдо под то, чего не хватает (можно с пожеланием: <code>/idea на ужин с кабачком</code>)
/balance — что ели за неделю, чего не хватает
/today — что уже отмечено сегодня

Всё остальное — в приложении (кнопка «Меню» слева от поля ввода).`;

function appUrl(origin: string, params: Record<string, string> = {}) {
  const u = new URL("/", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export function formatRecipe(r: RecipeInput & { id?: number }): string {
  const lines = [`<b>${h(r.title)}</b>`];
  const meta = [
    (r.meal_types ?? []).map((m) => MEAL_TYPES[m as MealType]).filter(Boolean).join(", "),
    r.minutes ? `⏱ ${r.minutes} мин` : "",
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  const cats = (r.categories ?? []).map((k) => categoryByKey(k)).filter(Boolean);
  if (cats.length) lines.push(cats.map((c) => `${c!.emoji} ${c!.name}`).join(", "));
  if (r.ingredients?.length) {
    lines.push("", "<b>Ингредиенты:</b>");
    for (const i of r.ingredients) lines.push(`• ${h(i.name)}${i.amount ? ` — ${h(i.amount)}` : ""}`);
  }
  if (r.steps?.length) {
    lines.push("", "<b>Приготовление:</b>");
    r.steps.forEach((s, n) => lines.push(`${n + 1}. ${h(s)}`));
  }
  if (r.notes) lines.push("", `💡 ${h(r.notes)}`);
  if (r.warnings?.length) lines.push("", ...r.warnings.map((w) => `⚠️ ${h(w)}`));
  const text = lines.join("\n");
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

export async function handleUpdate(env: Env, update: Update, origin: string): Promise<void> {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  const repo = new Repo(env.DB);
  const fromId = update.message?.from?.id ?? update.callback_query?.from.id;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!fromId || !chatId) return;

  if (!allowedIds(env).has(fromId)) {
    if (update.message)
      await tg.send(chatId, `Это семейный бот, доступ закрыт.\nВаш Telegram ID: <code>${fromId}</code> — добавьте его в ALLOWED_USER_IDS, если это вы.`);
    return;
  }

  if (update.callback_query) return handleCallback(env, tg, repo, update.callback_query, origin);

  const msg = update.message!;
  const isPrivate = msg.chat.type === "private";
  const openApp = (params: Record<string, string> = {}, text = "📱 Открыть приложение") =>
    // Кнопка web_app работает только в личке; в группах даём обычную ссылку.
    isPrivate ? { text, web_app: { url: appUrl(origin, params) } } : { text, url: appUrl(origin, params) };

  const saveAndReply = async (input: RecipeInput, progressId: number) => {
    const recipe = await repo.createRecipe(input, fromId);
    await tg.edit(chatId, progressId, `✅ Сохранила рецепт\n\n${formatRecipe(recipe)}`, {
      reply_markup: { inline_keyboard: [[openApp({ recipe: String(recipe.id) }, "✏️ Открыть / поправить")], [{ text: "🗑 Удалить", callback_data: `del:${recipe.id}` }]] },
    });
  };

  // Голосовое сообщение с рецептом
  const voice = msg.voice ?? msg.audio;
  if (voice) {
    const progress = await tg.send(chatId, "🎙 Слушаю…");
    try {
      const text = await transcribe(env, await tg.downloadFile(voice.file_id));
      if (!text) return void (await tg.edit(chatId, progress.message_id, "Не расслышала, попробуйте ещё раз 🙏"));
      if (!aiEnabled(env)) {
        return saveAndReply({ title: text.split(/[.!?\n]/)[0].slice(0, 60) || "Рецепт", notes: text, source: "voice" }, progress.message_id);
      }
      await tg.edit(chatId, progress.message_id, `📝 Расшифровала, оформляю рецепт…\n\n<i>${h(text.slice(0, 1500))}</i>`);
      await saveAndReply(await parseRecipe(env, text, "voice"), progress.message_id);
    } catch (e) {
      await tg.edit(chatId, progress.message_id, `Не получилось: ${h(String((e as Error).message ?? e))}`);
    }
    return;
  }

  const text = (msg.text ?? msg.caption ?? "").trim();
  if (!text) return;
  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  const cmd = command.startsWith("/") ? command.slice(1).split("@")[0].toLowerCase() : "";

  switch (cmd) {
    case "start":
    case "help":
      await tg.send(chatId, HELP, { reply_markup: { inline_keyboard: [[openApp()]] } });
      return;

    case "menu":
    case "suggest": {
      const meal = (Object.keys(MEAL_TYPES) as MealType[]).find((k) => arg.toLowerCase().includes(MEAL_TYPES[k].toLowerCase().slice(0, 4))) ?? currentMeal(env);
      const list = await getSuggestions(env, meal);
      if (list.length === 0) {
        await tg.send(chatId, "В книге пока нет рецептов. Пришлите голосовое с рецептом или попросите /idea 🙂");
        return;
      }
      const lines = [`<b>${MEAL_TYPES[meal]}: что приготовить</b>`, ""];
      list.forEach((s, i) => lines.push(`${i + 1}. <b>${h(s.recipe.title)}</b>${s.reasons.length ? `\n   <i>${h(s.reasons.slice(0, 2).join("; "))}</i>` : ""}`));
      await tg.send(chatId, lines.join("\n"), {
        reply_markup: {
          inline_keyboard: [
            ...list.map((s) => [{ text: `✅ Едим: ${s.recipe.title}`.slice(0, 60), callback_data: `ate:${s.recipe.id}:${meal}` }]),
            [{ text: "✨ Придумать новое", callback_data: `idea:${meal}` }],
          ],
        },
      });
      return;
    }

    case "idea":
      await sendIdea(env, tg, repo, chatId, undefined, arg);
      return;

    case "balance":
    case "week": {
      const balance = await getBalance(env, 7);
      const s = balanceSummary(balance);
      const lines = ["<b>Последние 7 дней</b>", ""];
      for (const b of balance) {
        const mark = b.status === "ok" ? "✅" : b.status === "low" ? "🟡" : "❌";
        lines.push(`${mark} ${b.emoji} ${b.name}: ${b.count}/${b.target}${b.status === "missing" && b.daysSince != null ? ` (было ${b.daysSince} дн. назад)` : ""}`);
      }
      if (s.missing.length || s.low.length) {
        lines.push("", "<b>Что можно добавить:</b>");
        for (const b of balance.filter((b) => b.status !== "ok").slice(0, 5)) lines.push(`${b.emoji} ${b.ideas.slice(0, 2).join(", ")}`);
      }
      await tg.send(chatId, lines.join("\n"), { reply_markup: { inline_keyboard: [[openApp({ tab: "balance" }, "📊 Подробнее")]] } });
      return;
    }

    case "today": {
      const date = today(env);
      const meals = await repo.listMeals(date, date);
      const lines = ["<b>Сегодня</b>", ""];
      for (const [k, name] of Object.entries(MEAL_TYPES)) {
        const items = meals.filter((m) => m.meal_type === k).map((m) => h(m.title));
        lines.push(`${name}: ${items.length ? items.join(", ") : "—"}`);
      }
      await tg.send(chatId, lines.join("\n"), { reply_markup: { inline_keyboard: [[openApp({ tab: "today" }, "✏️ Отметить")]] } });
      return;
    }
  }

  if (cmd) {
    await tg.send(chatId, HELP);
    return;
  }

  // Обычный текст: длинный — это рецепт, короткий — подсказываем.
  if (text.length >= 80 || text.includes("\n")) {
    const progress = await tg.send(chatId, "📝 Оформляю рецепт…");
    try {
      const input = aiEnabled(env) ? await parseRecipe(env, text, "text") : { title: text.split("\n")[0].slice(0, 80), notes: text, source: "text" };
      await saveAndReply(input, progress.message_id);
    } catch (e) {
      await tg.edit(chatId, progress.message_id, `Не получилось: ${h(String((e as Error).message ?? e))}`);
    }
    return;
  }
  await tg.send(chatId, "Чтобы сохранить рецепт — пришлите голосовое или подробный текст. Что приготовить — /menu, новая идея — /idea.");
}

async function sendIdea(env: Env, tg: Telegram, repo: Repo, chatId: number, mealType?: string, wish?: string) {
  if (!aiEnabled(env)) {
    await tg.send(chatId, "Для идей нужен ключ Claude API (ANTHROPIC_API_KEY). Пока могу подсказать из ваших рецептов: /menu");
    return;
  }
  const progress = await tg.send(chatId, "✨ Думаю, что приготовить…");
  try {
    const idea = await getIdea(env, mealType, wish);
    const draftId = await repo.saveDraft(idea);
    await tg.edit(chatId, progress.message_id, formatRecipe(idea), {
      reply_markup: {
        inline_keyboard: [[{ text: "💾 Сохранить в книгу", callback_data: `save:${draftId}` }], [{ text: "🔄 Другой вариант", callback_data: `idea:${mealType ?? ""}` }]],
      },
    });
  } catch (e) {
    await tg.edit(chatId, progress.message_id, `Не получилось: ${h(String((e as Error).message ?? e))}`);
  }
}

async function handleCallback(env: Env, tg: Telegram, repo: Repo, q: CallbackQuery, _origin: string) {
  const chatId = q.message!.chat.id;
  const [action, a, b] = (q.data ?? "").split(":");
  const answer = (text?: string) => tg.call("answerCallbackQuery", { callback_query_id: q.id, text });

  switch (action) {
    case "ate": {
      const meal = await repo.addMeal({ date: today(env), meal_type: b, recipe_id: Number(a) }, q.from.id);
      await answer(`Отметила: ${MEAL_TYPES[b as MealType]} — ${meal.title}`);
      await tg.send(chatId, `✅ ${MEAL_TYPES[b as MealType]}: <b>${h(meal.title)}</b> — отмечено. Приятного аппетита!`);
      return;
    }
    case "save": {
      const draft = await repo.takeDraft<RecipeInput>(Number(a));
      if (!draft) return void (await answer("Черновик уже сохранён или устарел"));
      const recipe: Recipe = await repo.createRecipe(draft, q.from.id);
      await answer("Сохранено!");
      await tg.call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: q.message!.message_id,
        reply_markup: { inline_keyboard: [[{ text: `✅ Сохранено (№${recipe.id})`, callback_data: "noop" }]] },
      });
      return;
    }
    case "del": {
      await repo.deleteRecipe(Number(a));
      await answer("Удалено");
      await tg.call("editMessageReplyMarkup", { chat_id: chatId, message_id: q.message!.message_id, reply_markup: { inline_keyboard: [] } });
      await tg.send(chatId, "🗑 Рецепт удалён.");
      return;
    }
    case "idea":
      await answer();
      await sendIdea(env, tg, repo, chatId, a || undefined);
      return;
    default:
      await answer();
  }
}
