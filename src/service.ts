// Общая логика для бота и WebApp.
import { generateIdea } from "./ai";
import { Repo, type RecipeInput } from "./db";
import { today, type Env } from "./env";
import { addDays, balanceSummary, computeBalance, suggestRecipes } from "./nutrition";

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

export async function getIdea(env: Env, mealType?: string, wish?: string): Promise<RecipeInput> {
  const repo = new Repo(env.DB);
  const [balance, recipes] = await Promise.all([getBalance(env), repo.listRecipes()]);
  return generateIdea(env, { mealType, wish, ...balanceSummary(balance), known: recipes.map((r) => r.title) });
}
