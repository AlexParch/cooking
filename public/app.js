"use strict";
// WebApp «Наша кухня»: без сборки, чистый JS.

const tg = window.Telegram?.WebApp;
if (tg?.initData) {
  document.documentElement.classList.add("tg");
  tg.ready();
  tg.expand();
}

const state = {
  config: null,
  recipes: [],
  tab: "today",
  date: null,
  recipeFilter: { q: "", meal: "" },
  ideaMeal: "",
};

const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];

// ---------- утилиты ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cat = (key) => state.config.categories.find((c) => c.key === key);
const catEmojis = (keys) => (keys || []).map((k) => cat(k)?.emoji || "").join("");
const mealName = (k) => state.config.mealTypes[k] || k;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "content-type": "application/json", "X-Telegram-Init-Data": tg?.initData || "", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add("hidden"), 2500);
}

function haptic(type = "success") {
  tg?.HapticFeedback?.notificationOccurred?.(type);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    haptic("error");
    toast(e.message || String(e));
  }
}

function addDays(date, delta) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function prettyDate(date) {
  const t = state.config.today;
  if (date === t) return "Сегодня";
  if (date === addDays(t, -1)) return "Вчера";
  if (date === addDays(t, 1)) return "Завтра";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
}

function chips(options, selected, name) {
  return `<div class="chips" data-chips="${name}">${options
    .map((o) => `<span class="chip ${selected.includes(o.key) ? "on" : ""}" data-key="${esc(o.key)}">${esc(o.label)}</span>`)
    .join("")}</div>`;
}
const chipValues = (root, name) => [...root.querySelectorAll(`[data-chips="${name}"] .chip.on`)].map((c) => c.dataset.key);
document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-chips] .chip");
  if (chip && !chip.closest("[data-single]")) chip.classList.toggle("on");
});

const mealOptions = () => MEAL_ORDER.map((k) => ({ key: k, label: mealName(k) }));
const catOptions = () => state.config.categories.map((c) => ({ key: c.key, label: `${c.emoji} ${c.name}` }));

// ---------- шторка ----------
function openSheet(html, onMount) {
  const sheet = $("#sheet");
  $("#sheet-body").innerHTML = html;
  sheet.classList.remove("hidden");
  sheet.onclick = (e) => {
    if (e.target === sheet || e.target.closest("[data-close]")) closeSheet();
  };
  tg?.BackButton?.show();
  onMount?.($("#sheet-body"));
}
function closeSheet() {
  $("#sheet").classList.add("hidden");
  tg?.BackButton?.hide();
}
tg?.BackButton?.onClick(closeSheet);

// ---------- вкладки ----------
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  render();
}
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

async function render() {
  const view = $("#view");
  await guard(() => ({ today: renderToday, recipes: renderRecipes, balance: renderBalance, ideas: renderIdeas })[state.tab](view));
}

// ---------- Сегодня ----------
async function renderToday(view) {
  const meals = await api(`/meals?from=${state.date}&to=${state.date}`);
  view.innerHTML = `
    <div class="date-nav">
      <button class="secondary small" data-d="-1">‹</button>
      <h1>${esc(prettyDate(state.date))}</h1>
      <button class="secondary small" data-d="1">›</button>
    </div>
    ${MEAL_ORDER.map((k) => {
      const items = meals.filter((m) => m.meal_type === k);
      return `<div class="card meal-slot">
        <div class="row between"><h3>${esc(mealName(k))}</h3><button class="link" data-add="${k}">＋ Отметить</button></div>
        <div class="items">${
          items.length
            ? items
                .map((m) => `<div class="item"><span class="emoji">${catEmojis(m.categories)}</span><span class="grow">${esc(m.title)}</span><button class="danger small" data-del="${m.id}">✕</button></div>`)
                .join("")
            : `<div class="hint">ещё не отмечено</div>`
        }</div>
      </div>`;
    }).join("")}
    <p class="hint">Отмечайте, что ели, — так я буду знать, чего не хватает, и подсказывать разнообразие.</p>`;
  view.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => ((state.date = addDays(state.date, Number(b.dataset.d))), render())));
  view.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => openMealPicker(b.dataset.add)));
  view.querySelectorAll("[data-del]").forEach(
    (b) =>
      (b.onclick = () =>
        guard(async () => {
          await api(`/meals/${b.dataset.del}`, { method: "DELETE" });
          render();
        })),
  );
}

async function openMealPicker(mealType) {
  const date = state.date;
  openSheet(`<div class="sheet-head"><h2>${esc(mealName(mealType))}</h2><button class="link" data-close>Закрыть</button></div><div class="empty"><span class="spinner"></span></div>`);
  const suggestions = await guard(() => api(`/suggest?meal=${mealType}&date=${date}`));
  if (!suggestions) return;
  const suggestedIds = new Set(suggestions.map((s) => s.recipe.id));
  const others = state.recipes.filter((r) => !suggestedIds.has(r.id));
  const item = (r, reasons) =>
    `<div class="list-item" data-pick="${r.id}"><span class="emoji">${catEmojis(r.categories)}</span><div class="grow"><div class="title">${esc(r.title)}</div>${
      reasons?.length ? `<div class="hint">${esc(reasons.slice(0, 2).join(" · "))}</div>` : ""
    }</div></div>`;
  openSheet(
    `<div class="sheet-head"><h2>${esc(mealName(mealType))} · ${esc(prettyDate(date).toLowerCase())}</h2><button class="link" data-close>Закрыть</button></div>
     ${suggestions.length ? `<h2>Рекомендую</h2><div class="card">${suggestions.map((s) => item(s.recipe, s.reasons)).join("")}</div>` : ""}
     ${others.length ? `<h2>Все рецепты</h2><input id="pick-q" placeholder="Поиск…" /><div class="card" id="pick-list">${others.map((r) => item(r)).join("")}</div>` : ""}
     <h2>Или вписать вручную</h2>
     <div class="card">
       <input id="free-title" placeholder="Например: гречка с курицей" />
       <label>Что в блюде (необязательно — угадаю сам)</label>
       ${chips(catOptions(), [], "free-cats")}
       <p><button class="block" id="free-save">Отметить</button></p>
     </div>`,
    (root) => {
      const add = (payload) =>
        guard(async () => {
          await api("/meals", { method: "POST", body: { date, meal_type: mealType, ...payload } });
          haptic();
          closeSheet();
          render();
        });
      root.querySelectorAll("[data-pick]").forEach((el) => (el.onclick = () => add({ recipe_id: Number(el.dataset.pick) })));
      $("#free-save", root).onclick = () => {
        const title = $("#free-title", root).value.trim();
        if (!title) return toast("Напишите, что ели");
        add({ title, categories: chipValues(root, "free-cats") });
      };
      const q = $("#pick-q", root);
      if (q)
        q.oninput = () => {
          const s = q.value.toLowerCase();
          root.querySelectorAll("#pick-list [data-pick]").forEach((el) => (el.style.display = el.textContent.toLowerCase().includes(s) ? "" : "none"));
        };
    },
  );
}

// ---------- Рецепты ----------
async function loadRecipes() {
  state.recipes = await api("/recipes");
}

async function renderRecipes(view) {
  const f = state.recipeFilter;
  const list = state.recipes.filter(
    (r) =>
      (!f.meal || r.meal_types.includes(f.meal)) &&
      (!f.q || `${r.title} ${r.ingredients.map((i) => i.name).join(" ")}`.toLowerCase().includes(f.q.toLowerCase())),
  );
  view.innerHTML = `
    <div class="row between"><h1>Рецепты <span class="hint">${state.recipes.length}</span></h1><button class="small" id="new-recipe">＋ Новый</button></div>
    <input id="q" placeholder="Поиск по названию и продуктам" value="${esc(f.q)}" />
    <div class="chips" style="margin:10px 0" data-single>
      ${[{ key: "", label: "Все" }, ...mealOptions()].map((o) => `<span class="chip ${f.meal === o.key ? "on" : ""}" data-meal="${o.key}">${esc(o.label)}</span>`).join("")}
    </div>
    <div class="card">${
      list.length
        ? list
            .map(
              (r) => `<div class="list-item" data-open="${r.id}"><span class="emoji">${catEmojis(r.categories)}</span><div class="grow"><div class="title">${esc(r.title)}</div><div class="hint">${esc(
                [r.meal_types.map(mealName).join(", "), r.minutes ? `${r.minutes} мин` : ""].filter(Boolean).join(" · "),
              )}</div></div>${r.warnings.length ? "⚠️" : ""}</div>`,
            )
            .join("")
        : `<div class="empty">${state.recipes.length ? "Ничего не нашлось" : "Пока пусто. Отправьте боту голосовое с рецептом 🎙 или нажмите «Новый»."}</div>`
    }</div>`;
  const q = $("#q", view);
  q.oninput = () => {
    f.q = q.value;
    const pos = q.selectionStart;
    renderRecipes(view).then(() => {
      const nq = $("#q", view);
      nq.focus();
      nq.setSelectionRange(pos, pos);
    });
  };
  view.querySelectorAll("[data-meal]").forEach((c) => (c.onclick = () => ((f.meal = c.dataset.meal), renderRecipes(view))));
  view.querySelectorAll("[data-open]").forEach((el) => (el.onclick = () => openRecipe(Number(el.dataset.open))));
  $("#new-recipe", view).onclick = () => openEditor();
}

function recipeHtml(r) {
  return `
    <div class="hint">${esc([r.meal_types.map(mealName).join(", "), r.minutes ? `⏱ ${r.minutes} мин` : ""].filter(Boolean).join(" · "))}</div>
    <div>${r.categories.map((k) => `<span class="tag">${esc(cat(k)?.emoji)} ${esc(cat(k)?.name)}</span>`).join("")}</div>
    ${r.warnings?.length ? r.warnings.map((w) => `<p class="warn">⚠️ ${esc(w)}</p>`).join("") : ""}
    ${r.ingredients.length ? `<h2>Ингредиенты</h2><ul>${r.ingredients.map((i) => `<li>${esc(i.name)}${i.amount ? ` — ${esc(i.amount)}` : ""}</li>`).join("")}</ul>` : ""}
    ${r.steps.length ? `<h2>Приготовление</h2><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
    ${r.notes ? `<h2>Заметки</h2><p style="white-space:pre-wrap">${esc(r.notes)}</p>` : ""}`;
}

function openRecipe(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return toast("Рецепт не найден");
  openSheet(
    `<div class="sheet-head"><h2>${esc(r.title)}</h2><button class="link" data-close>Закрыть</button></div>
     ${recipeHtml(r)}
     <h2>Отметить, что ели сегодня</h2>
     <div class="chips">${MEAL_ORDER.map((k) => `<span class="chip" data-ate="${k}">${esc(mealName(k))}</span>`).join("")}</div>
     <p class="row"><button class="secondary grow" id="edit">✏️ Изменить</button><button class="danger" id="del">Удалить</button></p>`,
    (root) => {
      root.querySelectorAll("[data-ate]").forEach(
        (c) =>
          (c.onclick = (e) => {
            e.stopPropagation();
            guard(async () => {
              await api("/meals", { method: "POST", body: { date: state.config.today, meal_type: c.dataset.ate, recipe_id: r.id } });
              haptic();
              toast(`Отмечено: ${mealName(c.dataset.ate)}`);
              closeSheet();
            });
          }),
      );
      $("#edit", root).onclick = () => openEditor(r);
      $("#del", root).onclick = () => {
        const doDelete = () =>
          guard(async () => {
            await api(`/recipes/${r.id}`, { method: "DELETE" });
            await loadRecipes();
            closeSheet();
            render();
          });
        if (tg?.showConfirm) tg.showConfirm(`Удалить «${r.title}»?`, (ok) => ok && doDelete());
        else if (confirm(`Удалить «${r.title}»?`)) doDelete();
      };
    },
  );
}

function openEditor(r = null) {
  const v = r || { title: "", meal_types: [], categories: [], ingredients: [], steps: [], notes: "", minutes: null, warnings: [] };
  openSheet(
    `<div class="sheet-head"><h2>${r?.id ? "Изменить рецепт" : "Новый рецепт"}</h2><button class="link" data-close>Отмена</button></div>
     ${
       !r?.id && state.config.ai
         ? `<div class="card" style="background:var(--bg2)"><label style="margin-top:0">Вставьте текст рецепта — оформлю сама</label><textarea id="raw" placeholder="Например, скопированный рецепт или заметка"></textarea><p><button class="secondary block" id="parse">✨ Распознать</button></p></div>`
         : ""
     }
     <label>Название</label><input id="f-title" value="${esc(v.title)}" />
     <label>Приём пищи</label>${chips(mealOptions(), v.meal_types, "f-meals")}
     <label>Что в блюде</label>${chips(catOptions(), v.categories, "f-cats")}
     <label>Ингредиенты — по одному на строку, количество через «—»</label>
     <textarea id="f-ingr" rows="6">${esc(v.ingredients.map((i) => (i.amount ? `${i.name} — ${i.amount}` : i.name)).join("\n"))}</textarea>
     <label>Шаги — по одному на строку</label>
     <textarea id="f-steps" rows="6">${esc(v.steps.join("\n"))}</textarea>
     <label>Время, мин</label><input id="f-min" type="number" inputmode="numeric" value="${v.minutes ?? ""}" />
     <label>Заметки</label><textarea id="f-notes">${esc(v.notes)}</textarea>
     <p><button class="block" id="save">Сохранить</button></p>`,
    (root) => {
      const parseBtn = $("#parse", root);
      if (parseBtn)
        parseBtn.onclick = () =>
          guard(async () => {
            const text = $("#raw", root).value.trim();
            if (!text) return toast("Вставьте текст");
            parseBtn.disabled = true;
            parseBtn.innerHTML = `<span class="spinner"></span> Думаю…`;
            try {
              openEditor({ ...(await api("/recipes/parse", { method: "POST", body: { text } })), id: undefined, _parsed: true });
            } finally {
              parseBtn.disabled = false;
              parseBtn.textContent = "✨ Распознать";
            }
          });
      $("#save", root).onclick = () =>
        guard(async () => {
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
            notes: $("#f-notes", root).value,
            warnings: v.warnings || [],
            source: v.source || "manual",
          };
          const saved = r?.id ? await api(`/recipes/${r.id}`, { method: "PUT", body }) : await api("/recipes", { method: "POST", body });
          haptic();
          await loadRecipes();
          toast("Сохранено");
          render();
          openRecipe(saved.id);
        });
    },
  );
}

// ---------- Баланс ----------
async function renderBalance(view, days = state.balanceDays || 7) {
  state.balanceDays = days;
  const balance = await api(`/balance?days=${days}`);
  const need = balance.filter((b) => b.status !== "ok");
  view.innerHTML = `
    <h1>Баланс питания</h1>
    <div class="chips" style="margin-bottom:12px">${[7, 14, 30].map((d) => `<span class="chip ${d === days ? "on" : ""}" data-days="${d}">${d} дней</span>`).join("")}</div>
    ${
      need.length
        ? `<div class="card"><h3>Чего не хватает</h3>${need
            .slice(0, 6)
            .map((b) => `<p style="margin:8px 0">${b.emoji} <b>${esc(b.name)}</b> <span class="hint">${b.daysSince == null ? "давно не было" : b.count === 0 ? `не было ${b.daysSince} дн.` : `${b.count} из ${b.target}`}</span><br><span class="hint">Идеи: ${esc(b.ideas.join(", "))}</span></p>`)
            .join("")}<button class="secondary block" id="go-ideas">✨ Подобрать блюдо</button></div>`
        : `<div class="card">🎉 Всё разнообразно — так держать!</div>`
    }
    <div class="card">${balance
      .map((b) => {
        const pct = Math.min(100, Math.round((b.count / b.target) * 100));
        return `<div style="margin:10px 0"><div class="row between"><span>${b.emoji} ${esc(b.name)}</span><span class="hint">${b.count} / ${b.target}</span></div><div class="bar ${b.status}"><i style="width:${Math.max(pct, b.count ? 6 : 0)}%"></i></div></div>`;
      })
      .join("")}</div>
    <p class="hint">Цели — примерные ориентиры «сколько раз за период» для разнообразия, их можно поменять в src/nutrition.ts.</p>`;
  view.querySelectorAll("[data-days]").forEach((c) => (c.onclick = () => guard(() => renderBalance(view, Number(c.dataset.days)))));
  const go = $("#go-ideas", view);
  if (go) go.onclick = () => setTab("ideas");
}

// ---------- Идеи ----------
async function renderIdeas(view) {
  const meal = state.ideaMeal;
  view.innerHTML = `
    <h1>Что приготовить?</h1>
    <div class="chips" style="margin-bottom:12px">${[{ key: "", label: "Любой" }, ...mealOptions()]
      .map((o) => `<span class="chip ${meal === o.key ? "on" : ""}" data-im="${o.key}">${esc(o.label)}</span>`)
      .join("")}</div>
    <h2>Из ваших рецептов</h2>
    <div class="card" id="sugg"><div class="empty"><span class="spinner"></span></div></div>
    <h2>Новая идея</h2>
    <div class="card">${
      state.config.ai
        ? `<input id="wish" placeholder="Пожелание (необязательно): с кабачком, быстро…" />
           <p><button class="block" id="gen">✨ Придумать блюдо под то, чего не хватает</button></p><div id="idea"></div>`
        : `<p class="hint">Подключите ключ Claude API (ANTHROPIC_API_KEY), и я смогу придумывать новые ПП-рецепты под ваш баланс.</p>`
    }</div>`;
  view.querySelectorAll("[data-im]").forEach((c) => (c.onclick = () => ((state.ideaMeal = c.dataset.im), renderIdeas(view))));

  const gen = $("#gen", view);
  if (gen)
    gen.onclick = () =>
      guard(async () => {
        gen.disabled = true;
        gen.innerHTML = `<span class="spinner"></span> Придумываю…`;
        try {
          const idea = await api("/idea", { method: "POST", body: { meal, wish: $("#wish", view).value } });
          const box = $("#idea", view);
          box.innerHTML = `<h2>${esc(idea.title)}</h2>${recipeHtml({ ...idea, notes: idea.notes || "" })}<p class="row"><button class="grow" id="save-idea">💾 Сохранить в книгу</button><button class="secondary" id="edit-idea">✏️</button></p>`;
          $("#save-idea", box).onclick = () =>
            guard(async () => {
              await api("/recipes", { method: "POST", body: idea });
              await loadRecipes();
              haptic();
              toast("Сохранено в рецепты");
              $("#save-idea", box).disabled = true;
            });
          $("#edit-idea", box).onclick = () => openEditor({ ...idea, id: undefined });
        } finally {
          gen.disabled = false;
          gen.textContent = "✨ Придумать ещё";
        }
      });

  const list = await api(`/suggest?meal=${meal}`);
  const box = $("#sugg", view);
  if (!box) return;
  box.innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<div class="list-item" data-open="${s.recipe.id}"><span class="emoji">${catEmojis(s.recipe.categories)}</span><div class="grow"><div class="title">${esc(s.recipe.title)}</div><div class="hint">${esc(
              s.reasons.slice(0, 2).join(" · "),
            )}</div></div></div>`,
        )
        .join("")
    : `<div class="empty">Добавьте рецепты — и я начну подсказывать</div>`;
  box.querySelectorAll("[data-open]").forEach((el) => (el.onclick = () => openRecipe(Number(el.dataset.open))));
}

// ---------- старт ----------
(async function init() {
  await guard(async () => {
    state.config = await api("/config");
    state.date = state.config.today;
    await loadRecipes();
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    setTab(["today", "recipes", "balance", "ideas"].includes(tab) ? tab : "today");
    const recipeId = Number(params.get("recipe"));
    if (recipeId) {
      setTab("recipes");
      openRecipe(recipeId);
    }
  });
  if (!state.config) $("#view").innerHTML = `<div class="empty">Не удалось загрузиться. Откройте приложение из Telegram-бота.</div>`;
})();
