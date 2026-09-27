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
