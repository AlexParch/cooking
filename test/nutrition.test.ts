import { describe, expect, it } from "vitest";
import { addDays, computeBalance, detectCategories, suggestRecipes, type MealRecord } from "../src/nutrition";

const meal = (date: string, categories: string[], recipe_id: number | null = null, meal_type = "lunch"): MealRecord => ({ date, meal_type, recipe_id, categories });

describe("detectCategories", () => {
  it("находит группы по ингредиентам", () => {
    expect(detectCategories(["Чечевица красная", "морковь", "яйцо"]).sort()).toEqual(["eggs", "legumes", "vegetables"]);
    expect(detectCategories(["Филе индейки", "гречка"]).sort()).toEqual(["grains", "poultry"]);
  });
  it("не путает рис с барбарисом", () => {
    expect(detectCategories(["барбарис"])).not.toContain("grains");
  });
});

describe("computeBalance", () => {
  const today = "2026-09-27";
  it("считает только последние N дней и помнит давность", () => {
    const meals = [meal(today, ["fish"]), meal(addDays(today, -3), ["fish"]), meal(addDays(today, -10), ["legumes"])];
    const b = Object.fromEntries(computeBalance(meals, today, 7).map((x) => [x.key, x]));
    expect(b.fish.count).toBe(2);
    expect(b.fish.status).toBe("ok");
    expect(b.legumes.count).toBe(0);
    expect(b.legumes.status).toBe("missing");
    expect(b.legumes.daysSince).toBe(10);
    expect(b.mushrooms.daysSince).toBeNull();
  });
});

describe("suggestRecipes", () => {
  const today = "2026-09-27";
  const recipes = [
    { id: 1, title: "Курица с рисом", meal_types: ["lunch"], categories: ["poultry", "grains"] },
    { id: 2, title: "Чечевичный суп", meal_types: ["lunch"], categories: ["legumes", "vegetables"] },
    { id: 3, title: "Омлет", meal_types: ["breakfast"], categories: ["eggs"] },
  ];
  it("предлагает то, чего не хватает, и не повторяет вчерашнее", () => {
    const meals = [meal(addDays(today, -1), ["poultry", "grains"], 1), meal(addDays(today, -2), ["poultry"], 1)];
    const res = suggestRecipes(recipes, meals, today, "lunch");
    expect(res.map((s) => s.recipe.id)).toEqual([2, 1]);
    expect(res[0].reasons.join(" ")).toContain("Бобовые");
  });
  it("фильтрует по приёму пищи", () => {
    expect(suggestRecipes(recipes, [], today, "breakfast").map((s) => s.recipe.id)).toEqual([3]);
  });
});

describe("detectCategories: фарш", () => {
  it("куриный фарш — это птица, а не мясо", () => {
    expect(detectCategories(["Куриный фарш"])).toEqual(["poultry"]);
    expect(detectCategories(["Фарш говяжий"])).toEqual(["meat"]);
  });
});

describe("баланс по членам семьи", () => {
  const today = "2026-09-27";
  const members = [
    { id: 1, name: "Мама", emoji: "👩" },
    { id: 2, name: "Миша", emoji: "👦" },
  ];
  it("общие блюда засчитываются всем, личные — только тем, кто ел", async () => {
    const { computeFamilyBalance, worstBalance } = await import("../src/nutrition");
    const meals = [
      { ...meal(today, ["poultry"]), eaters: [1] }, // мама — курица
      { ...meal(today, ["fish"]), eaters: [2] }, // Миша — пельмени с рыбой
      { ...meal(today, ["eggs"], null, "breakfast"), eaters: null }, // омлет — все
    ];
    const fam = computeFamilyBalance(meals, members, today, 7);
    const get = (i: number, key: string) => fam[i].balance.find((b) => b.key === key)!.count;
    expect([get(0, "poultry"), get(0, "fish"), get(0, "eggs")]).toEqual([1, 0, 1]);
    expect([get(1, "poultry"), get(1, "fish"), get(1, "eggs")]).toEqual([0, 1, 1]);
    // Для подсказок берём худшего: рыбу ела не вся семья — значит, «не было» у кого-то.
    const worst = Object.fromEntries(worstBalance(fam).map((b) => [b.key, b]));
    expect(worst.fish.count).toBe(0);
    expect(worst.eggs.count).toBe(1);
  });
});
