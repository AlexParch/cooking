import { CATEGORY_KEYS, MEAL_TYPE_KEYS, detectCategories, type MealRecord } from "./nutrition";

export interface Ingredient {
  name: string;
  amount?: string;
}

export interface Recipe {
  id: number;
  title: string;
  meal_types: string[];
  categories: string[];
  ingredients: Ingredient[];
  steps: string[];
  notes: string;
  warnings: string[];
  minutes: number | null;
  source: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export type RecipeInput = Pick<Recipe, "title"> &
  Partial<Pick<Recipe, "meal_types" | "categories" | "ingredients" | "steps" | "notes" | "warnings" | "minutes" | "source">>;

export interface Meal extends MealRecord {
  id: number;
  title: string;
  created_by: number | null;
  created_at: string;
}

const json = (v: unknown) => JSON.stringify(v ?? []);
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

function rowToRecipe(r: Record<string, unknown>): Recipe {
  return {
    id: r.id as number,
    title: r.title as string,
    meal_types: parse(r.meal_types, []),
    categories: parse(r.categories, []),
    ingredients: parse(r.ingredients, []),
    steps: parse(r.steps, []),
    notes: (r.notes as string) ?? "",
    warnings: parse(r.warnings, []),
    minutes: (r.minutes as number | null) ?? null,
    source: r.source as string,
    created_by: (r.created_by as number | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

function rowToMeal(r: Record<string, unknown>): Meal {
  return {
    id: r.id as number,
    date: r.date as string,
    meal_type: r.meal_type as string,
    recipe_id: (r.recipe_id as number | null) ?? null,
    title: r.title as string,
    categories: parse(r.categories, []),
    created_by: (r.created_by as number | null) ?? null,
    created_at: r.created_at as string,
  };
}

/** Приводит входные данные к допустимым значениям. */
export function normalizeRecipe(input: RecipeInput): Required<RecipeInput> {
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (!title) throw new HttpError(400, "Нужно название рецепта");
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map((i) => ({ name: String(i?.name ?? "").trim(), amount: i?.amount ? String(i.amount).trim() : undefined }))
    .filter((i) => i.name);
  let categories = (input.categories ?? []).filter((c) => CATEGORY_KEYS.includes(c));
  if (categories.length === 0) categories = detectCategories([title, ...ingredients.map((i) => i.name)]);
  return {
    title,
    meal_types: (input.meal_types ?? []).filter((m) => (MEAL_TYPE_KEYS as string[]).includes(m)),
    categories: [...new Set(categories)],
    ingredients,
    steps: (input.steps ?? []).map((s) => String(s).trim()).filter(Boolean),
    notes: String(input.notes ?? "").trim(),
    warnings: (input.warnings ?? []).map(String).filter(Boolean),
    minutes: Number.isFinite(input.minutes) && (input.minutes as number) > 0 ? Math.round(input.minutes as number) : null,
    source: input.source ?? "manual",
  } as Required<RecipeInput>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Repo {
  constructor(private db: D1Database) {}

  async listRecipes(): Promise<Recipe[]> {
    const { results } = await this.db.prepare("SELECT * FROM recipes ORDER BY title COLLATE NOCASE").all();
    return results.map(rowToRecipe);
  }

  async getRecipe(id: number): Promise<Recipe | null> {
    const row = await this.db.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
    return row ? rowToRecipe(row) : null;
  }

  async createRecipe(input: RecipeInput, userId: number | null): Promise<Recipe> {
    const r = normalizeRecipe(input);
    const row = await this.db
      .prepare(
        `INSERT INTO recipes (title, meal_types, categories, ingredients, steps, notes, warnings, minutes, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(r.title, json(r.meal_types), json(r.categories), json(r.ingredients), json(r.steps), r.notes, json(r.warnings), r.minutes, r.source, userId)
      .first();
    return rowToRecipe(row!);
  }

  async updateRecipe(id: number, input: RecipeInput): Promise<Recipe> {
    const r = normalizeRecipe(input);
    const row = await this.db
      .prepare(
        `UPDATE recipes SET title = ?, meal_types = ?, categories = ?, ingredients = ?, steps = ?, notes = ?, warnings = ?, minutes = ?,
         updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .bind(r.title, json(r.meal_types), json(r.categories), json(r.ingredients), json(r.steps), r.notes, json(r.warnings), r.minutes, id)
      .first();
    if (!row) throw new HttpError(404, "Рецепт не найден");
    return rowToRecipe(row);
  }

  async deleteRecipe(id: number): Promise<void> {
    await this.db.prepare("UPDATE meals SET recipe_id = NULL WHERE recipe_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
  }

  async listMeals(from: string, to: string): Promise<Meal[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM meals WHERE date BETWEEN ? AND ? ORDER BY date, id")
      .bind(from, to)
      .all();
    return results.map(rowToMeal);
  }

  async addMeal(
    input: { date: string; meal_type: string; recipe_id?: number | null; title?: string; categories?: string[] },
    userId: number | null,
  ): Promise<Meal> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new HttpError(400, "Неверная дата");
    if (!(MEAL_TYPE_KEYS as string[]).includes(input.meal_type)) throw new HttpError(400, "Неверный приём пищи");
    let title = String(input.title ?? "").trim();
    let categories = (input.categories ?? []).filter((c) => CATEGORY_KEYS.includes(c));
    let recipeId: number | null = null;
    if (input.recipe_id) {
      const recipe = await this.getRecipe(Number(input.recipe_id));
      if (!recipe) throw new HttpError(404, "Рецепт не найден");
      recipeId = recipe.id;
      title ||= recipe.title;
      if (categories.length === 0) categories = recipe.categories;
    }
    if (!title) throw new HttpError(400, "Укажите блюдо");
    if (categories.length === 0) categories = detectCategories([title]);
    const row = await this.db
      .prepare("INSERT INTO meals (date, meal_type, recipe_id, title, categories, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(input.date, input.meal_type, recipeId, title.slice(0, 200), json(categories), userId)
      .first();
    return rowToMeal(row!);
  }

  async deleteMeal(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM meals WHERE id = ?").bind(id).run();
  }

  async saveDraft(payload: unknown): Promise<number> {
    // Старые черновики не нужны дольше пары дней.
    await this.db.prepare("DELETE FROM drafts WHERE created_at < datetime('now', '-2 days')").run();
    const row = await this.db.prepare("INSERT INTO drafts (payload) VALUES (?) RETURNING id").bind(JSON.stringify(payload)).first<{ id: number }>();
    return row!.id;
  }

  async takeDraft<T>(id: number): Promise<T | null> {
    const row = await this.db.prepare("DELETE FROM drafts WHERE id = ? RETURNING payload").bind(id).first<{ payload: string }>();
    return row ? (JSON.parse(row.payload) as T) : null;
  }
}
