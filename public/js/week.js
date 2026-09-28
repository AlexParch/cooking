// Меню на неделю: составить одной кнопкой, заменить блюдо, собрать покупки.
import { eatersBadge, hasFamily, members, uncovered, whoAteHtml, whoAteValue } from "./members.js";
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
    ${hint("week", `Нажмите зелёную кнопку <b>✨</b> — я подберу блюда из ваших рецептов на 7 дней так, чтобы было разнообразно. Не нравится блюдо — нажмите на него и выберите «Заменить».${hasFamily() ? " Если кому-то нужно своё блюдо — нажмите на блюдо и выберите <b>«Кому-то другое блюдо»</b>." : ""}`)}
    ${few ? `<div class="notice">Чем больше рецептов в книге, тем разнообразнее меню. Сейчас их ${state.recipes.length} — добавьте ещё несколько. <button class="link" data-action="add-recipe">Добавить ›</button></div>` : ""}
    <div class="row-btns">
      <button class="big-btn primary grow" id="fill">✨ ${plan.length ? "Дополнить меню" : "Составить меню"}</button>
      ${plan.length ? `<button class="big-btn" id="redo">🔄 Заново</button>` : ""}
    </div>
    ${plan.length ? `<button class="big-btn block" id="to-shop">🛒 Собрать список покупок</button>` : ""}
    ${days.map((d) => `<div class="card day"><h3>${esc(prettyDate(d))}</h3>${MEAL_ORDER.map((k) => planCellHtml(plan, d, k)).join("")}</div>`).join("")}`;

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
  bindPlanCells(view, plan);
}

/**
 * Клетка меню (день + приём пищи). Обычно одно блюдо на всех,
 * но у членов семьи могут быть разные блюда — тогда каждое со своими аватарками.
 */
export function planCellHtml(plan, date, k, compact = false) {
  const items = plan.filter((p) => p.date === date && p.meal_type === k);
  const label = `<span class="plan-meal">${MEAL_ICONS[k]}${compact ? "" : ` ${esc(mealName(k))}`}</span>`;
  if (!items.length) return `<button class="plan-row empty ${compact ? "small" : ""}" data-slot="${date}|${k}">${label}<span class="plan-dish">＋ выбрать</span></button>`;
  const rest = uncovered(items);
  return `<div class="plan-row plan-cell ${compact ? "small" : ""}">${label}<div class="plan-dishes">
    ${items
      .map((p) => {
        const r = p.recipe_id ? recipeById(p.recipe_id) : null;
        return `<button class="plan-dish" data-plan="${p.id}">${compact ? "" : `${catEmojis(r?.categories?.slice(0, 2))} `}${esc(p.title)}${p.leftovers ? ' <span class="badge">доедаем</span>' : ""}${eatersBadge(p.eaters)}${!compact && r?.prep_ahead ? `<span class="prep">⏰ ${esc(r.prep_ahead)}</span>` : ""}</button>`;
      })
      .join("")}
    ${rest.length ? `<button class="plan-dish empty" data-slot="${date}|${k}" data-for="${rest.map((m) => m.id).join(",")}">＋ ${esc(rest.map((m) => m.name).join(", "))} — выбрать</button>` : ""}
  </div></div>`;
}

export function bindPlanCells(view, plan) {
  $$("[data-slot]", view).forEach((b) => {
    b.onclick = () => {
      const [date, mt] = b.dataset.slot.split("|");
      openPickForPlan(date, mt, slotTitle(date, mt), { eaters: b.dataset.for ? b.dataset.for.split(",").map(Number) : undefined });
    };
  });
  $$("[data-plan]", view).forEach((b) => {
    b.onclick = () => {
      const item = plan.find((p) => p.id === Number(b.dataset.plan));
      openSlot(item, plan.filter((p) => p.date === item.date && p.meal_type === item.meal_type));
    };
  });
}

const slotTitle = (date, mealType) => `${MEAL_ICONS[mealType]} ${esc(mealName(mealType))}, ${esc(shortDay(date).toLowerCase())}`;

/** Блюдо в меню: рецепт, готовить, заменить, «кому-то другое», убрать. `cell` — все блюда этой клетки. */
export function openSlot(item, cell = [item]) {
  const { date, meal_type: mealType } = item;
  const r = item.recipe_id ? recipeById(item.recipe_id) : null;
  const title = slotTitle(date, mealType);
  const split = cell.length > 1 || Boolean(item.eaters?.length);
  openSheet(
    `${sheetHead(title)}
     <div class="slot-big">${esc(item.title)}${item.leftovers ? ' <span class="badge">доедаем</span>' : ""}</div>
     ${eatersBadge(item.eaters, "Для: ")}
     ${r?.prep_ahead ? `<div class="notice warn">⏰ Заранее: ${esc(r.prep_ahead)}</div>` : ""}
     <div class="actions">
       ${r ? `<button class="big-btn block" id="open">📖 Открыть рецепт</button>` : ""}
       ${r?.steps.length ? `<button class="big-btn block" id="cook">👩‍🍳 Начать готовить</button>` : ""}
       <button class="big-btn primary block" id="swap">🔄 Заменить на другое</button>
       <button class="big-btn block" id="pick">📋 Выбрать самой</button>
       ${hasFamily() ? `<button class="big-btn block" id="split">👥 Кому-то другое блюдо</button>` : ""}
       ${split ? `<button class="big-btn block" id="all">👨‍👩‍👧‍👦 Это блюдо — всем</button>` : ""}
       <button class="btn danger-outline block" id="remove">Убрать из меню</button>
     </div>`,
    (root) => {
      if (r) $("#open", root).onclick = () => openRecipe(r.id);
      const cook = $("#cook", root);
      if (cook) cook.onclick = () => startCooking(r, item.eaters?.length || state.config.settings.family_size);
      $("#swap", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Подбираю…", async () => {
            const next = await api("/plan/swap", { method: "POST", body: { date, meal_type: mealType, id: item.id } });
            haptic();
            toast(`Заменила на «${next.title}»`);
            closeSheet();
            bus.render();
          }),
        );
      $("#pick", root).onclick = () => openPickForPlan(date, mealType, title, { id: item.id, eaters: item.eaters, exclude: [item.recipe_id] });
      const splitBtn = $("#split", root);
      if (splitBtn) splitBtn.onclick = () => openSplit(date, mealType, title, cell.map((p) => p.recipe_id));
      const all = $("#all", root);
      if (all)
        all.onclick = () =>
          guard(async () => {
            await api("/plan", { method: "PUT", body: { id: item.id, date, meal_type: mealType, recipe_id: item.recipe_id, title: item.title, leftovers: item.leftovers, eaters: null } });
            haptic();
            closeSheet();
            toast("Теперь это блюдо для всей семьи");
            bus.render();
          });
      $("#remove", root).onclick = () =>
        guard(async () => {
          await api(`/plan/${item.id}`, { method: "DELETE" });
          closeSheet();
          bus.render();
        });
    },
  );
}

/** Кому приготовить другое блюдо — потом выбор блюда только для них. */
function openSplit(date, mealType, title, exclude) {
  replaceSheet(
    `${sheetHead(title)}
     ${whoAteHtml([], { title: "Кому другое блюдо?", note: "Отметьте, для кого приготовить отдельно. Остальным останется это блюдо" })}
     <button class="big-btn primary block" id="next">Выбрать блюдо ›</button>`,
    (root) => {
      $("#next", root).onclick = () =>
        guard(() => {
          const eaters = whoAteValue(root, "Отметьте, кому нужно другое блюдо") ?? members().map((m) => m.id);
          openPickForPlan(date, mealType, title, { eaters, exclude });
        });
    },
  );
}

/**
 * Выбор блюда в меню.
 * `id` — заменить это блюдо (для тех же людей); `eaters` — новое блюдо только для этих членов семьи;
 * `exclude` — рецепты, которые уже стоят в этой клетке: их не советуем.
 */
async function openPickForPlan(date, mealType, title, { id, eaters, exclude = [] } = {}) {
  openSheet(`${sheetHead(title)}<div class="empty"><span class="spinner"></span></div>`);
  // Блюдо для одного человека — советуем по его балансу.
  const member = eaters?.length === 1 ? `&member=${eaters[0]}` : "";
  const suggestions = ((await guard(() => api(`/suggest?meal=${mealType}&date=${date}${member}`))) || []).filter((s) => !exclude.includes(s.recipe.id));
  const shown = new Set(suggestions.slice(0, 4).map((s) => s.recipe.id));
  const others = state.recipes.filter((r) => !shown.has(r.id));
  replaceSheet(
    `${sheetHead(title)}
     ${eatersBadge(eaters, "Для: ")}
     ${suggestions.length ? `<h3>Советую</h3><div class="list">${suggestions.slice(0, 4).map((s) => recipeRow(s.recipe, s.reasons.slice(0, 1).join(""))).join("")}</div>` : ""}
     ${others.length ? `<h3>Все рецепты</h3><input id="pq" type="search" placeholder="🔍 Поиск…" /><div class="list" id="pl">${others.map((r) => recipeRow(r)).join("")}</div>` : ""}
     ${!state.recipes.length ? `<div class="empty">В книге пока нет рецептов.<br><button class="big-btn primary" data-action="add-recipe">Добавить рецепт</button></div>` : ""}`,
    (root) => {
      $$("[data-open]", root).forEach(
        (el) =>
          (el.onclick = () =>
            guard(async () => {
              await api("/plan", { method: "PUT", body: { id, date, meal_type: mealType, recipe_id: Number(el.dataset.open), eaters: id ? undefined : eaters } });
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

