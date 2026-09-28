// Книга рецептов: список, карточка рецепта с пересчётом порций, редактор, режим готовки.
import { scaleAmount, servingsFactor } from "./amounts.js";
import {
  $, $$, api, backHandlers, bus, busy, cat, catEmojis, catOptions, chips, chipValues, closeSheet, confirmDialog, esc, guard, haptic, hint,
  loadRecipes, MEAL_ICONS, MEAL_ORDER, mealName, mealOptions, openSheet, prettyDate, recipeById, replaceSheet, sheetHead, state, tg, toast, addDays,
} from "./ui.js";
import { hasFamily, members, whoAteHtml, whoAteValue } from "./members.js";

const filter = { q: "", meal: "" };

// ---------- список ----------
export function renderRecipes(view) {
  const list = state.recipes.filter(
    (r) =>
      (!filter.meal || r.meal_types.includes(filter.meal)) &&
      (!filter.q || `${r.title} ${r.ingredients.map((i) => i.name).join(" ")}`.toLowerCase().includes(filter.q.toLowerCase())),
  );
  view.innerHTML = `
    <div class="page-head"><h1>📖 Рецепты <span class="muted">${state.recipes.length}</span></h1></div>
    ${hint("recipes", "Здесь все ваши рецепты. Нажмите на рецепт, чтобы посмотреть его, начать готовить или добавить в меню. Количество продуктов само пересчитывается на вашу семью.")}
    <button class="big-btn primary block" data-action="add-recipe">＋ Добавить рецепт</button>
    <div class="search"><input id="q" type="search" placeholder="🔍 Поиск: название или продукт" value="${esc(filter.q)}" /></div>
    <div class="chips scroll-x">
      ${[{ key: "", label: "Все" }, ...mealOptions()].map((o) => `<button class="chip ${filter.meal === o.key ? "on" : ""}" data-meal="${o.key}">${esc(o.label)}</button>`).join("")}
    </div>
    <div class="list" id="recipe-list">${
      list.length
        ? list.map(recipeRow).join("")
        : state.recipes.length
          ? `<div class="empty">Ничего не нашлось 🤷‍♀️</div>`
          : `<div class="empty"><div class="empty-icon">📖</div><b>Пока пусто</b><br>Нажмите «Добавить рецепт» — можно просто надиктовать голосом.</div>`
    }</div>`;
  const q = $("#q", view);
  q.oninput = () => {
    filter.q = q.value;
    const pos = q.selectionStart;
    renderRecipes(view);
    const nq = $("#q", view);
    nq.focus();
    nq.setSelectionRange(pos, pos);
  };
  $$("[data-meal]", view).forEach((c) => (c.onclick = () => ((filter.meal = c.dataset.meal), renderRecipes(view))));
  $$("[data-open]", view).forEach((el) => (el.onclick = () => openRecipe(Number(el.dataset.open))));
}

export function recipeRow(r, sub = "") {
  const meta = sub || [r.meal_types.map(mealName).join(", "), r.minutes ? `${r.minutes} мин` : ""].filter(Boolean).join(" · ");
  return `<button class="row-item" data-open="${r.id}">
    <span class="row-emoji">${catEmojis(r.categories.slice(0, 3)) || "🍽"}</span>
    <span class="row-main"><span class="row-title">${esc(r.title)}${r.likes >= 3 ? " ❤️" : ""}</span><span class="row-sub">${esc(meta)}</span></span>
    <span class="row-arrow">›</span></button>`;
}

// ---------- карточка рецепта ----------
function ingredientsHtml(r, servings) {
  const factor = servingsFactor(r.servings, servings);
  return `<ul class="ingredients">${r.ingredients
    .map((i) => `<li><span>${esc(i.name)}</span><b>${esc(scaleAmount(i.amount, factor))}</b></li>`)
    .join("")}</ul>`;
}

export function recipeBody(r, servings) {
  const tags = r.categories.map((k) => `<span class="tag">${esc(cat(k)?.emoji)} ${esc(cat(k)?.name)}</span>`).join("");
  return `
    <div class="meta-line">${esc([r.meal_types.map(mealName).join(", "), r.minutes ? `⏱ ${r.minutes} мин` : ""].filter(Boolean).join(" · "))}</div>
    <div class="tags">${tags}</div>
    ${r.prep_ahead ? `<div class="notice warn">⏰ <b>Подготовить заранее${r.prep_hours ? ` (за ${r.prep_hours} ч)` : ""}:</b> ${esc(r.prep_ahead)}</div>` : ""}
    ${(r.warnings || []).map((w) => `<div class="notice danger">⚠️ ${esc(w)}</div>`).join("")}
    ${
      r.ingredients.length
        ? `<div class="section-head"><h3>Продукты</h3>
            <div class="stepper" data-servings><button data-sv="-1" aria-label="Меньше">−</button><span><b id="sv">${servings}</b> порц.</span><button data-sv="1" aria-label="Больше">+</button></div>
          </div>
          <p class="muted small" id="sv-note">${servingsNote(r, servings)}</p>
          <div id="ingr">${ingredientsHtml(r, servings)}</div>`
        : ""
    }
    ${r.steps.length ? `<h3>Как готовить</h3><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
    ${r.notes ? `<h3>Заметки</h3><p class="notes">${esc(r.notes)}</p>` : ""}
    ${r.source_url ? `<p class="muted small">Источник: <a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(new URL(r.source_url).hostname)}</a></p>` : ""}`;
}

const servingsNote = (r, servings) =>
  r.servings && r.servings !== servings ? `В рецепте было на ${r.servings} — пересчитала на ${servings}` : r.servings ? "" : "Нажимайте − и +, чтобы пересчитать продукты";

/** Подключает кнопки «− / +» порций к карточке. */
export function bindServings(root, r, initial, onChange) {
  let servings = initial;
  $$("[data-sv]", root).forEach(
    (b) =>
      (b.onclick = () => {
        servings = Math.max(1, Math.min(30, servings + Number(b.dataset.sv)));
        $("#sv", root).textContent = servings;
        $("#ingr", root).innerHTML = ingredientsHtml(r, servings);
        $("#sv-note", root).textContent = servingsNote(r, servings);
        haptic("light");
        onChange?.(servings);
      }),
  );
}

export function openRecipe(id, { push = true } = {}) {
  const r = recipeById(id);
  if (!r) return toast("Рецепт не найден");
  let servings = state.config.settings.family_size;
  const html = `${sheetHead(esc(r.title))}
    ${recipeBody(r, servings)}
    <div class="actions">
      ${r.steps.length ? `<button class="big-btn primary block" id="cook">👩‍🍳 Начать готовить</button>` : ""}
      <button class="big-btn block" id="ate">✅ Отметить, что съели</button>
      <button class="big-btn block" id="to-plan">🗓 Добавить в меню</button>
      <div class="row-btns"><button class="btn secondary grow" id="edit">✏️ Изменить</button><button class="btn danger-outline" id="del">🗑 Удалить</button></div>
    </div>`;
  const mount = (root) => {
    bindServings(root, r, servings, (s) => (servings = s));
    const cook = $("#cook", root);
    if (cook) cook.onclick = () => startCooking(r, servings);
    $("#ate", root).onclick = () => openMarkEaten({ date: state.config.today, recipe: r });
    $("#to-plan", root).onclick = () => openAddToPlan(r);
    $("#edit", root).onclick = () => openEditor(r);
    $("#del", root).onclick = async () => {
      if (!(await confirmDialog(`Удалить рецепт «${r.title}»? Его нельзя будет вернуть.`))) return;
      guard(async () => {
        await api(`/recipes/${r.id}`, { method: "DELETE" });
        await loadRecipes();
        closeSheet();
        toast("Рецепт удалён");
        bus.render();
      });
    };
  };
  push ? openSheet(html, mount) : replaceSheet(html, mount);
}

// ---------- отметить «съели» ----------
export function currentMealGuess() {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 18 ? "snack" : "dinner";
}

export function shortDay(d) {
  const t = state.config.today;
  if (d === t) return "Сегодня";
  if (d === addDays(t, 1)) return "Завтра";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", timeZone: "UTC" });
}
/**
 * Шторка «Что ели?». Если передан recipe — сразу спрашиваем только приём пищи.
 * Иначе (с главной) — выбор блюда для конкретного приёма пищи.
 */
/**
 * Отметить «съели».
 * - recipe: из карточки рецепта — спрашиваем приём пищи и кто ел;
 * - planned: блюдо из меню — подтверждение «кто ел» (или «ели другое»);
 * - иначе: выбор блюда для приёма пищи.
 * whoDefault — кого отметить заранее (например, тех, кто ещё не ел в этот приём).
 */
export async function openMarkEaten({ date, mealType = null, recipe = null, planned = null, picker = false, whoDefault = null }) {
  const leftoversOk = (mt) => mt === "lunch" || mt === "dinner";
  const save = (payload, mt) =>
    guard(async () => {
      const root = $("#sheet-body");
      const eaters = whoAteValue(root);
      const leftovers = $("#leftovers", root)?.checked;
      await api("/meals", { method: "POST", body: { date, meal_type: mt, ...payload, leftovers, eaters } });
      haptic();
      closeSheet();
      const partial = eaters && hasFamily() && eaters.length < members().length;
      toast(leftovers ? "Отмечено! Завтра в меню — доедаем 🍲" : partial ? "Отмечено ✅ Остальные ели другое? Нажмите «＋ другое блюдо»" : "Отмечено ✅ Приятного аппетита!", 4000);
      bus.render();
    });

  const leftoversBox = (mt) =>
    leftoversOk(mt)
      ? `<label class="check-row"><input type="checkbox" id="leftovers" /> <span>🍲 Приготовила с запасом — <b>доедим завтра</b><br><small class="muted">поставлю это блюдо в меню на завтра</small></span></label>`
      : "";

  if (recipe) {
    const guess = recipe.meal_types.includes(currentMealGuess()) ? currentMealGuess() : recipe.meal_types[0] || currentMealGuess();
    openSheet(
      `${sheetHead(`✅ Съели «${esc(recipe.title)}»`)}
       <p class="muted">${esc(prettyDate(date))}</p>
       <h3>Какой это был приём пищи?</h3>
       ${chips(mealOptions(), [guess], "mt", true)}
       ${whoAteHtml(whoDefault)}
       <label class="check-row"><input type="checkbox" id="leftovers" /> <span>🍲 Приготовила с запасом — <b>доедим завтра</b><br><small class="muted">поставлю это блюдо в меню на завтра</small></span></label>
       <button class="big-btn primary block" id="go">✅ Отметить</button>`,
      (root) => {
        $("#go", root).onclick = () => save({ recipe_id: recipe.id }, chipValues(root, "mt")[0] || guess);
      },
    );
    return;
  }

  // Блюдо из меню: одно подтверждение — «кто ел».
  if (planned && !picker) {
    openSheet(
      `${sheetHead(`${MEAL_ICONS[mealType]} ${esc(mealName(mealType))}`)}
       <div class="slot-big">${esc(planned.title)}</div>
       ${whoAteHtml(whoDefault)}
       ${leftoversBox(mealType)}
       <button class="big-btn primary block" id="go">✅ Отметить, что съели</button>
       <button class="big-btn block" id="other">Ели другое блюдо ›</button>`,
      (root) => {
        $("#go", root).onclick = () => save(planned.recipe_id ? { recipe_id: planned.recipe_id } : { title: planned.title }, mealType);
        $("#other", root).onclick = () => openMarkEaten({ date, mealType, planned, picker: true, whoDefault });
      },
    );
    return;
  }

  const title = `${MEAL_ICONS[mealType]} ${esc(mealName(mealType))}: что ели?`;
  openSheet(`${sheetHead(title)}<div class="empty"><span class="spinner"></span></div>`);
  const suggestions = (await guard(() => api(`/suggest?meal=${mealType}&date=${date}`))) || [];
  const plannedRecipe = planned?.recipe_id ? recipeById(planned.recipe_id) : null;
  const shownIds = new Set([plannedRecipe?.id, ...suggestions.slice(0, 4).map((s) => s.recipe.id)]);
  const others = state.recipes.filter((r) => !shownIds.has(r.id));
  const pickRow = (r, sub) => `<button class="row-item" data-pick="${r.id}"><span class="row-emoji">${catEmojis(r.categories.slice(0, 3)) || "🍽"}</span>
      <span class="row-main"><span class="row-title">${esc(r.title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ""}</span></button>`;
  replaceSheet(
    `${sheetHead(title)}
     ${whoAteHtml(whoDefault)}
     ${leftoversBox(mealType)}
     <h3>Выберите блюдо</h3>
     ${plannedRecipe ? `<div class="list">${pickRow(plannedRecipe, "по меню")}</div>` : planned ? `<div class="list"><button class="row-item" data-free-title="${esc(planned.title)}"><span class="row-emoji">🍽</span><span class="row-main"><span class="row-title">${esc(planned.title)}</span><span class="row-sub">по меню</span></span></button></div>` : ""}
     ${suggestions.length ? `<h3>Подходит сейчас</h3><div class="list">${suggestions.slice(0, 4).filter((s) => s.recipe.id !== plannedRecipe?.id).map((s) => pickRow(s.recipe, s.reasons.slice(0, 1).join(""))).join("")}</div>` : ""}
     ${others.length ? `<h3>Все рецепты</h3><input id="pick-q" type="search" placeholder="🔍 Поиск…" /><div class="list" id="pick-list">${others.map((r) => pickRow(r)).join("")}</div>` : ""}
     <h3>Другое блюдо</h3>
     <p class="muted small">Если блюда нет в книге — просто напишите его название</p>
     <div class="inline-form"><input id="free-title" placeholder="Например: пельмени с рыбой" /><button class="btn primary" id="free-save">OK</button></div>`,
    (root) => {
      $$("[data-pick]", root).forEach((el) => (el.onclick = () => save({ recipe_id: Number(el.dataset.pick) }, mealType)));
      $$("[data-free-title]", root).forEach((el) => (el.onclick = () => save({ title: el.dataset.freeTitle }, mealType)));
      $("#free-save", root).onclick = () => {
        const t = $("#free-title", root).value.trim();
        if (!t) return toast("Напишите, что ели");
        save({ title: t }, mealType);
      };
      const q = $("#pick-q", root);
      if (q)
        q.oninput = () => {
          const v = q.value.toLowerCase();
          $$("#pick-list [data-pick]", root).forEach((el) => (el.style.display = el.textContent.toLowerCase().includes(v) ? "" : "none"));
        };
    },
  );
}

// ---------- в меню ----------
export function openAddToPlan(r) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.config.today, i));
  openSheet(
    `${sheetHead(`В меню: «${esc(r.title)}»`)}
     <h3>Какой день?</h3>
     ${chips(days.map((d) => ({ key: d, label: shortDay(d) })), [days[0]], "day", true)}
     <h3>Какой приём пищи?</h3>
     ${chips(mealOptions(), [r.meal_types[0] || "lunch"], "mt", true)}
     ${whoAteHtml(null, { title: "Для кого?", note: "Снимите тех, кому будет другое блюдо" })}
     <button class="big-btn primary block" id="go">🗓 Добавить в меню</button>`,
    (root) => {
      $("#go", root).onclick = () =>
        guard(async () => {
          const [date] = chipValues(root, "day");
          const [meal_type] = chipValues(root, "mt");
          const eaters = whoAteValue(root, "Отметьте, для кого это блюдо");
          await api("/plan", { method: "PUT", body: { date, meal_type, recipe_id: r.id, eaters } });
          haptic();
          closeSheet();
          toast(`Добавлено в меню: ${shortDay(date)}, ${mealName(meal_type).toLowerCase()}`);
          bus.render();
        });
    },
  );
}

// ---------- редактор ----------
export function openEditor(r = null, { title } = {}) {
  const v = r || { title: "", meal_types: [], categories: [], ingredients: [], steps: [], notes: "", minutes: null, servings: null, prep_ahead: "", prep_hours: null, warnings: [] };
  const isNew = !v.id;
  openSheet(
    `${sheetHead(title || (isNew ? "Проверьте рецепт" : "Изменить рецепт"))}
     ${isNew && (v.source && v.source !== "manual") ? `<div class="notice ok">✨ Я оформила рецепт. Проверьте и нажмите «Сохранить» внизу.</div>` : ""}
     <label>Название блюда</label><input id="f-title" value="${esc(v.title)}" placeholder="Например: Суп из чечевицы" />
     <label>Когда едим</label>${chips(mealOptions(), v.meal_types, "f-meals")}
     <label>Продукты — каждый с новой строки <small>(количество через тире: «Морковь — 2 шт»)</small></label>
     <textarea id="f-ingr" rows="7" placeholder="Чечевица — 200 г&#10;Морковь — 2 шт&#10;Лук — 1 шт">${esc(v.ingredients.map((i) => (i.amount ? `${i.name} — ${i.amount}` : i.name)).join("\n"))}</textarea>
     <div class="grid-2">
       <div><label>На сколько порций</label><input id="f-serv" type="number" inputmode="numeric" value="${v.servings ?? ""}" placeholder="${state.config.settings.family_size}" /></div>
       <div><label>Время, мин</label><input id="f-min" type="number" inputmode="numeric" value="${v.minutes ?? ""}" placeholder="30" /></div>
     </div>
     <label>Как готовить — каждый шаг с новой строки</label>
     <textarea id="f-steps" rows="7" placeholder="Промыть чечевицу&#10;Обжарить лук и морковь 5 мин&#10;Варить 20 мин">${esc(v.steps.join("\n"))}</textarea>
     <label>⏰ Что сделать заранее <small>(замочить, разморозить) — я напомню</small></label>
     <div class="grid-2x"><input id="f-prep" value="${esc(v.prep_ahead)}" placeholder="Замочить нут на ночь" /><input id="f-prep-h" type="number" inputmode="numeric" value="${v.prep_hours ?? ""}" placeholder="часов" /></div>
     <details ${v.categories.length ? "" : "open"}><summary>Что в блюде (для баланса питания)</summary>
       <p class="muted small">Если не отметить — определю сама по продуктам</p>${chips(catOptions(), v.categories, "f-cats")}</details>
     <label>Заметки</label><textarea id="f-notes" rows="3" placeholder="Например: детям без лука">${esc(v.notes)}</textarea>
     <button class="big-btn primary block" id="save">💾 Сохранить рецепт</button>`,
    (root) => {
      $("#save", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Сохраняю…", async () => {
            const body = {
              title: $("#f-title", root).value,
              meal_types: chipValues(root, "f-meals"),
              categories: chipValues(root, "f-cats"),
              ingredients: $("#f-ingr", root)
                .value.split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => {
                  const [name, ...amount] = l.split(/\s+[—–-]\s+/);
                  return { name, amount: amount.join(" — ") || undefined };
                }),
              steps: $("#f-steps", root).value.split("\n"),
              minutes: Number($("#f-min", root).value) || null,
              servings: Number($("#f-serv", root).value) || null,
              prep_ahead: $("#f-prep", root).value,
              prep_hours: Number($("#f-prep-h", root).value) || null,
              notes: $("#f-notes", root).value,
              warnings: v.warnings || [],
              source: v.source || "manual",
              source_url: v.source_url || undefined,
            };
            if (!body.title.trim()) throw new Error("Напишите название блюда");
            const saved = isNew ? await api("/recipes", { method: "POST", body }) : await api(`/recipes/${v.id}`, { method: "PUT", body });
            haptic();
            await loadRecipes();
            toast(isNew ? "Рецепт сохранён в книгу 📖" : "Сохранено");
            closeSheet();
            bus.render();
            // В мастере первого запуска сразу возвращаемся к списку — можно диктовать следующий.
            if (!state.setupActive) openRecipe(saved.id);
          }),
        );
    },
  );
}

// ---------- режим готовки ----------
let wakeLock = null;

export function startCooking(r, servings) {
  const overlay = $("#cook-overlay");
  const factor = servingsFactor(r.servings, servings);
  const pages = [{ kind: "ingredients" }, ...r.steps.map((s, i) => ({ kind: "step", text: s, n: i + 1 })), { kind: "done" }];
  let page = 0;
  const timers = new Map();

  const close = () => {
    overlay.classList.add("hidden");
    backHandlers.pop();
    for (const t of timers.values()) clearInterval(t.interval);
    try {
      wakeLock?.release();
      tg?.disableClosingConfirmation?.();
    } catch {}
    wakeLock = null;
  };

  const timerButtons = (text) => {
    const found = [...text.matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?\s*(мин|час|ч\b)/gi)];
    return found
      .map((m) => {
        const mins = Number(m[2] || m[1]) * (m[3].toLowerCase().startsWith("ч") ? 60 : 1);
        return mins > 0 && mins <= 600 ? `<button class="big-btn timer-btn" data-timer="${mins}">⏱ Таймер ${mins >= 60 && mins % 60 === 0 ? `${mins / 60} ч` : `${mins} мин`}</button>` : "";
      })
      .join("");
  };

  const render = () => {
    const p = pages[page];
    let body;
    if (p.kind === "ingredients")
      body = `<div class="cook-label">Сначала приготовьте продукты (на ${servings} порц.)</div>
        ${r.prep_ahead ? `<div class="notice warn">⏰ ${esc(r.prep_ahead)}</div>` : ""}
        <ul class="cook-ingr">${r.ingredients.map((i) => `<li><label><input type="checkbox" /> <span>${esc(i.name)}</span> <b>${esc(scaleAmount(i.amount, factor))}</b></label></li>`).join("")}</ul>`;
    else if (p.kind === "step")
      body = `<div class="cook-label">Шаг ${p.n} из ${r.steps.length}</div><div class="cook-step">${esc(p.text)}</div><div class="timers">${timerButtons(p.text)}</div>`;
    else
      body = `<div class="cook-done">🎉</div><div class="cook-step center">Готово! Приятного аппетита!</div>
        <p class="center muted">Отметить, что ели?</p>
        <div class="grid-2">${MEAL_ORDER.map((k) => `<button class="big-btn" data-eat="${k}">${MEAL_ICONS[k]} ${esc(mealName(k))}</button>`).join("")}</div>`;
    overlay.innerHTML = `
      <div class="cook-top"><button class="btn secondary" id="cook-close">✕ Закрыть</button><div class="cook-title">${esc(r.title)}</div></div>
      <div class="cook-progress"><i style="width:${Math.round((page / (pages.length - 1)) * 100)}%"></i></div>
      <div class="cook-body">${body}</div>
      <div id="timer-bar">${[...timers.values()].map((t) => t.html()).join("")}</div>
      <div class="cook-nav">
        <button class="big-btn" id="prev" ${page === 0 ? "disabled" : ""}>← Назад</button>
        ${page < pages.length - 1 ? `<button class="big-btn primary" id="next">${page === 0 ? "Начать →" : "Дальше →"}</button>` : `<button class="big-btn primary" id="finish">Закрыть</button>`}
      </div>`;
    $("#cook-close", overlay).onclick = close;
    $("#prev", overlay).onclick = () => (page--, haptic("light"), render());
    const next = $("#next", overlay);
    if (next) next.onclick = () => (page++, haptic("light"), render());
    const fin = $("#finish", overlay);
    if (fin) fin.onclick = close;
    $$("[data-timer]", overlay).forEach((b) => (b.onclick = () => startTimer(Number(b.dataset.timer))));
    $$("[data-eat]", overlay).forEach(
      (b) =>
        (b.onclick = () =>
          guard(async () => {
            await api("/meals", { method: "POST", body: { date: state.config.today, meal_type: b.dataset.eat, recipe_id: r.id } });
            haptic();
            toast("Отмечено ✅");
            close();
            closeSheet();
            bus.render();
          })),
    );
  };

  const startTimer = (mins) => {
    const id = Date.now();
    const end = Date.now() + mins * 60_000;
    const t = {
      html: () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const mm = String(Math.floor(left / 60)).padStart(2, "0");
        const ss = String(left % 60).padStart(2, "0");
        return `<div class="timer ${left === 0 ? "ring" : ""}">⏱ ${left === 0 ? "Время вышло!" : `${mm}:${ss}`}<button class="link" data-stop="${id}">✕</button></div>`;
      },
      interval: setInterval(() => {
        const bar = $("#timer-bar", overlay);
        if (bar) bar.innerHTML = [...timers.values()].map((x) => x.html()).join("");
        $$("[data-stop]", overlay).forEach((b) => (b.onclick = () => (clearInterval(timers.get(Number(b.dataset.stop))?.interval), timers.delete(Number(b.dataset.stop)), render())));
        if (Date.now() >= end && !t.rang) {
          t.rang = true;
          beep();
          haptic("warning");
          try {
            navigator.vibrate?.([400, 200, 400, 200, 400]);
          } catch {}
        }
      }, 1000),
    };
    timers.set(id, t);
    toast(`Таймер на ${mins} мин запущен`);
    render();
  };

  overlay.classList.remove("hidden");
  backHandlers.push(close);
  tg?.BackButton?.show();
  try {
    tg?.enableClosingConfirmation?.();
    navigator.wakeLock?.request("screen").then((l) => (wakeLock = l)).catch(() => {});
  } catch {}
  render();
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.5, 1].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.3, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.4);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    });
  } catch {}
}
