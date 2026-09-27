import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES, MEAL_TYPES } from "./nutrition";
import type { RecipeInput } from "./db";

export interface AiEnv {
  AI?: Ai;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

export const aiEnabled = (env: AiEnv) => Boolean(env.ANTHROPIC_API_KEY);

/** Голос → текст через Whisper в Cloudflare Workers AI (бесплатная квота). */
export async function transcribe(env: AiEnv, audio: ArrayBuffer): Promise<string> {
  if (!env.AI) throw new Error("Workers AI не подключён");
  const bytes = new Uint8Array(audio);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res = (await env.AI.run("@cf/openai/whisper-large-v3-turbo" as keyof AiModels, {
    audio: btoa(binary),
    language: "ru",
  } as never)) as { text?: string };
  return (res.text ?? "").trim();
}

const RecipeSchema = z.object({
  title: z.string().describe("Короткое название блюда"),
  meal_types: z.array(z.enum(Object.keys(MEAL_TYPES) as [string, ...string[]])).describe("Для каких приёмов пищи подходит"),
  categories: z.array(z.enum(CATEGORIES.map((c) => c.key) as [string, ...string[]])).describe("Группы продуктов, которые заметно присутствуют в блюде"),
  ingredients: z.array(z.object({ name: z.string(), amount: z.string().describe("Количество, пусто если не указано") })),
  steps: z.array(z.string()).describe("Шаги приготовления, по одному действию"),
  minutes: z.number().describe("Примерное время приготовления в минутах, 0 если непонятно"),
  notes: z.string().describe("Полезные заметки: хранение, замены, подача. Пусто если нечего добавить"),
  warnings: z.array(z.string()).describe("Что нарушает правила: глютен или сахар в ингредиентах, с предложением замены"),
});
type ParsedRecipe = z.infer<typeof RecipeSchema>;

const categoryHelp = CATEGORIES.map((c) => `${c.key} — ${c.name}`).join("; ");
const mealHelp = Object.entries(MEAL_TYPES).map(([k, v]) => `${k} — ${v}`).join("; ");

const SYSTEM = `Ты помощник семьи, которая питается по правилам ПП: без глютена (пшеница, рожь, ячмень, обычная мука, хлеб, макароны из пшеницы) и без сахара (сахар, мёд в больших количествах, сиропы, сладкие соусы).
Отвечай на русском. Группы продуктов: ${categoryHelp}. Приёмы пищи: ${mealHelp}.
Группы указывай только те, что реально заметны в блюде (щепотка кунжута для украшения — не повод отмечать «орехи и семена»).`;

function client(env: AiEnv) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY не задан — ИИ-функции выключены");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

async function ask(env: AiEnv, prompt: string): Promise<ParsedRecipe> {
  const response = await client(env).messages.parse({
    model: env.ANTHROPIC_MODEL || "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(RecipeSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Модель отказалась обработать запрос");
  if (!response.parsed_output) throw new Error("Не удалось разобрать ответ модели");
  return response.parsed_output;
}

const toInput = (r: ParsedRecipe, source: string): RecipeInput => ({
  ...r,
  ingredients: r.ingredients.map((i) => ({ name: i.name, amount: i.amount || undefined })),
  minutes: r.minutes || null,
  source,
});

/** Превращает надиктованный или вставленный текст в структурированный рецепт. */
export async function parseRecipe(env: AiEnv, text: string, source = "text"): Promise<RecipeInput> {
  const r = await ask(
    env,
    `Вот рецепт, надиктованный голосом или вставленный текстом. Он может быть сбивчивым, с оговорками и лишними словами. Аккуратно оформи его, ничего не выдумывая сверх сказанного (кроме очевидного времени и приёма пищи).\n\n<recipe>\n${text}\n</recipe>`,
  );
  return toInput(r, source);
}

/** Придумывает новый рецепт, закрывающий недостающие группы. */
export async function generateIdea(
  env: AiEnv,
  opts: { mealType?: string; missing: string[]; low: string[]; plenty: string[]; known: string[]; wish?: string },
): Promise<RecipeInput> {
  const meal = opts.mealType ? MEAL_TYPES[opts.mealType as keyof typeof MEAL_TYPES] : "любой приём пищи";
  const r = await ask(
    env,
    [
      `Предложи один новый простой домашний рецепт на ${meal.toLowerCase()} из обычных продуктов из супермаркета.`,
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
