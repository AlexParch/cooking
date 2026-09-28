import { aiEnabled, analyzePhoto, importFromUrl, parseRecipe, transcribe, voiceEnabled } from "./ai";
import { Repo, type Member, type PlanItem, type Recipe, type RecipeInput } from "./db";
import { allowedIds, currentMeal, today, type Env } from "./env";
import { addDays, balanceSummary, categoryByKey, MEAL_TYPES, type MealType } from "./nutrition";
import { AISLE_ORDER, splitProducts } from "./planner";
import { dayBrief, fillPlan, fromProducts, getBalance, getIdea, getSuggestions, markHave, mealName, sendShoppingList, shoppingFromPlan, shoppingText } from "./service";
import { escapeHtml as h, Telegram } from "./telegram";

interface PhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}
interface Message {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  audio?: { file_id: string; duration: number; mime_type?: string; file_name?: string };
  video_note?: { file_id: string; duration: number };
  photo?: PhotoSize[];
  document?: { file_id: string; mime_type?: string; file_name?: string };
}
interface CallbackQuery {
  id: string;
  from: { id: number; first_name?: string };
  message?: Message;
  data?: string;
}
export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };

const HELP = `Я помогаю готовить: храню ваши рецепты, составляю меню на неделю и список покупок, слежу, чтобы питание было разнообразным.

<b>Что можно мне прислать:</b>
🎙 <b>Голосовое</b> с рецептом — расшифрую, оформлю и сохраню
📝 <b>Текст</b> рецепта — тоже сохраню
🔗 <b>Ссылку</b> на рецепт с сайта — перепишу под ПП (без глютена и сахара)
📷 <b>Фото</b> страницы из книги — сохраню рецепт
📷 <b>Фото продуктов</b> или холодильника — подскажу, что из них приготовить

<b>Команды</b> (кнопка «Меню» внизу слева):
/today — меню на сегодня
/week — меню на неделю
/shop — список покупок
/idea — придумать новое блюдо
/balance — чего не хватает в питании

Удобнее всего — в приложении: кнопка <b>«Кухня»</b> слева от поля ввода.`;

function appUrl(origin: string, params: Record<string, string> = {}) {
  const u = new URL("/", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const errText = (e: unknown) => `😔 Не получилось: ${h(String((e as Error)?.message ?? e))}`;

export function formatRecipe(r: RecipeInput & { id?: number }): string {
  const lines = [`<b>${h(r.title)}</b>`];
  const meta = [
    (r.meal_types ?? []).map((m) => MEAL_TYPES[m as MealType]).filter(Boolean).join(", "),
    r.minutes ? `⏱ ${r.minutes} мин` : "",
    r.servings ? `🍽 на ${r.servings} порц.` : "",
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  const cats = (r.categories ?? []).map((k) => categoryByKey(k)).filter(Boolean);
  if (cats.length) lines.push(cats.map((c) => `${c!.emoji} ${c!.name}`).join(", "));
  if (r.prep_ahead) lines.push("", `⏰ <b>Заранее:</b> ${h(r.prep_ahead)}${r.prep_hours ? ` (за ${r.prep_hours} ч)` : ""}`);
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

/** «Котлеты <i>(Маша, Миша)</i>» — если блюдо не для всей семьи. */
function planDish(p: PlanItem, members: Member[]): string {
  const who = p.eaters ? members.filter((m) => p.eaters!.includes(m.id)).map((m) => m.name) : [];
  return `${h(p.title)}${p.leftovers ? " <i>(доедаем)</i>" : ""}${who.length ? ` <i>— ${h(who.join(", "))}</i>` : ""}`;
}

/** Блюда приёма пищи: одно — в строку, разные для членов семьи — каждое с новой строки. */
function planDishes(items: PlanItem[], members: Member[]): string {
  return items.length > 1 ? items.map((p) => `\n   • ${planDish(p, members)}`).join("") : planDish(items[0], members);
}

/** Текст «меню на день» для утреннего сообщения и /today. */
export function formatDay(brief: Awaited<ReturnType<typeof dayBrief>>, eaten: { meal_type: string; title: string }[] = []): string {
  const lines: string[] = [];
  for (const k of Object.keys(MEAL_TYPES)) {
    const items = brief.plan.filter((x) => x.meal_type === k);
    const done = eaten.filter((m) => m.meal_type === k).map((m) => m.title);
    const what = done.length ? `✅ ${done.map(h).join(", ")}` : items.length ? planDishes(items, brief.members) : "<i>не выбрано</i>";
    lines.push(`<b>${mealName(k)}:</b> ${what}`);
  }
  if (brief.prepToday.length) {
    lines.push("", "⏰ <b>Не забудьте сегодня:</b>");
    for (const p of brief.prepToday) lines.push(`• ${h(p.prep)} — для «${h(p.title)}»`);
  }
  if (brief.prepTomorrow.length) {
    lines.push("", "🌙 <b>С вечера, на завтра:</b>");
    for (const p of brief.prepTomorrow) lines.push(`• ${h(p.prep)} — для «${h(p.title)}» (${mealName(p.meal_type).toLowerCase()})`);
  }
  return lines.join("\n");
}

export async function handleUpdate(env: Env, update: Update, origin: string): Promise<void> {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  const repo = new Repo(env.DB);
  const from = update.message?.from ?? update.callback_query?.from;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!from || !chatId) return;

  if (!allowedIds(env).has(from.id)) {
    if (update.message)
      await tg.send(chatId, `Это семейный бот, доступ закрыт.\nВаш Telegram ID: <code>${from.id}</code> — добавьте его в ALLOWED_USER_IDS, если это вы.`);
    return;
  }
  const isPrivate = (update.message ?? update.callback_query?.message)?.chat.type === "private";
  if (isPrivate) await repo.touchUser(from.id, chatId, from.first_name ?? "");

  const openApp = (params: Record<string, string> = {}, text = "📱 Открыть приложение"): Button =>
    // Кнопка web_app работает только в личке; в группах даём обычную ссылку.
    isPrivate ? { text, web_app: { url: appUrl(origin, params) } } : { text, url: appUrl(origin, params) };

  const ctx: Ctx = { env, tg, repo, chatId, userId: from.id, origin, openApp };
  if (update.callback_query) return handleCallback(ctx, update.callback_query);
  const msg = update.message!;

  // Бот ждёт список «что есть дома»?
  const chatState = isPrivate ? await repo.getChatState(from.id) : null;

  // 🎙 Голосовое / аудио / кружок
  const audio = msg.voice ?? msg.audio ?? msg.video_note;
  if (audio) {
    const filename = msg.audio?.file_name ?? (msg.video_note ? "note.mp4" : "voice.ogg");
    const mime = msg.audio?.mime_type ?? (msg.video_note ? "video/mp4" : "audio/ogg");
    if (chatState === "have") return handleHaveVoice(ctx, audio.file_id, filename, mime);
    return handleVoice(ctx, audio.file_id, filename, mime);
  }

  // 📷 Фото (или картинка файлом)
  const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  const imageDoc = msg.document?.mime_type?.startsWith("image/") ? msg.document : null;
  if (photo || imageDoc) return handlePhoto(ctx, (photo ?? imageDoc)!.file_id, imageDoc?.mime_type ?? "image/jpeg", msg.caption ?? "");

  const text = (msg.text ?? msg.caption ?? "").trim();
  if (!text) return;
  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  const cmd = command.startsWith("/") ? command.slice(1).split("@")[0].toLowerCase() : "";
  if (cmd && chatState) await repo.setChatState(from.id, null);
  if (!cmd && chatState === "have" && !/https?:\/\//.test(text)) return handleHave(ctx, text);

  switch (cmd) {
    case "start": {
      const settings = await repo.getSettings();
      if (!settings.setup_done) {
        await tg.send(chatId, WELCOME(from.first_name), { reply_markup: { inline_keyboard: [[openApp({}, "🚀 Начать настройку")]] } });
        return;
      }
      await tg.send(chatId, HELP, { reply_markup: { inline_keyboard: [[openApp()]] } });
      return;
    }
    case "help":
      await tg.send(chatId, HELP, { reply_markup: { inline_keyboard: [[openApp()]] } });
      return;
    case "today":
      return sendToday(ctx);
    case "menu":
    case "suggest":
      return sendSuggestions(ctx, arg);
    case "week":
    case "plan":
      return sendWeek(ctx);
    case "shop":
    case "shopping":
      return sendShopping(ctx);
    case "idea":
      return sendIdea(ctx, undefined, arg);
    case "balance":
      return sendBalance(ctx);
  }
  if (cmd) {
    await tg.send(chatId, HELP);
    return;
  }

  // 🔗 Ссылка на рецепт
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (url) return handleLink(ctx, url);

  // 📝 Длинный текст — это рецепт
  if (text.length >= 80 || text.includes("\n")) {
    const progress = await tg.send(chatId, "📝 Оформляю рецепт…");
    try {
      const input = aiEnabled(env) ? await parseRecipe(env, text, "text") : { title: text.split("\n")[0].slice(0, 80), notes: text, source: "text" };
      await saveAndReply(ctx, input, progress.message_id);
    } catch (e) {
      await tg.edit(chatId, progress.message_id, errText(e));
    }
    return;
  }

  await tg.send(
    chatId,
    "Я не совсем поняла 🙂\n\nЧтобы <b>сохранить рецепт</b> — пришлите голосовое, подробный текст, ссылку или фото.\nЧтобы <b>выбрать, что готовить</b> — нажмите кнопку ниже.",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍽 Что готовим сегодня", callback_data: "today" }],
          [{ text: "✨ Придумай блюдо", callback_data: "idea:" }],
          [openApp()],
        ],
      },
    },
  );
}

interface Ctx {
  env: Env;
  tg: Telegram;
  repo: Repo;
  chatId: number;
  userId: number;
  origin: string;
  openApp: (params?: Record<string, string>, text?: string) => Button;
}

async function saveAndReply(ctx: Ctx, input: RecipeInput, progressId: number) {
  const recipe = await ctx.repo.createRecipe(input, ctx.userId);
  await ctx.tg.edit(ctx.chatId, progressId, `✅ Сохранила рецепт в книгу\n\n${formatRecipe(recipe)}`, {
    reply_markup: {
      inline_keyboard: [[ctx.openApp({ recipe: String(recipe.id) }, "✏️ Открыть / поправить")], [{ text: "🗑 Удалить", callback_data: `del:${recipe.id}` }]],
    },
  });
  // Пока идёт первая настройка — подсказываем, сколько ещё добавить.
  const settings = await ctx.repo.getSettings();
  if (!settings.setup_done) {
    const count = (await ctx.repo.listRecipes()).length;
    if (count < 5)
      await ctx.tg.send(ctx.chatId, `📖 В книге уже ${count} ${plural(count, "рецепт", "рецепта", "рецептов")}. Надиктуйте ещё ${5 - count} — и я составлю меню на неделю.`);
    else
      await ctx.tg.send(ctx.chatId, `📖 Уже ${count} ${plural(count, "рецепт", "рецепта", "рецептов")} — можно составлять меню! Добавляйте ещё или нажмите кнопку.`, {
        reply_markup: { inline_keyboard: [[ctx.openApp({ setup: "plan" }, "🗓 Составить первое меню")]] },
      });
  }
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

const WELCOME = (name?: string) => `Привет${name ? `, ${h(name)}` : ""}! 👋 Я помогу с готовкой: буду хранить ваши рецепты, составлять меню на неделю и список покупок.

<b>Давайте настроимся — это минут 10:</b>

1️⃣ <b>Надиктуйте свои рецепты.</b> Прямо сюда голосовыми, по одному блюду: как называется, что кладёте и как готовите. Лучше 5–10 блюд, которые вы часто готовите: завтраки, обеды, полдники, ужины.
2️⃣ Я <b>составлю меню</b> на неделю.
3️⃣ Вы <b>отметите, что уже есть дома</b>, — а я соберу список того, что докупить.

Удобнее всего по шагам в приложении 👇 Но можно начать прямо сейчас — просто отправьте голосовое с первым рецептом 🎙`;

// ---------- «что уже есть дома» ----------

async function handleHaveVoice(ctx: Ctx, fileId: string, filename: string, mime: string) {
  const { env, tg, chatId } = ctx;
  if (!voiceEnabled(env)) return void (await tg.send(chatId, "Распознавание голоса не подключено — напишите текстом, пожалуйста."));
  const progress = await tg.send(chatId, "🎙 Слушаю…");
  try {
    const text = await transcribe(env, await tg.downloadFile(fileId), filename, mime);
    await tg.edit(chatId, progress.message_id, `🎙 <i>${h(text || "…")}</i>`);
    if (text) await handleHave(ctx, text);
  } catch (e) {
    await tg.edit(chatId, progress.message_id, errText(e));
  }
}

async function handleHave(ctx: Ctx, text: string) {
  const { env, tg, chatId } = ctx;
  const products = splitProducts(text);
  const { matched, left } = await markHave(env, products);
  const lines = [];
  if (matched.length) lines.push(`✅ Отметила, что есть дома: ${h(matched.map((i) => i.name.toLowerCase()).join(", "))}`);
  else lines.push(`🤔 Не нашла в списке: ${h(products.join(", "))}`);
  lines.push("");
  lines.push(left.length ? shoppingText(left, `🛒 <b>Осталось купить (${left.length}):</b>`) : "🎉 Всё есть — ничего покупать не нужно!");
  if (left.length) lines.push("", "Что-то ещё есть? Напишите или скажите. Если всё — нажмите «Готово».");
  await tg.send(chatId, lines.join("\n").slice(0, 4000), {
    reply_markup: {
      inline_keyboard: left.length
        ? [[{ text: "✅ Готово", callback_data: "have:done" }], [{ text: "📤 Отправить список всей семье", callback_data: "shop:family" }]]
        : [[{ text: "👍 Отлично", callback_data: "have:done" }]],
    },
  });
}

async function handleVoice(ctx: Ctx, fileId: string, filename: string, mime: string) {
  const { env, tg, chatId } = ctx;
  if (!voiceEnabled(env)) return void (await tg.send(chatId, "Распознавание голоса не подключено (нужен OPENAI_API_KEY)."));
  const progress = await tg.send(chatId, "🎙 Слушаю…");
  try {
    const text = await transcribe(env, await tg.downloadFile(fileId), filename, mime);
    if (!text) return void (await tg.edit(chatId, progress.message_id, "Не расслышала, попробуйте ещё раз 🙏"));
    if (!aiEnabled(env)) {
      return saveAndReply(ctx, { title: text.split(/[.!?\n]/)[0].slice(0, 60) || "Рецепт", notes: text, source: "voice" }, progress.message_id);
    }
    await tg.edit(chatId, progress.message_id, `📝 Расшифровала, оформляю рецепт…\n\n<i>${h(text.slice(0, 1500))}</i>`);
    await saveAndReply(ctx, await parseRecipe(env, text, "voice"), progress.message_id);
  } catch (e) {
    await tg.edit(chatId, progress.message_id, errText(e));
  }
}

async function handlePhoto(ctx: Ctx, fileId: string, mime: string, caption: string) {
  const { env, tg, chatId, repo } = ctx;
  if (!aiEnabled(env)) return void (await tg.send(chatId, "Чтобы разбирать фото, нужен ключ ИИ (ANTHROPIC_API_KEY или OPENAI_API_KEY)."));
  const progress = await tg.send(chatId, "📷 Смотрю фото…");
  try {
    const result = await analyzePhoto(env, await tg.downloadFile(fileId), mime, caption);
    if (result.kind === "recipe" && result.recipe_text.trim()) {
      await tg.edit(chatId, progress.message_id, "📖 Вижу рецепт, переписываю…");
      return saveAndReply(ctx, await parseRecipe(env, result.recipe_text, "photo"), progress.message_id);
    }
    if (result.kind === "products" && result.products.length) {
      const matches = await fromProducts(env, result.products);
      const draftId = await repo.saveDraft({ products: result.products });
      const lines = [`🧺 <b>Вижу:</b> ${h(result.products.join(", "))}`, ""];
      if (matches.length) {
        lines.push("<b>Можно приготовить из ваших рецептов:</b>");
        matches.forEach((m, i) =>
          lines.push(`${i + 1}. <b>${h(m.recipe.title)}</b>${m.missing.length ? `\n   <i>докупить: ${h(m.missing.slice(0, 4).join(", "))}</i>` : "\n   <i>всё есть!</i>"}`),
        );
      } else lines.push("В книге пока нет подходящих рецептов — давайте я придумаю новый 👇");
      await tg.edit(chatId, progress.message_id, lines.join("\n"), {
        reply_markup: {
          inline_keyboard: [
            ...matches.slice(0, 3).map((m) => [ctx.openApp({ recipe: String(m.recipe.id) }, `📖 ${m.recipe.title}`.slice(0, 60))]),
            [{ text: "✨ Придумай новое блюдо из этого", callback_data: `prod:${draftId}` }],
          ],
        },
      });
      return;
    }
    await tg.edit(chatId, progress.message_id, `${h(result.comment || "Не нашла на фото ни рецепта, ни продуктов.")}\n\nПришлите фото страницы с рецептом или продуктов — подскажу, что приготовить.`);
  } catch (e) {
    await tg.edit(chatId, progress.message_id, errText(e));
  }
}

async function handleLink(ctx: Ctx, url: string) {
  const { env, tg, chatId } = ctx;
  if (!aiEnabled(env)) return void (await tg.send(chatId, "Чтобы разбирать ссылки, нужен ключ ИИ (ANTHROPIC_API_KEY или OPENAI_API_KEY)."));
  const progress = await tg.send(chatId, "🔗 Открываю страницу и переписываю рецепт под ПП…");
  try {
    await saveAndReply(ctx, await importFromUrl(env, url), progress.message_id);
  } catch (e) {
    await tg.edit(chatId, progress.message_id, errText(e));
  }
}

async function sendToday(ctx: Ctx) {
  const { env, tg, chatId, repo } = ctx;
  const date = today(env);
  const [brief, eaten] = await Promise.all([dayBrief(env, date), repo.listMeals(date, date)]);
  const buttons: Button[][] = [];
  const now = currentMeal(env);
  // Кнопка на каждое блюдо: если у членов семьи разные блюда, отметится, что ели именно они.
  if (!eaten.some((m) => m.meal_type === now))
    for (const p of brief.plan.filter((x) => x.meal_type === now && x.recipe_id))
      buttons.push([{ text: `✅ ${mealName(now)} съели: ${p.title}`.slice(0, 60), callback_data: `ateplan:${p.id}` }]);
  if (!brief.plan.length) buttons.push([{ text: "🗓 Составить меню на неделю", callback_data: "plan:week" }]);
  buttons.push([ctx.openApp({}, "📱 Открыть «Сегодня»")]);
  await tg.send(chatId, `<b>🍽 Сегодня</b>\n\n${formatDay(brief, eaten)}`, { reply_markup: { inline_keyboard: buttons } });
}

async function sendSuggestions(ctx: Ctx, arg = "") {
  const { env, tg, chatId } = ctx;
  const meal = (Object.keys(MEAL_TYPES) as MealType[]).find((k) => arg.toLowerCase().includes(MEAL_TYPES[k].toLowerCase().slice(0, 4))) ?? currentMeal(env);
  const list = await getSuggestions(env, meal);
  if (list.length === 0) {
    await tg.send(chatId, "В книге пока нет рецептов. Пришлите голосовое с рецептом или нажмите /idea 🙂");
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
}

async function sendWeek(ctx: Ctx, fill = false) {
  const { env, tg, chatId, repo } = ctx;
  const start = today(env);
  const [plan, members] = await Promise.all([fill ? fillPlan(env, start, 7) : repo.listPlan(start, addDays(start, 6)), repo.listMembers()]);
  if (!plan.length) {
    await tg.send(chatId, "Меню на неделю ещё нет. Составить? Я подберу блюда из ваших рецептов так, чтобы всё было разнообразно.", {
      reply_markup: { inline_keyboard: [[{ text: "🗓 Да, составь меню", callback_data: "plan:week" }]] },
    });
    return;
  }
  const lines = ["<b>🗓 Меню на неделю</b>"];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const day = plan.filter((p) => p.date === d);
    if (!day.length) continue;
    const label = new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    lines.push("", `<b>${i === 0 ? "Сегодня" : i === 1 ? "Завтра" : label}</b>`);
    for (const k of Object.keys(MEAL_TYPES)) {
      const items = day.filter((x) => x.meal_type === k);
      if (items.length) lines.push(`${mealName(k)}: ${planDishes(items, members)}`);
    }
  }
  await tg.send(chatId, lines.join("\n").slice(0, 4000), {
    reply_markup: {
      inline_keyboard: [[{ text: "🛒 Собрать список покупок", callback_data: "shop:plan" }], [ctx.openApp({ tab: "week" }, "✏️ Изменить меню")]],
    },
  });
}

async function sendShopping(ctx: Ctx) {
  const { tg, chatId, repo } = ctx;
  const items = (await repo.listShopping()).filter((i) => !i.checked);
  if (!items.length) {
    await tg.send(chatId, "Список покупок пуст 🎉", {
      reply_markup: { inline_keyboard: [[{ text: "🛒 Собрать из меню на неделю", callback_data: "shop:plan" }]] },
    });
    return;
  }
  const lines = ["<b>🛒 Список покупок</b>"];
  for (const aisle of AISLE_ORDER) {
    const group = items.filter((i) => i.aisle === aisle);
    if (!group.length) continue;
    lines.push("", `<b>${aisle}</b>`);
    for (const i of group) lines.push(`▫️ ${h(i.name)}${i.amount ? ` — ${h(i.amount)}` : ""}`);
  }
  await tg.send(chatId, lines.join("\n").slice(0, 4000), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🏠 Что-то уже есть дома? Отметить", callback_data: "have:start" }],
        [{ text: "📤 Отправить всей семье", callback_data: "shop:family" }],
        [ctx.openApp({ tab: "shop" }, "✅ Отмечать купленное")],
      ],
    },
  });
}

async function sendBalance(ctx: Ctx) {
  const { env, tg, chatId } = ctx;
  const balance = await getBalance(env, 7);
  const s = balanceSummary(balance);
  const lines = ["<b>📊 Последние 7 дней</b>", ""];
  for (const b of balance) {
    const mark = b.status === "ok" ? "✅" : b.status === "low" ? "🟡" : "❌";
    lines.push(`${mark} ${b.emoji} ${b.name}: ${b.count} из ${b.target}`);
  }
  if (s.missing.length || s.low.length) {
    lines.push("", "<b>Что можно добавить:</b>");
    for (const b of balance.filter((b) => b.status !== "ok").slice(0, 5)) lines.push(`${b.emoji} ${b.ideas.slice(0, 2).join(", ")}`);
  }
  await tg.send(chatId, lines.join("\n"), { reply_markup: { inline_keyboard: [[ctx.openApp({ tab: "balance" }, "📊 Подробнее")]] } });
}

async function sendIdea(ctx: Ctx, mealType?: string, wish?: string, products?: string[]) {
  const { env, tg, chatId, repo } = ctx;
  if (!aiEnabled(env)) {
    await tg.send(chatId, "Для идей нужен ключ ИИ (ANTHROPIC_API_KEY или OPENAI_API_KEY). Пока могу подсказать из ваших рецептов: /menu");
    return;
  }
  const progress = await tg.send(chatId, "✨ Думаю, что приготовить…");
  try {
    const idea = await getIdea(env, mealType, wish, products);
    const draftId = await repo.saveDraft(idea);
    await tg.edit(chatId, progress.message_id, formatRecipe(idea), {
      reply_markup: {
        inline_keyboard: [[{ text: "💾 Сохранить в книгу", callback_data: `save:${draftId}` }], [{ text: "🔄 Другой вариант", callback_data: `idea:${mealType ?? ""}` }]],
      },
    });
  } catch (e) {
    await tg.edit(chatId, progress.message_id, errText(e));
  }
}

const RATING_TEXT: Record<number, string> = { 2: "❤️ Любимое!", 1: "👍 Понравилось", [-1]: "👎 Учту, буду предлагать реже" };

async function handleCallback(ctx: Ctx, q: CallbackQuery) {
  const { env, tg, repo, chatId } = ctx;
  const [action, a, b] = (q.data ?? "").split(":");
  const answer = (text?: string) => tg.call("answerCallbackQuery", { callback_query_id: q.id, text });
  const messageId = q.message!.message_id;

  switch (action) {
    case "ate": {
      const meal = await repo.addMeal({ date: today(env), meal_type: b, recipe_id: Number(a) }, ctx.userId);
      await answer(`Отметила: ${mealName(b)} — ${meal.title}`);
      await tg.send(chatId, `✅ ${mealName(b)}: <b>${h(meal.title)}</b> — отмечено. Приятного аппетита!`);
      return;
    }
    case "ateplan": {
      const p = await repo.getPlanItem(Number(a));
      if (!p) return void (await answer("Этого блюда уже нет в меню — откройте /today"));
      const meal = await repo.addMeal({ date: p.date, meal_type: p.meal_type, recipe_id: p.recipe_id, title: p.title, eaters: p.eaters }, ctx.userId);
      await answer(`Отметила: ${mealName(p.meal_type)} — ${meal.title}`);
      await tg.send(chatId, `✅ ${mealName(p.meal_type)}: <b>${h(meal.title)}</b> — отмечено. Приятного аппетита!`);
      return;
    }
    case "rate": {
      const meal = await repo.rateMeal(Number(a), Number(b));
      await answer(RATING_TEXT[Number(b)]);
      await tg.send(chatId, `${RATING_TEXT[Number(b)]} — «${h(meal.title)}»`);
      return;
    }
    case "save": {
      const draft = await repo.takeDraft<RecipeInput>(Number(a));
      if (!draft) return void (await answer("Черновик уже сохранён или устарел"));
      const recipe: Recipe = await repo.createRecipe(draft, ctx.userId);
      await answer("Сохранено!");
      await tg.call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [[ctx.openApp({ recipe: String(recipe.id) }, "✅ Сохранено — открыть")]] },
      });
      return;
    }
    case "del": {
      await repo.deleteRecipe(Number(a));
      await answer("Удалено");
      await tg.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
      await tg.send(chatId, "🗑 Рецепт удалён.");
      return;
    }
    case "idea":
      await answer();
      return sendIdea(ctx, a || undefined);
    case "prod": {
      await answer();
      const draft = await repo.takeDraft<{ products: string[] }>(Number(a));
      if (!draft) return void (await tg.send(chatId, "Эта подборка устарела — пришлите фото ещё раз."));
      return sendIdea(ctx, undefined, undefined, draft.products);
    }
    case "today":
      await answer();
      return sendToday(ctx);
    case "plan":
      await answer("Составляю меню…");
      return sendWeek(ctx, true);
    case "shop": {
      if (a === "family") {
        try {
          const n = await sendShoppingList(env, ctx.userId, true);
          await answer(n > 1 ? "Отправила всей семье 📤" : "Отправила. Остальные получат, когда напишут боту /start");
        } catch (e) {
          await answer(String((e as Error).message));
        }
        return;
      }
      await answer("Собираю список…");
      const start = today(env);
      const res = await shoppingFromPlan(env, start, addDays(start, 6));
      if (!res.dishes) return void (await tg.send(chatId, "Сначала нужно меню на неделю: /week"));
      return sendShopping(ctx);
    }
    case "have":
      if (a === "start") {
        await repo.setChatState(ctx.userId, "have");
        await answer();
        await tg.send(
          chatId,
          "🏠 Скажите голосом или напишите, <b>что из списка уже есть дома</b>.\nНапример: <i>«гречка, яйца, морковь и молоко»</i>\n\nЯ уберу это из покупок.",
        );
      } else {
        await repo.setChatState(ctx.userId, null);
        // Список покупок после «что есть дома» — это конец первой настройки.
        await repo.updateSettings({ setup_done: true });
        await answer("Готово!");
        await tg.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        await tg.send(chatId, "👍 Список покупок готов. Он всегда под рукой: /shop или вкладка «Покупки» в приложении.", {
          reply_markup: { inline_keyboard: [[{ text: "📤 Отправить всей семье", callback_data: "shop:family" }]] },
        });
      }
      return;
    default:
      await answer();
  }
}
