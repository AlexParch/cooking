// Общая логика для бота, WebApp и напоминаний.
import { generateIdea } from "./ai";
import { Repo, type PlanItem, type Recipe, type RecipeInput, type ShoppingItem } from "./db";
import { today, type Env } from "./env";
import { addDays, balanceSummary, computeBalance, MEAL_TYPE_KEYS, MEAL_TYPES, suggestRecipes, type MealType } from "./nutrition";
import { AISLE_ORDER, buildShoppingList, matchByProducts, planWeek, prepReminders, productMatcher, type PrepReminder } from "./planner";
import { escapeHtml, Telegram } from "./telegram";

/** Сколько дней истории смотрим для «давно не готовили». */
const HISTORY_DAYS = 60;

export async function getBalance(env: Env, days = 7, date = today(env)) {
  const repo = new Repo(env.DB);
  const meals = await repo.listMeals(addDays(date, -HISTORY_DAYS), date);
  return computeBalance(meals, date, days);
}

export async function getSuggestions(env: Env, mealType?: string, date = today(env), limit = 5) {
  const repo = new Repo(env.DB);
  const [recipes, meals] = await Promise.all([repo.listRecipes(), repo.listMeals(addDays(date, -HISTORY_DAYS), date)]);
  return suggestRecipes(recipes, meals, date, mealType, limit);
}

export async function getIdea(env: Env, mealType?: string, wish?: string, products?: string[]): Promise<RecipeInput> {
  const repo = new Repo(env.DB);
  const [balance, recipes, settings] = await Promise.all([getBalance(env), repo.listRecipes(), repo.getSettings()]);
  return generateIdea(env, {
    mealType,
    wish,
    products,
    familySize: settings.family_size,
    ...balanceSummary(balance),
    known: recipes.map((r) => r.title),
  });
}

/** Заполняет пустые клетки меню. `replace` — сначала очистить (кроме «остатков»). */
export async function fillPlan(env: Env, start: string, days: number, replace = false): Promise<PlanItem[]> {
  const repo = new Repo(env.DB);
  const end = addDays(start, days - 1);
  if (replace) {
    await env.DB.prepare("DELETE FROM plan WHERE date BETWEEN ? AND ? AND leftovers = 0").bind(start, end).run();
  }
  const [recipes, meals, plan] = await Promise.all([repo.listRecipes(), repo.listMeals(addDays(start, -HISTORY_DAYS), end), repo.listPlan(start, end)]);
  const history = meals.filter((m) => m.date < start);
  // То, что уже съели в эти дни, тоже занимает клетку меню.
  const eaten = meals
    .filter((m) => m.date >= start && !plan.some((p) => p.date === m.date && p.meal_type === m.meal_type))
    .map((m) => ({ id: 0, date: m.date, meal_type: m.meal_type, recipe_id: m.recipe_id, title: m.title, leftovers: false }));
  const drafts = planWeek(recipes, history, [...plan, ...eaten], start, days);
  if (drafts.length) {
    await env.DB.batch(
      drafts.map((d) =>
        env.DB.prepare("INSERT OR IGNORE INTO plan (date, meal_type, recipe_id, title) VALUES (?, ?, ?, ?)").bind(d.date, d.meal_type, d.recipe_id, d.title),
      ),
    );
  }
  return repo.listPlan(start, end);
}

/** Предлагает одну замену для клетки меню (следующий подходящий вариант, не текущий). */
export async function swapPlan(env: Env, date: string, mealType: string): Promise<PlanItem | null> {
  const repo = new Repo(env.DB);
  const [recipes, history, week] = await Promise.all([
    repo.listRecipes(),
    repo.listMeals(addDays(date, -HISTORY_DAYS), addDays(date, -1)),
    repo.listPlan(addDays(date, -6), addDays(date, 6)),
  ]);
  const current = week.find((p) => p.date === date && p.meal_type === mealType);
  const others = week.filter((p) => p !== current);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const sim = [
    ...history,
    ...others.map((p) => ({ date: p.date, meal_type: p.meal_type, recipe_id: p.recipe_id, categories: byId.get(p.recipe_id ?? -1)?.categories ?? [] })),
  ];
  const sameDay = new Set(others.filter((p) => p.date === date).map((p) => p.recipe_id));
  const pool = recipes.filter(
    (r) => r.id !== current?.recipe_id && !sameDay.has(r.id) && (r.meal_types.length === 0 || r.meal_types.includes(mealType)),
  );
  const top = suggestRecipes(pool, sim, date, mealType, 4);
  if (!top.length) return null;
  const pick = top[Math.floor(Math.random() * Math.min(top.length, 3))].recipe;
  return repo.setPlan({ date, meal_type: mealType, recipe_id: pick.id });
}

/** Список покупок на период меню: заменяет прошлые «плановые» некупленные позиции. */
export async function shoppingFromPlan(env: Env, from: string, to: string) {
  const repo = new Repo(env.DB);
  const [plan, recipes, settings] = await Promise.all([repo.listPlan(from, to), repo.listRecipes(), repo.getSettings()]);
  const items = buildShoppingList(plan, new Map(recipes.map((r) => [r.id, r])), settings.family_size);
  await repo.clearShopping("plan");
  await repo.addShopping(items.map((i) => ({ ...i, source: "plan" })));
  return { count: items.length, dishes: plan.filter((p) => !p.leftovers).length };
}

export async function fromProducts(env: Env, products: string[]) {
  const repo = new Repo(env.DB);
  return matchByProducts(await repo.listRecipes(), products);
}

// ---------- напоминания ----------

export interface DayBrief {
  date: string;
  plan: PlanItem[];
  prepToday: PrepReminder[];
  prepTomorrow: PrepReminder[];
  missing: string[];
}

export async function dayBrief(env: Env, date = today(env)): Promise<DayBrief> {
  const repo = new Repo(env.DB);
  const tomorrow = addDays(date, 1);
  const [plan, recipes, balance] = await Promise.all([repo.listPlan(date, tomorrow), repo.listRecipes(), getBalance(env, 7, date)]);
  const byId = new Map<number, Recipe>(recipes.map((r) => [r.id, r]));
  const todayPlan = plan.filter((p) => p.date === date);
  return {
    date,
    plan: MEAL_TYPE_KEYS.map((k) => todayPlan.find((p) => p.meal_type === k)).filter(Boolean) as PlanItem[],
    prepToday: prepReminders(todayPlan, byId, "morning"),
    prepTomorrow: prepReminders(plan.filter((p) => p.date === tomorrow), byId, "evening"),
    missing: balanceSummary(balance).missing,
  };
}

export const mealName = (k: string) => MEAL_TYPES[k as MealType] ?? k;

// ---------- «что уже есть дома» ----------

/** Отмечает в списке покупок то, что уже есть дома (по названиям, с учётом падежей). */
export async function markHave(env: Env, products: string[]) {
  const repo = new Repo(env.DB);
  const items = (await repo.listShopping()).filter((i) => !i.checked);
  const has = productMatcher(products);
  const matched = items.filter((i) => has(i.name));
  if (matched.length) await env.DB.batch(matched.map((i) => env.DB.prepare("UPDATE shopping SET checked = 1 WHERE id = ?").bind(i.id)));
  return { matched, left: items.filter((i) => !matched.includes(i)) };
}

/** Текст списка покупок по отделам (HTML для Telegram). */
export function shoppingText(items: ShoppingItem[], title = "🛒 <b>Список покупок</b>"): string {
  const lines = [title];
  for (const aisle of AISLE_ORDER) {
    const group = items.filter((i) => i.aisle === aisle && !i.checked);
    if (!group.length) continue;
    lines.push("", `<b>${aisle}</b>`, ...group.map((i) => `▫️ ${escapeHtml(i.name)}${i.amount ? ` — ${escapeHtml(i.amount)}` : ""}`));
  }
  return lines.join("\n").slice(0, 4000);
}

/** Отправляет список покупок в чат: только себе или всей семье. */
export async function sendShoppingList(env: Env, fromUserId: number, toFamily: boolean): Promise<number> {
  const repo = new Repo(env.DB);
  const items = (await repo.listShopping()).filter((i) => !i.checked);
  if (!items.length) throw new Error("Список покупок пуст");
  const users = await repo.listUsers();
  const me = users.find((u) => u.id === fromUserId);
  const targets = toFamily ? users : me ? [me] : [];
  if (!targets.length) throw new Error("Напишите боту /start, чтобы он мог присылать сообщения");
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  for (const u of targets) {
    const title = u.id === fromUserId || !me ? "🛒 <b>Список покупок</b>" : `🛒 <b>Список покупок от ${escapeHtml(me.first_name || "семьи")}</b>`;
    await tg.send(u.chat_id, shoppingText(items, title));
  }
  return targets.length;
}
