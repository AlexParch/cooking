// Меню на неделю, список покупок, подготовка заранее и подбор «из того, что есть».
import { formatNumber, parseQuantity, scaleAmount, servingsFactor } from "../public/js/amounts.js";
import type { PlanItem, Recipe } from "./db";
import { addDays, detectCategories, MEAL_TYPE_KEYS, suggestRecipes, type MealRecord } from "./nutrition";

// ---------- меню на неделю ----------

export interface PlanDraft {
  date: string;
  meal_type: string;
  recipe_id: number;
  title: string;
}

/**
 * Заполняет пустые клетки меню на `days` дней начиная со `start`.
 * Каждый следующий выбор учитывает предыдущие, поэтому неделя получается разнообразной.
 * `random` — для «Перемешать»: берём не всегда лучший вариант, а один из трёх лучших.
 */
export function planWeek(
  recipes: Recipe[],
  history: MealRecord[],
  existing: PlanItem[],
  start: string,
  days = 7,
  random: () => number = Math.random,
  mealTypes: string[] = MEAL_TYPE_KEYS,
): PlanDraft[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const sim: MealRecord[] = [...history];
  const taken = new Set(existing.map((p) => `${p.date}|${p.meal_type}`));
  for (const p of existing) {
    sim.push({ date: p.date, meal_type: p.meal_type, recipe_id: p.recipe_id, categories: byId.get(p.recipe_id ?? -1)?.categories ?? [] });
  }
  const out: PlanDraft[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const usedToday = new Set(sim.filter((m) => m.date === date).map((m) => m.recipe_id));
    for (const mt of mealTypes) {
      if (taken.has(`${date}|${mt}`)) continue;
      // Только рецепты, явно подходящие к этому приёму пищи (или без пометки).
      const pool = recipes.filter((r) => !usedToday.has(r.id) && (r.meal_types.length === 0 ? mt !== "snack" : r.meal_types.includes(mt)));
      const top = suggestRecipes(pool, sim, date, mt, 3);
      if (top.length === 0) continue;
      const roll = random();
      const pick = top[roll < 0.6 || top.length === 1 ? 0 : roll < 0.85 || top.length === 2 ? 1 : 2].recipe;
      out.push({ date, meal_type: mt, recipe_id: pick.id, title: pick.title });
      usedToday.add(pick.id);
      sim.push({ date, meal_type: mt, recipe_id: pick.id, categories: pick.categories });
    }
  }
  return out;
}

// ---------- подготовка заранее ----------

export interface PrepReminder {
  date: string;
  meal_type: string;
  title: string;
  prep: string;
}

/** Нужна ли подготовка с вечера (замачивание, разморозка на ночь). */
export const isOvernight = (r: Pick<Recipe, "prep_ahead" | "prep_hours">) =>
  Boolean(r.prep_ahead) && (r.prep_hours == null ? true : r.prep_hours >= 8);

export function prepReminders(plan: PlanItem[], recipes: Map<number, Recipe>, when: "evening" | "morning"): PrepReminder[] {
  const out: PrepReminder[] = [];
  for (const p of plan) {
    if (p.leftovers || p.recipe_id == null) continue;
    const r = recipes.get(p.recipe_id);
    if (!r?.prep_ahead) continue;
    if ((when === "evening") === isOvernight(r)) out.push({ date: p.date, meal_type: p.meal_type, title: r.title, prep: r.prep_ahead });
  }
  return out;
}

// ---------- список покупок ----------

export const AISLES = [
  { name: "Овощи и зелень", cats: ["vegetables", "greens", "mushrooms"] },
  { name: "Фрукты и ягоды", cats: ["fruits"] },
  { name: "Мясо и птица", cats: ["meat", "poultry", "offal"] },
  { name: "Рыба и морепродукты", cats: ["fish", "seafood"] },
  { name: "Молочное и яйца", cats: ["dairy", "eggs"] },
  { name: "Крупы, мука, бобовые", cats: ["grains", "legumes"] },
  { name: "Орехи и семена", cats: ["nuts"] },
] as const;
export const AISLE_ORDER = [...AISLES.map((a) => a.name), "Прочее"];

export function aisleFor(name: string): string {
  const n = name.toLowerCase();
  if (/мука|крахмал/.test(n)) return "Крупы, мука, бобовые";
  // Соусы, пасты, масла, специи — в бакалею, даже если там «томат» или «орех».
  if (/паст|соус|сок\b|масл|специ|приправ|уксус|ванил|сироп|эритрит|стеви/.test(n)) return "Прочее";
  const cats = detectCategories([name]);
  return AISLES.find((a) => a.cats.some((c) => (cats as string[]).includes(c)))?.name ?? "Прочее";
}

/** То, что обычно есть дома, — не засоряем список. */
const PANTRY = /^(соль|вода|вода кипячен\S*|перец черн\S*( молот\S*)?|черный перец|лед)$/i;

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** 1400 г → «1,4 кг», 1500 мл → «1,5 л». */
function bigUnits(value: number, unit: string): string {
  if (value >= 1000 && /^(г|гр|грамм\S*)$/.test(unit)) return `${String(Math.round(value / 100) / 10).replace(".", ",")} кг`;
  if (value >= 1000 && /^(мл|миллилитр\S*)$/.test(unit)) return `${String(Math.round(value / 100) / 10).replace(".", ",")} л`;
  // Штуки покупаем целыми: «8,5 шт» → «9 шт».
  if (/^(шт|штук\S*|зубч\S*|пуч\S*|банк\S*|упаков\S*)$/.test(unit)) return `${Math.ceil(value - 0.01)} ${unit}`;
  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

export interface ShoppingDraft {
  name: string;
  amount: string;
  aisle: string;
}

/**
 * Собирает ингредиенты всех блюд меню, пересчитав под число едоков и сложив одинаковые.
 * Блюдо для всей семьи — на `familySize` порций, блюдо для отдельных людей — на столько, сколько их.
 */
export function buildShoppingList(plan: PlanItem[], recipes: Map<number, Recipe>, familySize: number): ShoppingDraft[] {
  const acc = new Map<string, { name: string; qty: Map<string, number>; other: string[] }>();
  for (const p of plan) {
    if (p.leftovers || p.recipe_id == null) continue;
    const r = recipes.get(p.recipe_id);
    if (!r) continue;
    const factor = servingsFactor(r.servings, p.eaters?.length || familySize);
    for (const ing of r.ingredients) {
      const norm = normName(ing.name);
      if (!norm || PANTRY.test(norm)) continue;
      // «Яйца» и «яйцо», «морковь» и «моркови» — один продукт: сравниваем без окончаний.
      const key = norm
        .split(" ")
        .map((w) => (w.length > 3 ? w.slice(0, -1) : w))
        .join(" ");
      let item = acc.get(key);
      if (!item) acc.set(key, (item = { name: ing.name.trim(), qty: new Map(), other: [] }));
      const amount = scaleAmount(ing.amount, factor);
      const q = parseQuantity(amount);
      if (q) item.qty.set(q.unit, (item.qty.get(q.unit) ?? 0) + q.value);
      else if (amount && !item.other.includes(amount)) item.other.push(amount);
    }
  }
  return [...acc.values()]
    .map((i) => ({
      name: i.name.charAt(0).toUpperCase() + i.name.slice(1),
      amount: [...[...i.qty].map(([unit, v]) => bigUnits(v, unit)), ...i.other].join(" + "),
      aisle: aisleFor(i.name),
    }))
    .sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name, "ru"));
}

// ---------- «что приготовить из того, что есть» ----------

const STAPLES = /^(соль|вода|перец( черн| молот|$)|специи|масло|оливковое масло|растительное масло|сода|уксус|зелень по вкусу)/i;
const stems = (s: string) =>
  normName(s)
    .split(/[^а-яa-z]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, Math.min(5, Math.max(3, w.length - 1))));

export interface ProductMatch {
  recipe: Recipe;
  have: string[];
  missing: string[];
  ratio: number;
}

/** Проверка «этот ингредиент есть среди продуктов» с учётом падежей: «кабачок» ≈ «кабачки». */
export function productMatcher(products: string[]): (name: string) => boolean {
  const productStems = products.map(stems).filter((s) => s.length);
  return (name: string) => {
    const s = stems(name);
    return productStems.some((ps) => ps.some((p) => s.some((x) => x.startsWith(p) || p.startsWith(x))));
  };
}

/** «У меня есть гречка, яйца и морковь» → ["гречка", "яйца", "морковь"]. */
export function splitProducts(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(у меня|дома|уже|ещё|еще|есть|имеется|осталось|остались|немного|пачка|пачки)/g, " ")
    .split(/[,.;:!?\n]+|\s+и\s+|\s+а также\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2);
}

export function matchByProducts(recipes: Recipe[], products: string[], limit = 5): ProductMatch[] {
  const has = productMatcher(products);
  return recipes
    .map((recipe) => {
      const main = recipe.ingredients.filter((i) => !STAPLES.test(normName(i.name)));
      const have = main.filter((i) => has(i.name)).map((i) => i.name);
      const missing = main.filter((i) => !has(i.name)).map((i) => i.name);
      return { recipe, have, missing, ratio: main.length ? have.length / main.length : 0 };
    })
    .filter((m) => m.have.length > 0 && m.ratio >= 0.4)
    .sort((a, b) => b.ratio - a.ratio || a.missing.length - b.missing.length)
    .slice(0, limit);
}
