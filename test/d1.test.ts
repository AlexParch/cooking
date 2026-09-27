import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
// Тест для Node (node:sqlite) — исключён из tsconfig, где типы Cloudflare Workers.
import { createD1 } from "../server/d1.js";
import { Repo } from "../src/db";

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync("migrations").sort()) sqlite.exec(readFileSync(`migrations/${f}`, "utf8"));
  return createD1(sqlite) as unknown as D1Database;
}

describe("SQLite вместо D1 (свой сервер)", () => {
  it("рецепты, меню, покупки и настройки работают через Repo", async () => {
    const repo = new Repo(freshDb());
    const r = await repo.createRecipe({ title: "Суп", meal_types: ["lunch"], ingredients: [{ name: "Чечевица", amount: "200 г" }] }, 1);
    expect(r.id).toBe(1);
    expect(r.categories).toContain("legumes");
    const p = await repo.setPlan({ date: "2026-09-28", meal_type: "lunch", recipe_id: r.id });
    await repo.setPlan({ date: "2026-09-28", meal_type: "lunch", title: "Другое" }); // замена в той же клетке
    expect((await repo.listPlan("2026-09-28", "2026-09-28")).map((x) => x.title)).toEqual(["Другое"]);
    expect(p.leftovers).toBe(false);
    await repo.addShopping([{ name: "Молоко" }, { name: "Яйца", amount: "10 шт" }]);
    expect((await repo.listShopping()).length).toBe(2);
    expect(await repo.markSent("morning:1")).toBe(true);
    expect(await repo.markSent("morning:1")).toBe(false);
    const s = await repo.updateSettings({ family_size: 6, setup_done: true });
    expect(s).toMatchObject({ family_size: 6, setup_done: true });
    const meal = await repo.addMeal({ date: "2026-09-28", meal_type: "lunch", recipe_id: r.id }, 1);
    await repo.rateMeal(meal.id, 2);
    expect((await repo.getRecipe(r.id))?.likes).toBe(2);
    // члены семьи и «кто ел»
    const members = await repo.saveMember({ name: "Мама", emoji: "👩" });
    await repo.saveMember({ name: "Миша", kind: "child" });
    const all = await repo.listMembers();
    expect(all.map((x) => x.name)).toEqual(["Мама", "Миша"]);
    expect((await repo.getSettings()).family_size).toBe(2);
    const onlyKid = await repo.addMeal({ date: "2026-09-28", meal_type: "dinner", title: "Пельмени", eaters: [all[1].id] }, 1);
    expect(onlyKid.eaters).toEqual([all[1].id]);
    const everyone = await repo.addMeal({ date: "2026-09-28", meal_type: "dinner", title: "Салат", eaters: all.map((x) => x.id) }, 1);
    expect(everyone.eaters).toBeNull(); // все — хранится как «вся семья»
    expect(members).toHaveLength(1);
    await repo.deleteRecipe(r.id);
    expect(await repo.getRecipe(r.id)).toBeNull();
  });
});
