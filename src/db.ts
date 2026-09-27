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
  servings: number | null;
  prep_ahead: string;
  prep_hours: number | null;
  source: string;
  source_url: string | null;
  likes: number;
  dislikes: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export type RecipeInput = Pick<Recipe, "title"> &
  Partial<
    Pick<
      Recipe,
      "meal_types" | "categories" | "ingredients" | "steps" | "notes" | "warnings" | "minutes" | "servings" | "prep_ahead" | "prep_hours" | "source" | "source_url"
    >
  >;

export interface Meal extends MealRecord {
  id: number;
  title: string;
  rating: number | null;
  created_by: number | null;
  created_at: string;
}

export interface PlanItem {
  id: number;
  date: string;
  meal_type: string;
  recipe_id: number | null;
  title: string;
  leftovers: boolean;
}

export interface ShoppingItem {
  id: number;
  name: string;
  amount: string;
  aisle: string;
  checked: boolean;
  source: string;
}

export interface Settings {
  family_size: number;
  morning_hour: number;
  evening_hour: number;
  notify_morning: boolean;
  notify_evening: boolean;
  /** Мастер первого запуска пройден. */
  setup_done: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  family_size: 5,
  morning_hour: 8,
  evening_hour: 20,
  notify_morning: true,
  notify_evening: true,
  setup_done: false,
};

const json = (v: unknown) => JSON.stringify(v ?? []);
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const num = (v: unknown) => (v == null ? null : Number(v));

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
    minutes: num(r.minutes),
    servings: num(r.servings),
    prep_ahead: (r.prep_ahead as string) ?? "",
    prep_hours: num(r.prep_hours),
    source: r.source as string,
    source_url: (r.source_url as string | null) ?? null,
    likes: Number(r.likes ?? 0),
    dislikes: Number(r.dislikes ?? 0),
    created_by: num(r.created_by),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

function rowToMeal(r: Record<string, unknown>): Meal {
  return {
    id: r.id as number,
    date: r.date as string,
    meal_type: r.meal_type as string,
    recipe_id: num(r.recipe_id),
    title: r.title as string,
    categories: parse(r.categories, []),
    rating: num(r.rating),
    created_by: num(r.created_by),
    created_at: r.created_at as string,
  };
}

const rowToPlan = (r: Record<string, unknown>): PlanItem => ({
  id: r.id as number,
  date: r.date as string,
  meal_type: r.meal_type as string,
  recipe_id: num(r.recipe_id),
  title: r.title as string,
  leftovers: Boolean(r.leftovers),
});

const rowToShopping = (r: Record<string, unknown>): ShoppingItem => ({
  id: r.id as number,
  name: r.name as string,
  amount: r.amount as string,
  aisle: r.aisle as string,
  checked: Boolean(r.checked),
  source: r.source as string,
});

const posInt = (v: unknown, max = 1000) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : null;
};

/** Приводит входные данные к допустимым значениям. */
export function normalizeRecipe(input: RecipeInput) {
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
    minutes: posInt(input.minutes, 24 * 60),
    servings: posInt(input.servings, 50),
    prep_ahead: String(input.prep_ahead ?? "").trim(),
    prep_hours: input.prep_ahead ? posInt(input.prep_hours, 72) : null,
    source: input.source ?? "manual",
    source_url: input.source_url ? String(input.source_url).slice(0, 1000) : null,
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const checkSlot = (date: unknown, mealType: unknown) => {
  if (!isDate(date)) throw new HttpError(400, "Неверная дата");
  if (!(MEAL_TYPE_KEYS as string[]).includes(mealType as string)) throw new HttpError(400, "Неверный приём пищи");
};

export class Repo {
  constructor(private db: D1Database) {}

  // ---------- рецепты ----------
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
        `INSERT INTO recipes (title, meal_types, categories, ingredients, steps, notes, warnings, minutes, servings, prep_ahead, prep_hours, source, source_url, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        r.title, json(r.meal_types), json(r.categories), json(r.ingredients), json(r.steps), r.notes, json(r.warnings),
        r.minutes, r.servings, r.prep_ahead, r.prep_hours, r.source, r.source_url, userId,
      )
      .first();
    return rowToRecipe(row!);
  }

  async updateRecipe(id: number, input: RecipeInput): Promise<Recipe> {
    const r = normalizeRecipe(input);
    const row = await this.db
      .prepare(
        `UPDATE recipes SET title = ?, meal_types = ?, categories = ?, ingredients = ?, steps = ?, notes = ?, warnings = ?, minutes = ?,
         servings = ?, prep_ahead = ?, prep_hours = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
      .bind(
        r.title, json(r.meal_types), json(r.categories), json(r.ingredients), json(r.steps), r.notes, json(r.warnings), r.minutes,
        r.servings, r.prep_ahead, r.prep_hours, id,
      )
      .first();
    if (!row) throw new HttpError(404, "Рецепт не найден");
    // Название могло поменяться — обновим его и в меню.
    await this.db.prepare("UPDATE plan SET title = ? WHERE recipe_id = ?").bind(r.title, id).run();
    return rowToRecipe(row);
  }

  async deleteRecipe(id: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE meals SET recipe_id = NULL WHERE recipe_id = ?").bind(id),
      this.db.prepare("DELETE FROM plan WHERE recipe_id = ?").bind(id),
      this.db.prepare("DELETE FROM recipes WHERE id = ?").bind(id),
    ]);
  }

  // ---------- что ели ----------
  async listMeals(from: string, to: string): Promise<Meal[]> {
    const { results } = await this.db.prepare("SELECT * FROM meals WHERE date BETWEEN ? AND ? ORDER BY date, id").bind(from, to).all();
    return results.map(rowToMeal);
  }

  async getMeal(id: number): Promise<Meal | null> {
    const row = await this.db.prepare("SELECT * FROM meals WHERE id = ?").bind(id).first();
    return row ? rowToMeal(row) : null;
  }

  async addMeal(
    input: { date: string; meal_type: string; recipe_id?: number | null; title?: string; categories?: string[] },
    userId: number | null,
  ): Promise<Meal> {
    checkSlot(input.date, input.meal_type);
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

  /** Оценка блюда: 2 — любимое, 1 — понравилось, -1 — не очень. Счётчики рецепта пересчитываются. */
  async rateMeal(id: number, rating: number): Promise<Meal> {
    if (![2, 1, -1].includes(rating)) throw new HttpError(400, "Неверная оценка");
    const meal = await this.getMeal(id);
    if (!meal) throw new HttpError(404, "Запись не найдена");
    await this.db.prepare("UPDATE meals SET rating = ? WHERE id = ?").bind(rating, id).run();
    if (meal.recipe_id) await this.recountRatings(meal.recipe_id);
    return { ...meal, rating };
  }

  private async recountRatings(recipeId: number) {
    await this.db
      .prepare(
        `UPDATE recipes SET
           likes = (SELECT COUNT(*) FROM meals WHERE recipe_id = ?1 AND rating > 0) + (SELECT COUNT(*) FROM meals WHERE recipe_id = ?1 AND rating = 2),
           dislikes = (SELECT COUNT(*) FROM meals WHERE recipe_id = ?1 AND rating < 0)
         WHERE id = ?1`,
      )
      .bind(recipeId)
      .run();
  }

  // ---------- меню ----------
  async listPlan(from: string, to: string): Promise<PlanItem[]> {
    const { results } = await this.db.prepare("SELECT * FROM plan WHERE date BETWEEN ? AND ? ORDER BY date").bind(from, to).all();
    return results.map(rowToPlan);
  }

  async setPlan(input: { date: string; meal_type: string; recipe_id?: number | null; title?: string; leftovers?: boolean }): Promise<PlanItem> {
    checkSlot(input.date, input.meal_type);
    let title = String(input.title ?? "").trim();
    let recipeId: number | null = null;
    if (input.recipe_id) {
      const recipe = await this.getRecipe(Number(input.recipe_id));
      if (!recipe) throw new HttpError(404, "Рецепт не найден");
      recipeId = recipe.id;
      title ||= recipe.title;
    }
    if (!title) throw new HttpError(400, "Укажите блюдо");
    const row = await this.db
      .prepare(
        `INSERT INTO plan (date, meal_type, recipe_id, title, leftovers) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date, meal_type) DO UPDATE SET recipe_id = excluded.recipe_id, title = excluded.title, leftovers = excluded.leftovers
         RETURNING *`,
      )
      .bind(input.date, input.meal_type, recipeId, title.slice(0, 200), input.leftovers ? 1 : 0)
      .first();
    return rowToPlan(row!);
  }

  async deletePlan(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM plan WHERE id = ?").bind(id).run();
  }

  // ---------- покупки ----------
  async listShopping(): Promise<ShoppingItem[]> {
    const { results } = await this.db.prepare("SELECT * FROM shopping ORDER BY checked, aisle, name COLLATE NOCASE").all();
    return results.map(rowToShopping);
  }

  async addShopping(items: { name: string; amount?: string; aisle?: string; source?: string }[]): Promise<void> {
    const stmts = items
      .filter((i) => String(i.name ?? "").trim())
      .map((i) =>
        this.db
          .prepare("INSERT INTO shopping (name, amount, aisle, source) VALUES (?, ?, ?, ?)")
          .bind(String(i.name).trim().slice(0, 200), String(i.amount ?? "").slice(0, 100), i.aisle || "Прочее", i.source || "manual"),
      );
    if (stmts.length) await this.db.batch(stmts);
  }

  async updateShopping(id: number, patch: { checked?: boolean; name?: string; amount?: string }): Promise<void> {
    const item = await this.db.prepare("SELECT * FROM shopping WHERE id = ?").bind(id).first();
    if (!item) throw new HttpError(404, "Нет такой покупки");
    const cur = rowToShopping(item);
    await this.db
      .prepare("UPDATE shopping SET checked = ?, name = ?, amount = ? WHERE id = ?")
      .bind(patch.checked ?? cur.checked ? 1 : 0, patch.name ?? cur.name, patch.amount ?? cur.amount, id)
      .run();
  }

  async deleteShopping(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM shopping WHERE id = ?").bind(id).run();
  }

  async clearShopping(what: "checked" | "plan" | "all"): Promise<void> {
    const where = what === "checked" ? "checked = 1" : what === "plan" ? "source = 'plan' AND checked = 0" : "1 = 1";
    await this.db.prepare(`DELETE FROM shopping WHERE ${where}`).run();
  }

  // ---------- пользователи и настройки ----------
  async touchUser(id: number, chatId: number, firstName = ""): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO users (id, chat_id, first_name) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, first_name = excluded.first_name`,
      )
      .bind(id, chatId, firstName)
      .run();
  }

  async listUsers(): Promise<{ id: number; chat_id: number; first_name: string; notify: boolean }[]> {
    const { results } = await this.db.prepare("SELECT * FROM users ORDER BY created_at").all();
    return results.map((r) => ({ id: r.id as number, chat_id: r.chat_id as number, first_name: r.first_name as string, notify: Boolean(r.notify) }));
  }

  async setUserNotify(id: number, notify: boolean): Promise<void> {
    await this.db.prepare("UPDATE users SET notify = ? WHERE id = ?").bind(notify ? 1 : 0, id).run();
  }

  async getSettings(): Promise<Settings> {
    const { results } = await this.db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
    const s: Settings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of results) {
      if (!(key in s)) continue;
      const def = DEFAULT_SETTINGS[key as keyof Settings];
      (s as unknown as Record<string, unknown>)[key] = typeof def === "boolean" ? value === "1" : Number(value);
    }
    return s;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const limits: Record<string, [number, number]> = { family_size: [1, 20], morning_hour: [5, 12], evening_hour: [16, 23] };
    const stmts: D1PreparedStatement[] = [];
    for (const [key, raw] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      let value: string;
      if (typeof DEFAULT_SETTINGS[key as keyof Settings] === "boolean") value = raw ? "1" : "0";
      else {
        const [min, max] = limits[key];
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n)) continue;
        value = String(Math.min(max, Math.max(min, n)));
      }
      stmts.push(this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value));
    }
    if (stmts.length) await this.db.batch(stmts);
    return this.getSettings();
  }

  /** true, если ключ ещё не отмечался (и отмечает его). Для однократных напоминаний. */
  async markSent(key: string): Promise<boolean> {
    const res = await this.db.prepare("INSERT OR IGNORE INTO sent (key) VALUES (?)").bind(key).run();
    return Boolean(res.meta.changes);
  }

  /** Чего бот ждёт от пользователя в чате (например, список «что есть дома»). Живёт 30 минут. */
  async getChatState(userId: number): Promise<string | null> {
    const v = await this.db.prepare("SELECT value FROM settings WHERE key = ?").bind(`state:${userId}`).first<string>("value");
    if (!v) return null;
    const { mode, at } = JSON.parse(v) as { mode: string; at: number };
    return Date.now() - at < 30 * 60_000 ? mode : null;
  }

  async setChatState(userId: number, mode: string | null): Promise<void> {
    if (!mode) await this.db.prepare("DELETE FROM settings WHERE key = ?").bind(`state:${userId}`).run();
    else
      await this.db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(`state:${userId}`, JSON.stringify({ mode, at: Date.now() }))
        .run();
  }

  // ---------- черновики ----------
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
