// Общие помощники интерфейса: API, шторка, всплывашки, подсказки.

export const tg = window.Telegram?.WebApp;
export const inTelegram = Boolean(tg?.initData);

export const state = {
  config: null,
  recipes: [],
  tab: "home",
};

export const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];
export const MEAL_ICONS = { breakfast: "🍳", lunch: "🍲", snack: "🍎", dinner: "🌙" };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const cat = (key) => state.config.categories.find((c) => c.key === key);
export const catEmojis = (keys) => (keys || []).map((k) => cat(k)?.emoji || "").join("");
export const mealName = (k) => state.config.mealTypes[k] || k;
export const recipeById = (id) => state.recipes.find((r) => r.id === id);

// ---------- API ----------
export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { ...(isForm ? {} : { "content-type": "application/json" }), "X-Telegram-Init-Data": tg?.initData || "", ...(opts.headers || {}) },
    body: opts.body == null ? undefined : isForm ? opts.body : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

export async function loadRecipes() {
  state.recipes = await api("/recipes");
}

// ---------- обратная связь ----------
export function toast(text, ms = 2600) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add("hidden"), ms);
}

export function haptic(type = "success") {
  try {
    if (type === "light") tg?.HapticFeedback?.impactOccurred?.("light");
    else tg?.HapticFeedback?.notificationOccurred?.(type);
  } catch {}
}

/** Выполняет действие и показывает понятную ошибку, если что-то пошло не так. */
export async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    haptic("error");
    toast(e.message || String(e), 4000);
  }
}

/** Кнопка с крутилкой, пока идёт долгая операция. */
export async function busy(button, label, fn) {
  const old = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> ${esc(label)}`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = old;
  }
}

export function confirmDialog(text) {
  return new Promise((resolve) => {
    if (tg?.showConfirm && inTelegram) tg.showConfirm(text, (ok) => resolve(Boolean(ok)));
    else resolve(window.confirm(text));
  });
}

// ---------- хранилище (может быть недоступно) ----------
export const store = {
  get(key, def = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

/** Подсказка «как это работает», которую можно закрыть навсегда. */
export function hint(id, html) {
  if (store.get(`hint:${id}`)) return "";
  return `<div class="hint-card" data-hint="${id}"><div class="hint-text">💡 ${html}</div><button class="link small" data-hint-close="${id}">Понятно</button></div>`;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-hint-close]");
  if (!btn) return;
  store.set(`hint:${btn.dataset.hintClose}`, true);
  btn.closest(".hint-card")?.remove();
});

// ---------- даты ----------
export function addDays(date, delta) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(date, withWeekday = true) {
  const t = state.config.today;
  const base = new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: withWeekday ? "long" : undefined, day: "numeric", month: "long", timeZone: "UTC" });
  if (date === t) return `Сегодня, ${base}`;
  if (date === addDays(t, 1)) return `Завтра, ${base}`;
  if (date === addDays(t, -1)) return `Вчера, ${base}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
}

// ---------- выбор из «чипсов» ----------
export function chips(options, selected, name, single = false) {
  return `<div class="chips" data-chips="${name}"${single ? " data-single" : ""}>${options
    .map((o) => `<button type="button" class="chip ${selected.includes(o.key) ? "on" : ""}" data-key="${esc(o.key)}">${esc(o.label)}</button>`)
    .join("")}</div>`;
}
export const chipValues = (root, name) => $$(`[data-chips="${name}"] .chip.on`, root).map((c) => c.dataset.key);
document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-chips] .chip");
  if (!chip) return;
  const group = chip.closest("[data-chips]");
  if (group.hasAttribute("data-single")) $$(".chip", group).forEach((c) => c.classList.toggle("on", c === chip));
  else chip.classList.toggle("on");
  haptic("light");
});
export const mealOptions = () => MEAL_ORDER.map((k) => ({ key: k, label: `${MEAL_ICONS[k]} ${mealName(k)}` }));
export const catOptions = () => state.config.categories.map((c) => ({ key: c.key, label: `${c.emoji} ${c.name}` }));

// ---------- шторка снизу ----------
const sheetStack = [];

function showSheet(html, onMount) {
  const sheet = $("#sheet");
  const body = $("#sheet-body");
  body.innerHTML = html;
  body.scrollTop = 0;
  sheet.classList.remove("hidden");
  document.body.classList.add("no-scroll");
  tg?.BackButton?.show();
  onMount?.(body);
}

/** Открывает шторку. Кнопка «Назад» Telegram вернёт к предыдущей шторке. */
export function openSheet(html, onMount) {
  sheetStack.push({ html, onMount });
  showSheet(html, onMount);
}

/** Заменяет содержимое текущей шторки (без новой записи в историю). */
export function replaceSheet(html, onMount) {
  if (sheetStack.length) sheetStack[sheetStack.length - 1] = { html, onMount };
  else sheetStack.push({ html, onMount });
  showSheet(html, onMount);
}

export function closeSheet(all = true) {
  if (!all && sheetStack.length > 1) {
    sheetStack.pop();
    const prev = sheetStack[sheetStack.length - 1];
    return showSheet(prev.html, prev.onMount);
  }
  sheetStack.length = 0;
  $("#sheet").classList.add("hidden");
  document.body.classList.remove("no-scroll");
  if (!document.querySelector(".overlay:not(.hidden)")) tg?.BackButton?.hide();
}

export const sheetHead = (title) =>
  `<div class="sheet-head"><h2>${title}</h2><button class="close-btn" data-close aria-label="Закрыть">✕</button></div>`;

$("#sheet").addEventListener("click", (e) => {
  if (e.target.id === "sheet" || e.target.closest("[data-close]")) closeSheet();
});

/** Колбэк «Назад»: сначала полноэкранный режим, потом шторки. */
export const backHandlers = [];
tg?.BackButton?.onClick(() => {
  const h = backHandlers[backHandlers.length - 1];
  if (h) return h();
  closeSheet(false);
});

/** Для перерисовки текущей вкладки из любого модуля. */
export const bus = { render: () => {} };
