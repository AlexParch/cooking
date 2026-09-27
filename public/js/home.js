// Главный экран: что сегодня едим, напоминания, большие кнопки действий.
import { openAddRecipe, openFridge, openIdea } from "./add.js";
import { openMarkEaten, openRecipe, startCooking } from "./recipes.js";
import { $$, api, bus, catEmojis, esc, greeting, guard, haptic, hint, MEAL_ICONS, MEAL_ORDER, mealName, prettyDate, recipeById, state, toast } from "./ui.js";

export async function renderHome(view) {
  const date = state.config.today;
  const [brief, meals, balance] = await Promise.all([api(`/brief?date=${date}`), api(`/meals?from=${date}&to=${date}`), api("/balance?days=7")]);
  const name = state.config.me?.first_name || "";
  const missing = balance.filter((b) => b.status === "missing").slice(0, 4);
  const noRecipes = state.recipes.length === 0;

  const slot = (k) => {
    const eaten = meals.filter((m) => m.meal_type === k);
    const planned = brief.plan.find((p) => p.meal_type === k);
    const plannedRecipe = planned?.recipe_id ? recipeById(planned.recipe_id) : null;
    let body;
    if (eaten.length) {
      body = eaten
        .map(
          (m) => `<div class="slot-dish done">✅ ${esc(m.title)}</div>
          ${
            m.recipe_id
              ? m.rating == null
                ? `<div class="rate">Как вам? <button data-rate="${m.id}:2">❤️</button><button data-rate="${m.id}:1">👍</button><button data-rate="${m.id}:-1">👎</button></div>`
                : `<div class="muted small">${m.rating === 2 ? "❤️ любимое" : m.rating > 0 ? "👍 понравилось" : "👎 не очень"}</div>`
              : ""
          }`,
        )
        .join("");
    } else if (planned) {
      body = `<div class="slot-dish">${esc(planned.title)}${planned.leftovers ? ' <span class="badge">доедаем</span>' : ""}</div>
        <div class="slot-btns">
          ${plannedRecipe?.steps.length && !planned.leftovers ? `<button class="btn secondary" data-cook="${plannedRecipe.id}">👩‍🍳 Готовить</button>` : plannedRecipe ? `<button class="btn secondary" data-open="${plannedRecipe.id}">📖 Рецепт</button>` : ""}
          <button class="btn primary" data-eat="${k}">✅ Съели</button>
        </div>`;
    } else {
      body = `<div class="slot-empty">ещё не выбрано</div><div class="slot-btns"><button class="btn secondary" data-eat="${k}">＋ Отметить, что ели</button></div>`;
    }
    return `<div class="slot"><div class="slot-head">${MEAL_ICONS[k]} ${esc(mealName(k))}</div>${body}</div>`;
  };

  view.innerHTML = `
    ${!state.config.settings.setup_done ? `<button class="card continue-setup" data-tab-go="setup"><b>🚀 Продолжить настройку</b><div class="muted">рецепты → меню → список покупок</div></button>` : ""}
    <div class="hello"><h1>${greeting()}${name ? `, ${esc(name)}` : ""}! 👋</h1><div class="muted">${esc(prettyDate(date))}</div></div>

    ${
      noRecipes
        ? `<div class="card welcome">
            <h2>Давайте начнём 🌱</h2>
            <p>Добавьте 5–10 блюд, которые вы обычно готовите. Проще всего — <b>рассказать голосом</b>, я сама всё запишу.</p>
            <button class="big-btn primary block" data-action="add-recipe">🎙 Добавить первый рецепт</button>
          </div>`
        : ""
    }

    ${
      brief.prepToday.length || brief.prepTomorrow.length
        ? `<div class="card reminder">
            <h3>⏰ Не забудьте</h3>
            ${brief.prepToday.map((p) => `<p>• <b>Сегодня:</b> ${esc(p.prep)} <span class="muted">— для «${esc(p.title)}»</span></p>`).join("")}
            ${brief.prepTomorrow.map((p) => `<p>• <b>С вечера на завтра:</b> ${esc(p.prep)} <span class="muted">— для «${esc(p.title)}»</span></p>`).join("")}
          </div>`
        : ""
    }

    <div class="card">
      <div class="card-head"><h2>🍽 Сегодня едим</h2>${brief.plan.length ? "" : `<button class="link" data-tab-go="week">Составить меню ›</button>`}</div>
      ${!brief.plan.length && !noRecipes ? hint("home-plan", "Меню на сегодня пока нет. Откройте <b>«Меню»</b> внизу и нажмите «Составить меню» — я подберу блюда на всю неделю.") : ""}
      ${MEAL_ORDER.map(slot).join("")}
    </div>

    <div class="grid-2 actions-grid">
      <button class="tile" data-action="add-recipe"><span class="tile-icon">🎙</span><b>Добавить рецепт</b><small>голосом, фото, ссылкой</small></button>
      <button class="tile" data-action="fridge"><span class="tile-icon">🧺</span><b>Что приготовить?</b><small>из того, что есть дома</small></button>
      <button class="tile" data-tab-go="week"><span class="tile-icon">🗓</span><b>Меню на неделю</b><small>подберу за вас</small></button>
      <button class="tile" data-tab-go="shop"><span class="tile-icon">🛒</span><b>Покупки</b><small>список по отделам</small></button>
    </div>

    ${
      missing.length && !noRecipes
        ? `<button class="card balance-mini" data-tab-go="balance">
            <h3>📊 На этой неделе не было</h3>
            <div class="miss">${missing.map((b) => `<span class="tag big">${b.emoji} ${esc(b.name)}</span>`).join("")}</div>
            <div class="link">Подобрать блюда ›</div>
          </button>`
        : ""
    }
    ${state.config.ai && !noRecipes ? `<button class="big-btn block" data-action="idea">✨ Придумай что-нибудь новенькое</button>` : ""}`;

  $$("[data-eat]", view).forEach(
    (b) => (b.onclick = () => openMarkEaten({ date, mealType: b.dataset.eat, planned: brief.plan.find((p) => p.meal_type === b.dataset.eat) })),
  );
  $$("[data-cook]", view).forEach((b) => (b.onclick = () => startCooking(recipeById(Number(b.dataset.cook)), state.config.settings.family_size)));
  $$("[data-open]", view).forEach((b) => (b.onclick = () => openRecipe(Number(b.dataset.open))));
  $$("[data-rate]", view).forEach(
    (b) =>
      (b.onclick = () =>
        guard(async () => {
          const [id, rating] = b.dataset.rate.split(":").map(Number);
          await api(`/meals/${id}/rate`, { method: "POST", body: { rating } });
          haptic();
          toast(rating === 2 ? "❤️ Запомнила — буду предлагать чаще" : rating > 0 ? "👍 Спасибо!" : "👎 Учту, буду предлагать реже");
          bus.render();
        })),
  );
}

// Кнопки-действия, которые встречаются на разных экранах.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const action = a.dataset.action;
  if (action === "add-recipe") openAddRecipe();
  else if (action === "fridge") openFridge();
  else if (action === "idea") openIdea();
});
