import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES, MEAL_TYPES } from "./nutrition";
import type { RecipeInput } from "./db";

export interface AiEnv {
  AI?: Ai;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
}

/** Рецепты, фото и идеи: Claude, а если его ключа нет — GPT по ключу OpenAI. */
export const aiEnabled = (env: AiEnv) => Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
export const voiceEnabled = (env: AiEnv) => Boolean(env.OPENAI_API_KEY || env.AI);

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// ---------- голос ----------

/**
 * Голос → текст. Основной вариант — OpenAI (gpt-4o-transcribe), он лучше всего понимает
 * живую русскую речь. Если ключа нет — Whisper в Cloudflare Workers AI.
 */
export async function transcribe(env: AiEnv, audio: ArrayBuffer, filename = "voice.ogg", mime = "audio/ogg"): Promise<string> {
  if (env.OPENAI_API_KEY) {
    const form = new FormData();
    form.append("file", new File([audio], filename, { type: mime }));
    form.append("model", env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe");
    form.append("language", "ru");
    form.append("prompt", "Женщина диктует рецепт блюда: продукты, граммы, ложки, шаги приготовления.");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Распознавание речи: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (((await res.json()) as { text?: string }).text ?? "").trim();
  }
  if (!env.AI) throw new Error("Распознавание речи не подключено (нет OPENAI_API_KEY)");
  const res = (await env.AI.run("@cf/openai/whisper-large-v3-turbo" as keyof AiModels, {
    audio: toBase64(audio),
    language: "ru",
  } as never)) as { text?: string };
  return (res.text ?? "").trim();
}

// ---------- Claude / GPT ----------

const RecipeSchema = z.object({
  title: z.string().describe("Короткое понятное название блюда"),
  meal_types: z.array(z.enum(Object.keys(MEAL_TYPES) as [string, ...string[]])).describe("Для каких приёмов пищи подходит"),
  categories: z.array(z.enum(CATEGORIES.map((c) => c.key) as [string, ...string[]])).describe("Группы продуктов, которые заметно присутствуют в блюде"),
  ingredients: z.array(z.object({ name: z.string(), amount: z.string().describe("Количество с единицами: «200 г», «2 шт», «1 ст. л.»; пусто если не указано") })),
  steps: z.array(z.string()).describe("Шаги приготовления, по одному действию. Время пиши цифрами: «варить 20 мин»"),
  minutes: z.number().describe("Примерное общее время приготовления в минутах, 0 если непонятно"),
  servings: z.number().describe("На сколько порций рассчитаны указанные количества, 0 если непонятно"),
  prep_ahead: z
    .string()
    .describe("Что нужно сделать заранее, до дня готовки или за несколько часов: замочить бобовые/крупу, разморозить мясо/рыбу, замариновать, поставить тесто. Коротко, повелительно: «Замочить нут в холодной воде». Пусто, если ничего не нужно"),
  prep_hours: z.number().describe("За сколько часов до готовки нужно это сделать (замочить нут — 12, замариновать — 2). 0 если prep_ahead пустой"),
  notes: z.string().describe("Полезные заметки: хранение, замены, подача, что понравится детям. Пусто если нечего добавить"),
  warnings: z.array(z.string()).describe("Нарушения правил ПП: глютен или сахар в ингредиентах, с предложением замены"),
});
type ParsedRecipe = z.infer<typeof RecipeSchema>;

const categoryHelp = CATEGORIES.map((c) => `${c.key} — ${c.name}`).join("; ");
const mealHelp = Object.entries(MEAL_TYPES).map(([k, v]) => `${k} — ${v}`).join("; ");

const SYSTEM = `Ты помощник мамы в семье из двух взрослых и трёх детей. Семья питается по правилам ПП: без глютена (пшеница, рожь, ячмень, обычная мука, хлеб, макароны из пшеницы, манка, булгур, кускус) и без сахара (сахар, сиропы, сладкие соусы, кетчуп с сахаром).
Отвечай на русском, простыми словами. Группы продуктов: ${categoryHelp}. Приёмы пищи: ${mealHelp}.
Группы указывай только те, что реально заметны в блюде (щепотка кунжута для украшения — не повод отмечать «орехи и семена»).
Всегда думай о подготовке заранее: сухие бобовые почти всегда надо замачивать, замороженное мясо и рыбу — размораживать.`;

/** Часть запроса к модели: текст или картинка. */
type Part = string | { image: ArrayBuffer; mime: string };

/** Спрашивает модель и получает ответ строго по схеме. */
async function ask<T>(env: AiEnv, schema: z.ZodType<T>, parts: Part[]): Promise<T> {
  if (env.ANTHROPIC_API_KEY) return askClaude(env, schema, parts);
  if (env.OPENAI_API_KEY) return askOpenAI(env, schema, parts);
  throw new Error("Нет ключа ИИ (ANTHROPIC_API_KEY или OPENAI_API_KEY) — ИИ-функции выключены");
}

async function askClaude<T>(env: AiEnv, schema: z.ZodType<T>, parts: Part[]): Promise<T> {
  const response = await new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages.parse({
    model: env.ANTHROPIC_MODEL || "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(schema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: parts.map((p) =>
          typeof p === "string"
            ? { type: "text" as const, text: p }
            : { type: "image" as const, source: { type: "base64" as const, media_type: p.mime as "image/jpeg", data: toBase64(p.image) } },
        ),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Модель отказалась обработать запрос");
  if (!response.parsed_output) throw new Error("Не удалось разобрать ответ модели");
  return response.parsed_output as T;
}

async function askOpenAI<T>(env: AiEnv, schema: z.ZodType<T>, parts: Part[]): Promise<T> {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.4-mini",
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: jsonSchema } },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: parts.map((p) =>
            typeof p === "string"
              ? { type: "text", text: p }
              : { type: "image_url", image_url: { url: `data:${p.mime};base64,${toBase64(p.image)}` } },
          ),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const message = ((await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] }).choices?.[0]?.message;
  if (message?.refusal) throw new Error("Модель отказалась обработать запрос");
  if (!message?.content) throw new Error("Не удалось разобрать ответ модели");
  return schema.parse(JSON.parse(message.content));
}

const askRecipe = (env: AiEnv, text: string) => ask(env, RecipeSchema, [text]);

const toInput = (r: ParsedRecipe, source: string, sourceUrl?: string): RecipeInput => ({
  ...r,
  ingredients: r.ingredients.map((i) => ({ name: i.name, amount: i.amount || undefined })),
  minutes: r.minutes || null,
  servings: r.servings || null,
  prep_hours: r.prep_ahead ? r.prep_hours || null : null,
  source,
  source_url: sourceUrl,
});

/** Превращает надиктованный или вставленный текст в структурированный рецепт. */
export async function parseRecipe(env: AiEnv, text: string, source = "text", opts: { adapt?: boolean; sourceUrl?: string } = {}): Promise<RecipeInput> {
  const task = opts.adapt
    ? "Это рецепт из интернета или книги. Оформи его и адаптируй под правила ПП: всё с глютеном и сахаром сразу замени подходящими аналогами (рисовая/кукурузная/миндальная мука, эритрит или стевия, гречневая лапша и т.п.), а в notes коротко перечисли, что заменил. Убери лишнюю «воду» и истории, оставь суть."
    : "Это рецепт, надиктованный голосом или вставленный текстом. Он может быть сбивчивым, с оговорками («ой, нет, не так») и лишними словами. Аккуратно оформи его, ничего не выдумывая сверх сказанного (кроме очевидного времени, приёма пищи и подготовки заранее). Если в рецепте есть глютен или сахар — не меняй, а напиши в warnings.";
  const r = await askRecipe(env, `${task}\n\n<recipe>\n${text.slice(0, 40_000)}\n</recipe>`);
  return toInput(r, source, opts.sourceUrl);
}

/** Придумывает новый рецепт, закрывающий недостающие группы (или из имеющихся продуктов). */
export async function generateIdea(
  env: AiEnv,
  opts: { mealType?: string; missing: string[]; low: string[]; plenty: string[]; known: string[]; wish?: string; products?: string[]; familySize: number },
): Promise<RecipeInput> {
  const meal = opts.mealType ? MEAL_TYPES[opts.mealType as keyof typeof MEAL_TYPES] : "любой приём пищи";
  const r = await askRecipe(
    env,
    [
      `Предложи один новый простой домашний рецепт на ${meal.toLowerCase()} из обычных продуктов из супермаркета. Готовить на ${opts.familySize} порций, блюдо должно понравиться и детям.`,
      opts.products?.length ? `Дома есть: ${opts.products.join(", ")}. Используй в основном их; докупать можно максимум 1–2 недорогих продукта.` : "",
      opts.missing.length ? `За последнюю неделю совсем не было: ${opts.missing.join(", ")}.` : "",
      opts.low.length ? `Мало было: ${opts.low.join(", ")}.` : "",
      opts.plenty.length ? `Уже с избытком: ${opts.plenty.join(", ")} — лучше не делать на них упор.` : "",
      opts.known.length ? `Эти блюда у семьи уже есть, не повторяй их: ${opts.known.slice(0, 80).join("; ")}.` : "",
      opts.wish ? `Пожелание: ${opts.wish}` : "",
      "Рецепт должен строго соответствовать правилам: без глютена и без сахара. Поле warnings оставь пустым, если нарушений нет.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return toInput(r, "ai");
}

// ---------- фото ----------

const PhotoSchema = z.object({
  kind: z.enum(["recipe", "products", "other"]).describe("recipe — на фото текст рецепта (книга, экран, записка); products — продукты, холодильник, полка; other — что-то другое"),
  products: z.array(z.string()).describe("Если products — какие продукты видно, простыми словами в именительном падеже"),
  recipe_text: z.string().describe("Если recipe — полный текст рецепта с фото, дословно"),
  comment: z.string().describe("Если other — короткий дружелюбный ответ, что на фото"),
});
export type PhotoAnalysis = z.infer<typeof PhotoSchema>;

export async function analyzePhoto(env: AiEnv, image: ArrayBuffer, mime: string, caption = ""): Promise<PhotoAnalysis> {
  const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ? mime : "image/jpeg") as "image/jpeg";
  try {
    return await ask(env, PhotoSchema, [{ image, mime: media }, `Что на фото? ${caption ? `Подпись: «${caption}».` : ""}`]);
  } catch (e) {
    console.error("разбор фото", e);
    throw new Error("Не получилось разобрать фото");
  }
}

// ---------- ссылки ----------

/** Достаёт рецепт со страницы: сначала разметка schema.org/Recipe, иначе текст страницы. */
export function extractRecipeText(html: string): string {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findRecipe(JSON.parse(m[1]));
      if (found) return JSON.stringify(found);
    } catch {
      /* битая разметка — пробуем дальше */
    }
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|header|footer|nav)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
  return `${title.trim()}\n${body.trim()}`.slice(0, 30_000);
}

function findRecipe(node: unknown): unknown {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) {
    const { name, recipeIngredient, recipeInstructions, recipeYield, totalTime, cookTime, prepTime, description } = obj;
    return { name, description, recipeYield, totalTime, prepTime, cookTime, recipeIngredient, recipeInstructions };
  }
  return findRecipe(obj["@graph"]);
}

export async function importFromUrl(env: AiEnv, url: string): Promise<RecipeInput> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Это не похоже на ссылку");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Нужна ссылка http(s)");
  const res = await fetch(u.toString(), {
    headers: { "user-agent": "Mozilla/5.0 (compatible; FamilyKitchenBot/1.0)", accept: "text/html,*/*", "accept-language": "ru,en;q=0.8" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Сайт не отдал страницу (${res.status}). Попробуйте скопировать текст рецепта и прислать его.`);
  const text = extractRecipeText(await res.text());
  if (text.length < 80) throw new Error("На странице не нашёлся рецепт. Скопируйте текст рецепта и пришлите его.");
  return parseRecipe(env, text, "link", { adapt: true, sourceUrl: u.toString() });
}
