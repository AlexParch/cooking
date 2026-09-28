import { describe, expect, it } from "vitest";
import { formatNumber, parseQuantity, scaleAmount } from "../public/js/amounts.js";
import { extractRecipeText } from "../src/ai";
import type { PlanItem, Recipe } from "../src/db";
import { aisleFor, buildShoppingList, matchByProducts, planWeek, prepReminders } from "../src/planner";

let nextId = 1;
const recipe = (p: Partial<Recipe> & { title: string }): Recipe => ({
  id: nextId++, meal_types: [], categories: [], ingredients: [], steps: [], notes: "", warnings: [], minutes: null, servings: null,
  prep_ahead: "", prep_hours: null, source: "manual", source_url: null, likes: 0, dislikes: 0, created_by: null, created_at: "", updated_at: "", ...p,
});
const plan = (p: Partial<PlanItem> & { recipe_id: number }): PlanItem => ({ id: nextId++, date: "2026-09-28", meal_type: "lunch", title: "", leftovers: false, eaters: null, ...p });

describe("amounts", () => {
  it("пересчитывает количества", () => {
    expect(scaleAmount("200 г", 2.5)).toBe("500 г");
    expect(scaleAmount("1/2 ч. л.", 2)).toBe("1 ч. л.");
    expect(scaleAmount("2-3 шт", 2)).toBe("4-6 шт");
    expect(scaleAmount("1,5 стакана", 2)).toBe("3 стакана");
    expect(scaleAmount("по вкусу", 3)).toBe("по вкусу");
    expect(scaleAmount("творог 5% — 200 г", 2)).toBe("творог 5% — 400 г");
  });
  it("красиво округляет", () => {
    expect(formatNumber(1.26)).toBe("1,5");
    expect(formatNumber(262)).toBe("260");
    expect(formatNumber(0.25)).toBe("0,25");
  });
  it("разбирает количество", () => {
    expect(parseQuantity("300 г")).toEqual({ value: 300, unit: "г" });
    expect(parseQuantity("щепотка")).toBeNull();
  });
});

describe("buildShoppingList", () => {
  it("складывает одинаковые продукты, пересчитывает под семью и раскладывает по отделам", () => {
    const soup = recipe({ title: "Суп", servings: 4, ingredients: [{ name: "Морковь", amount: "2 шт" }, { name: "Соль" }, { name: "Чечевица", amount: "200 г" }] });
    const stew = recipe({ title: "Рагу", servings: 5, ingredients: [{ name: "морковь", amount: "1 шт" }, { name: "Кабачок", amount: "1 шт" }] });
    const list = buildShoppingList(
      [plan({ recipe_id: soup.id }), plan({ recipe_id: stew.id, meal_type: "dinner" }), plan({ recipe_id: stew.id, leftovers: true })],
      new Map([soup, stew].map((r) => [r.id, r])),
      5,
    );
    expect(list.find((i) => i.name === "Морковь")?.amount).toBe("4 шт");
    expect(list.find((i) => i.name === "Чечевица")).toMatchObject({ amount: "250 г", aisle: "Крупы, мука, бобовые" });
    expect(list.find((i) => i.name === "Соль")).toBeUndefined();
    expect(list[0].aisle).toBe("Овощи и зелень");
  });
  it("блюдо для части семьи — на столько порций, сколько едоков", () => {
    const soup = recipe({ title: "Суп", servings: 4, ingredients: [{ name: "Чечевица", amount: "200 г" }] });
    const kids = recipe({ title: "Каша", servings: 1, ingredients: [{ name: "Гречка", amount: "50 г" }] });
    const list = buildShoppingList(
      [plan({ recipe_id: soup.id, eaters: [1, 2] }), plan({ recipe_id: kids.id, eaters: [3, 4, 5] })],
      new Map([soup, kids].map((r) => [r.id, r])),
      5,
    );
    expect(list.find((i) => i.name === "Чечевица")?.amount).toBe("100 г");
    expect(list.find((i) => i.name === "Гречка")?.amount).toBe("150 г");
  });
  it("определяет отдел", () => {
    expect(aisleFor("Филе индейки")).toBe("Мясо и птица");
    expect(aisleFor("Оливковое масло")).toBe("Прочее");
  });
});

describe("planWeek", () => {
  it("заполняет только пустые клетки и не повторяет блюдо в один день", () => {
    const rs = [
      recipe({ title: "Омлет", meal_types: ["breakfast"], categories: ["eggs"] }),
      recipe({ title: "Каша", meal_types: ["breakfast"], categories: ["grains"] }),
      recipe({ title: "Суп", meal_types: ["lunch", "dinner"], categories: ["legumes"] }),
      recipe({ title: "Рыба", meal_types: ["lunch", "dinner"], categories: ["fish"] }),
      recipe({ title: "Курица", meal_types: ["lunch", "dinner"], categories: ["poultry"] }),
    ];
    const existing = [plan({ recipe_id: rs[3].id, date: "2026-09-28", meal_type: "lunch" })];
    const drafts = planWeek(rs, [], existing, "2026-09-28", 3, () => 0);
    expect(drafts.some((d) => d.date === "2026-09-28" && d.meal_type === "lunch")).toBe(false);
    expect(drafts.filter((d) => d.meal_type === "snack")).toHaveLength(0);
    for (const day of ["2026-09-28", "2026-09-29", "2026-09-30"]) {
      const ids = drafts.filter((d) => d.date === day).map((d) => d.recipe_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // Завтраки чередуются, а не омлет каждый день.
    const breakfasts = drafts.filter((d) => d.meal_type === "breakfast").map((d) => d.title);
    expect(new Set(breakfasts).size).toBe(2);
  });
});

describe("prepReminders", () => {
  it("замачивание — с вечера, разморозку за пару часов — утром", () => {
    const hummus = recipe({ title: "Хумус", prep_ahead: "Замочить нут", prep_hours: 12 });
    const fish = recipe({ title: "Рыба", prep_ahead: "Замариновать рыбу", prep_hours: 2 });
    const map = new Map([hummus, fish].map((r) => [r.id, r]));
    const p = [plan({ recipe_id: hummus.id }), plan({ recipe_id: fish.id, meal_type: "dinner" })];
    expect(prepReminders(p, map, "evening").map((r) => r.title)).toEqual(["Хумус"]);
    expect(prepReminders(p, map, "morning").map((r) => r.title)).toEqual(["Рыба"]);
  });
});

describe("matchByProducts", () => {
  it("находит рецепты по продуктам с учётом падежей", () => {
    const rs = [
      recipe({ title: "Кабачки с фаршем", ingredients: [{ name: "Кабачки" }, { name: "Фарш индейки" }, { name: "Соль" }] }),
      recipe({ title: "Сырники", ingredients: [{ name: "Творог" }, { name: "Яйцо" }, { name: "Рисовая мука" }] }),
    ];
    const res = matchByProducts(rs, ["кабачок", "фарш"]);
    expect(res.map((r) => r.recipe.title)).toEqual(["Кабачки с фаршем"]);
    expect(res[0].missing).toEqual([]);
  });
});

describe("extractRecipeText", () => {
  it("берёт рецепт из разметки schema.org", () => {
    const html = `<html><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Борщ","recipeIngredient":["свёкла"]}]}</script><body>реклама</body></html>`;
    expect(extractRecipeText(html)).toContain("Борщ");
    expect(extractRecipeText(html)).not.toContain("реклама");
  });
});

describe("крупные единицы", () => {
  it("переводит граммы в килограммы", () => {
    const r = recipe({ title: "Гречка", servings: 1, ingredients: [{ name: "Гречка", amount: "700 г" }] });
    const list = buildShoppingList([plan({ recipe_id: r.id }), plan({ recipe_id: r.id, meal_type: "dinner" })], new Map([[r.id, r]]), 1);
    expect(list[0].amount).toBe("1,4 кг");
  });
});

describe("склейка форм слова", () => {
  it("яйца и яйцо — одна строка", () => {
    const a = recipe({ title: "A", ingredients: [{ name: "Яйца", amount: "3 шт" }] });
    const b = recipe({ title: "B", ingredients: [{ name: "яйцо", amount: "1 шт" }] });
    const list = buildShoppingList([plan({ recipe_id: a.id }), plan({ recipe_id: b.id, meal_type: "dinner" })], new Map([a, b].map((r) => [r.id, r])), 5);
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe("4 шт");
  });
});

describe("что есть дома", () => {
  it("разбирает сказанный список продуктов", async () => {
    const { splitProducts, productMatcher } = await import("../src/planner");
    expect(splitProducts("У меня дома есть гречка, яйца и морковь. Ещё молоко")).toEqual(["гречка", "яйца", "морковь", "молоко"]);
    const has = productMatcher(splitProducts("гречка, яйца и морковь"));
    expect(["Гречка", "Яйцо", "Морковь", "Нут сухой", "Филе индейки"].filter(has)).toEqual(["Гречка", "Яйцо", "Морковь"]);
  });
});
