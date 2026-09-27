// Меню на неделю: составить одной кнопкой, заменить блюдо, собрать покупки.
import { openRecipe, recipeRow, shortDay, startCooking } from "./recipes.js";
import {
  $, $$, addDays, api, bus, busy, catEmojis, closeSheet, confirmDialog, esc, guard, haptic, hint, MEAL_ICONS, MEAL_ORDER, mealName, openSheet,
  prettyDate, recipeById, replaceSheet, sheetHead, state, toast,
} from "./ui.js";

export async function renderWeek(view) {
  const start = state.config.today;
  const end = addDays(start, 6);
  const plan = await api(`/plan?from=${start}&to=${end}`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const few = state.recipes.length < 6;

  view.innerHTML = `
    <div class="page-head"><h1>🗓 Меню на неделю</h1></div>
    ${hint("week", "Нажмите зелёную кнопку <b>✨</b> — я подберу блюда из ваших рецептов на 7 дней так, чтобы было разнообразно. Не нравится блюдо — нажмите на него и выберите «Заменить».")}
    ${few ? `<div class="notice">Чем больше рецептов в книге, тем разнообразнее меню. Сейчас их ${state.recipes.length} — добавьте ещё несколько. <button class="link" data-action="add-recipe">Добавить ›</button></div>` : ""}
    <div class="row-btns">
      <button class="big-btn primary grow" id="fill">✨ ${plan.length ? "Дополнить меню" : "Составить меню"}</button>
      ${plan.length ? `<button class="big-btn" id="redo">🔄 Заново</button>` : ""}
    </div>
    ${plan.length ? `<button class="big-btn block" id="to-shop">🛒 Собрать список покупок</button>` : ""}
    ${days
      .map((d) => {
        const items = plan.filter((p) => p.date === d);
        return `<div class="card day">
          <h3>${esc(prettyDate(d))}</h3>
          ${MEAL_ORDER.map((k) => {
            const p = items.find((x) => x.meal_type === k);
            const r = p?.recipe_id ? recipeById(p.recipe_id) : null;
            return `<button class="plan-row ${p ? "" : "empty"}" data-slot="${d}|${k}">
              <span class="plan-meal">${MEAL_ICONS[k]} ${esc(mealName(k))}</span>
              <span class="plan-dish">${p ? `${catEmojis(r?.categories?.slice(0, 2))} ${esc(p.title)}${p.leftovers ? ' <span class="badge">доедаем</span>' : ""}${r?.prep_ahead ? `<span class="prep">⏰ ${esc(r.prep_ahead)}</span>` : ""}` : "＋ выбрать"}</span>
            </button>`;
          }).join("")}
        </div>`;
      })
      .join("")}`;

  const fill = (replace) => (e) =>
    guard(() =>
      busy(e.currentTarget, "Подбираю…", async () => {
        if (!state.recipes.length) throw new Error("Сначала добавьте рецепты в книгу");
        const res = await api("/plan/fill", { method: "POST", body: { start, days: 7, replace } });
        haptic();
        toast(res.length ? "Меню готово! Нажмите на блюдо, чтобы заменить" : "Не нашла подходящих рецептов — добавьте ещё");
        bus.render();
      }),
    );
  $("#fill", view).onclick = fill(false);
  const redo = $("#redo", view);
  if (redo)
    redo.onclick = async (e) => {
      const btn = e.currentTarget;
      if (await confirmDialog("Составить меню на неделю заново? Текущее меню заменится.")) fill(true)({ currentTarget: btn });
    };
  const shop = $("#to-shop", view);
  if (shop)
    shop.onclick = (e) =>
      guard(() =>
        busy(e.currentTarget, "Собираю…", async () => {
          const res = await api("/shopping/from-plan", { method: "POST", body: { from: start, to: end } });
          haptic();
          toast(`Готово: ${res.count} продуктов в списке покупок`);
          bus.go("shop");
        }),
      );
  $$("[data-slot]", view).forEach((b) => {
    b.onclick = () => {
      const [date, mt] = b.dataset.slot.split("|");
      openSlot(date, mt, plan.find((p) => p.date === date && p.meal_type === mt));
    };
  });
}

export function openSlot(date, mealType, item) {
  const r = item?.recipe_id ? recipeById(item.recipe_id) : null;
  const title = `${MEAL_ICONS[mealType]} ${esc(mealName(mealType))}, ${esc(shortDay(date).toLowerCase())}`;
  if (!item) return openPickForPlan(date, mealType, title);
  openSheet(
    `${sheetHead(title)}
     <div class="slot-big">${esc(item.title)}${item.leftovers ? ' <span class="badge">доедаем</span>' : ""}</div>
     ${r?.prep_ahead ? `<div class="notice warn">⏰ Заранее: ${esc(r.prep_ahead)}</div>` : ""}
     <div class="actions">
       ${r ? `<button class="big-btn block" id="open">📖 Открыть рецепт</button>` : ""}
       ${r?.steps.length ? `<button class="big-btn block" id="cook">👩‍🍳 Начать готовить</button>` : ""}
       <button class="big-btn primary block" id="swap">🔄 Заменить на другое</button>
       <button class="big-btn block" id="pick">📋 Выбрать самой</button>
       <button class="btn danger-outline block" id="remove">Убрать из меню</button>
     </div>`,
    (root) => {
      if (r) $("#open", root).onclick = () => openRecipe(r.id);
      const cook = $("#cook", root);
      if (cook) cook.onclick = () => startCooking(r, state.config.settings.family_size);
      $("#swap", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Подбираю…", async () => {
            const next = await api("/plan/swap", { method: "POST", body: { date, meal_type: mealType } });
            haptic();
            toast(`Заменила на «${next.title}»`);
            closeSheet();
            bus.render();
          }),
        );
      $("#pick", root).onclick = () => openPickForPlan(date, mealType, title);
      $("#remove", root).onclick = () =>
        guard(async () => {
          await api(`/plan/${item.id}`, { method: "DELETE" });
          closeSheet();
          bus.render();
        });
    },
  );
}

async function openPickForPlan(date, mealType, title) {
  openSheet(`${sheetHead(title)}<div class="empty"><span class="spinner"></span></div>`);
  const suggestions = (await guard(() => api(`/suggest?meal=${mealType}&date=${date}`))) || [];
  const shown = new Set(suggestions.slice(0, 4).map((s) => s.recipe.id));
  const others = state.recipes.filter((r) => !shown.has(r.id));
  replaceSheet(
    `${sheetHead(title)}
     ${suggestions.length ? `<h3>Советую</h3><div class="list">${suggestions.slice(0, 4).map((s) => recipeRow(s.recipe, s.reasons.slice(0, 1).join(""))).join("")}</div>` : ""}
     ${others.length ? `<h3>Все рецепты</h3><input id="pq" type="search" placeholder="🔍 Поиск…" /><div class="list" id="pl">${others.map((r) => recipeRow(r)).join("")}</div>` : ""}
     ${!state.recipes.length ? `<div class="empty">В книге пока нет рецептов.<br><button class="big-btn primary" data-action="add-recipe">Добавить рецепт</button></div>` : ""}`,
    (root) => {
      $$("[data-open]", root).forEach(
        (el) =>
          (el.onclick = () =>
            guard(async () => {
              await api("/plan", { method: "PUT", body: { date, meal_type: mealType, recipe_id: Number(el.dataset.open) } });
              haptic();
              closeSheet();
              toast("Добавлено в меню");
              bus.render();
            })),
      );
      const q = $("#pq", root);
      if (q)
        q.oninput = () => {
          const s = q.value.toLowerCase();
          $$("#pl [data-open]", root).forEach((el) => (el.style.display = el.textContent.toLowerCase().includes(s) ? "" : "none"));
        };
    },
  );
}

