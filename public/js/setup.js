// Мастер первого запуска: семья → рецепты голосом → первое меню → «что есть дома» → список покупок.
import { openAddRecipe, voiceToRecipe } from "./add.js";
import { mountHaveList } from "./shop.js";
import { $, $$, addDays, api, bus, busy, closeSheet, confirmDialog, esc, guard, haptic, loadRecipes, MEAL_ICONS, MEAL_ORDER, mealName, openSheet, replaceSheet, sheetHead, state, store, toast } from "./ui.js";
import { ensureDefaultMembers, mountMembersEditor } from "./members.js";
import { mountRecorder } from "./voice.js";
import { bindPlanCells, planCellHtml } from "./week.js";

const STEPS = ["Семья", "Рецепты", "Меню", "Что есть дома", "Готово"];
const MIN_RECIPES = 5;
let lastPlan = [];

/** С какого дня начинается первая неделя: вечером — уже с завтра. */
const startDate = () => (new Date().getHours() >= 16 ? addDays(state.config.today, 1) : state.config.today);

export async function renderSetup(view) {
  state.setupActive = true;
  document.body.classList.add("setup-mode");
  const step = Math.min(STEPS.length - 1, store.get("setupStep", 0));
  const head = `
    <div class="setup-head">
      <div class="setup-steps">Шаг ${step + 1} из ${STEPS.length} · <b>${STEPS[step]}</b></div>
      <div class="cook-progress"><i style="width:${Math.round(((step + 1) / STEPS.length) * 100)}%"></i></div>
    </div>`;
  const body = document.createElement("div");
  await [stepFamily, stepRecipes, stepMenu, stepHave, stepDone][step](body);
  view.innerHTML = head;
  view.append(...body.childNodes);
  bindCommon(view, step);
  STEP_BINDERS[step]?.(view);
}

const go = (step) => {
  store.set("setupStep", step);
  haptic("light");
  window.scrollTo(0, 0);
  bus.render();
};

export async function finishSetup() {
  state.config.settings = await api("/settings", { method: "PUT", body: { setup_done: true } });
  store.set("setupStep", 0);
  store.set("onboarded", true);
  state.setupActive = false;
  document.body.classList.remove("setup-mode");
  bus.go("home");
}

function bindCommon(view, step) {
  const back = $("#setup-back", view);
  if (back) back.onclick = () => go(step - 1);
  const skip = $("#setup-skip", view);
  if (skip)
    skip.onclick = async () => {
      if (await confirmDialog("Пропустить настройку? Всё можно будет сделать потом в приложении.")) guard(finishSetup);
    };
}

const nav = (step, nextLabel, nextId = "setup-next") => `
  <div class="setup-nav">
    ${step > 0 ? `<button class="big-btn" id="setup-back">← Назад</button>` : ""}
    <button class="big-btn primary grow" id="${nextId}">${nextLabel}</button>
  </div>
  ${step < STEPS.length - 1 ? `<button class="link block center" id="setup-skip">Пропустить настройку</button>` : ""}`;

// ---------- 1. Семья ----------
async function stepFamily(el) {
  await ensureDefaultMembers();
  const name = state.config.me?.first_name;
  el.innerHTML = `
    <div class="setup-hero"><div class="setup-icon">👋</div>
      <h1>Привет${name ? `, ${esc(name)}` : ""}!</h1>
      <p>Давайте за 10 минут всё настроим: вы надиктуете свои рецепты, я составлю меню на неделю и соберу список покупок.</p>
    </div>
    <div class="card">
      <h2>Кто в семье?</h2>
      <p class="muted">Впишите имена и добавьте детей. Я буду следить за питанием <b>каждого</b> — ведь дети иногда едят не то же, что взрослые. На столько человек пересчитаю и продукты.</p>
      <div id="members"></div>
    </div>
    ${nav(0, "Дальше →")}`;
}

// ---------- 2. Рецепты ----------
async function stepRecipes(el) {
  const recipes = state.recipes;
  const count = (k) => recipes.filter((r) => r.meal_types.includes(k)).length;
  const empty = MEAL_ORDER.filter((k) => count(k) === 0);
  el.innerHTML = `
    <h1>🎙 Ваши рецепты</h1>
    <p>Нажмите на микрофон и расскажите <b>одно блюдо</b>: как называется, что кладёте и как готовите. Потом следующее. Лучше <b>5–10 блюд</b>, которые вы часто готовите.</p>
    <div id="rec"></div>
    <div class="coverage">${MEAL_ORDER.map(
      (k) => `<div class="cov ${count(k) ? "ok" : ""}"><span>${MEAL_ICONS[k]}</span><b>${count(k)}</b><small>${esc(mealName(k).toLowerCase())}</small></div>`,
    ).join("")}</div>
    ${empty.length && recipes.length ? `<div class="notice warn">Пока нет ни одного: <b>${esc(empty.map((k) => mealName(k).toLowerCase()).join(", "))}</b>. Надиктуйте или возьмите из готовых ниже 👇</div>` : ""}
    <button class="big-btn block" id="starter">📚 Взять из готовых ПП-рецептов</button>
    <button class="big-btn block" id="other">📷 Фото, ссылка или текст</button>
    ${
      recipes.length
        ? `<h3>Уже в книге: ${recipes.length}</h3><div class="card compact">${recipes
            .map((r) => `<div class="mini-row">${r.meal_types.map((k) => MEAL_ICONS[k]).join("")} ${esc(r.title)}</div>`)
            .join("")}</div>`
        : ""
    }
    ${nav(1, recipes.length >= MIN_RECIPES ? "Составить меню →" : `Дальше (${recipes.length} из ${MIN_RECIPES}) →`)}`;
}

function openStarter() {
  openSheet(`${sheetHead("📚 Готовые ПП-рецепты")}<div class="empty"><span class="spinner"></span></div>`);
  guard(async () => {
    const list = await api("/starter");
    replaceSheet(
      `${sheetHead("📚 Готовые ПП-рецепты")}
       <p class="muted">Простые блюда без глютена и сахара, на 5 порций. Отметьте то, что ваша семья ест, — добавлю в книгу. Потом их можно поправить под себя.</p>
       ${MEAL_ORDER.map((k) => {
         const group = list.filter((r) => r.meal_types[0] === k);
         return group.length
           ? `<h3>${MEAL_ICONS[k]} ${esc(mealName(k))}</h3><div class="list">${group
               .map(
                 (r) => `<label class="check-row starter ${r.added ? "disabled" : ""}"><input type="checkbox" value="${r.key}" ${r.added ? "checked disabled" : ""}/><span>${esc(r.title)}${r.added ? ' <small class="muted">— уже есть</small>' : ""}</span></label>`,
               )
               .join("")}</div>`
           : "";
       }).join("")}
       <button class="big-btn primary block sticky-bottom" id="add-starter">Добавить выбранные</button>`,
      (root) => {
        const btn = $("#add-starter", root);
        const update = () => {
          const n = $$("input:checked:not(:disabled)", root).length;
          btn.textContent = n ? `Добавить выбранные (${n})` : "Отметьте блюда";
          btn.disabled = !n;
        };
        $$("input", root).forEach((i) => (i.onchange = update));
        update();
        btn.onclick = (e) =>
          guard(() =>
            busy(e.currentTarget, "Добавляю…", async () => {
              const keys = $$("input:checked:not(:disabled)", root).map((i) => i.value);
              const { added } = await api("/starter", { method: "POST", body: { keys } });
              await loadRecipes();
              haptic();
              toast(`Добавлено рецептов: ${added} 📖`);
              closeSheet();
              bus.render();
            }),
          );
      },
    );
  });
}

// ---------- 3. Меню ----------
async function stepMenu(el) {
  const start = startDate();
  const end = addDays(start, 6);
  let plan = await api(`/plan?from=${start}&to=${end}`);
  if (!plan.length && state.recipes.length) plan = await api("/plan/fill", { method: "POST", body: { start, days: 7 } });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  el.innerHTML = `
    <h1>🗓 Меню на неделю</h1>
    <p>Я подобрала блюда из ваших рецептов так, чтобы было разнообразно. <b>Не нравится блюдо — нажмите на него</b> и замените.</p>
    <button class="big-btn block" id="reshuffle">🔄 Перемешать всё</button>
    ${days
      .map((d) => {
        const label = new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
        return `<div class="card day compact"><h3>${d === state.config.today ? "Сегодня" : d === addDays(state.config.today, 1) ? "Завтра" : esc(label)}</h3>
          ${MEAL_ORDER.map((k) => planCellHtml(plan, d, k, true)).join("")}</div>`;
      })
      .join("")}
    ${plan.length ? "" : `<div class="notice warn">Не получилось составить меню — добавьте рецептов на предыдущем шаге.</div>`}
    ${nav(2, "Нравится, дальше →")}`;
  lastPlan = plan;
}

// ---------- 4. Что есть дома ----------
async function stepHave(el) {
  if (!store.get("setupShopBuilt")) {
    const start = startDate();
    await api("/shopping/from-plan", { method: "POST", body: { from: start, to: addDays(start, 6) } });
    store.set("setupShopBuilt", true);
  }
  el.innerHTML = `
    <h1>🏠 Что уже есть дома?</h1>
    <p>Вот все продукты на неделю, уже на вашу семью. <b>Нажмите на то, что уже есть дома</b> — я уберу это из покупок. Или скажите голосом: «гречка, яйца, молоко».</p>
    <div id="have"></div>
    ${nav(3, "Готово, дальше →")}`;
}

// ---------- 5. Готово ----------
async function stepDone(el) {
  const items = (await api("/shopping")).filter((i) => !i.checked);
  el.innerHTML = `
    <div class="setup-hero"><div class="setup-icon">🎉</div><h1>Всё готово!</h1>
      <p>Меню на неделю составлено. В списке покупок <b>${items.length}</b> ${items.length % 10 === 1 && items.length % 100 !== 11 ? "продукт" : [2, 3, 4].includes(items.length % 10) && ![12, 13, 14].includes(items.length % 100) ? "продукта" : "продуктов"}.</p></div>
    ${
      items.length
        ? `<div class="card"><h3>📤 Кто пойдёт в магазин?</h3><p class="muted">Отправлю список в Telegram — его удобно открыть в магазине.</p>
            <button class="big-btn primary block" id="send-family">Отправить всей семье</button>
            <button class="big-btn block" id="send-me">Отправить только мне</button></div>`
        : ""
    }
    <div class="card">
      <h3>Что дальше</h3>
      <p>☀️ Каждое утро я пришлю меню на день и напомню, что достать из морозилки.</p>
      <p>🌙 Вечером напомню, что замочить на завтра.</p>
      <p>✅ Отмечайте на главном экране, что съели, — я буду следить за разнообразием.</p>
    </div>
    ${nav(4, "На главную 🏠", "setup-finish")}`;
}

// ---------- обработчики шагов ----------
const STEP_BINDERS = [
  (view) => {
    mountMembersEditor($("#members", view));
    $("#setup-next", view).onclick = () => {
      // Имена сохраняются при выходе из поля — дадим этому случиться.
      document.activeElement?.blur?.();
      setTimeout(() => go(1), 150);
    };
  },
  (view) => {
    mountRecorder($("#rec", view), { idle: "Нажмите и расскажите рецепт", onText: voiceToRecipe });
    $("#starter", view).onclick = openStarter;
    $("#other", view).onclick = openAddRecipe;
    $("#setup-next", view).onclick = async () => {
      const n = state.recipes.length;
      if (!n) return toast("Сначала добавьте хотя бы несколько рецептов 🙂", 3500);
      if (n < MIN_RECIPES && !(await confirmDialog(`Рецептов пока ${n} — меню будет с повторами. Всё равно составить?`))) return;
      go(2);
    };
  },
  (view) => {
    bindPlanCells(view, lastPlan);
    $("#reshuffle", view).onclick = (e) =>
      guard(() =>
        busy(e.currentTarget, "Подбираю…", async () => {
          await api("/plan/fill", { method: "POST", body: { start: startDate(), days: 7, replace: true } });
          haptic();
          bus.render();
        }),
      );
    $("#setup-next", view).onclick = () => {
      store.set("setupShopBuilt", false);
      go(3);
    };
  },
  (view) => {
    mountHaveList($("#have", view));
    $("#setup-next", view).onclick = () => go(4);
  },
  (view) => {
    const send = (to) => (e) =>
      guard(() =>
        busy(e.currentTarget, "Отправляю…", async () => {
          const { sent } = await api("/shopping/send", { method: "POST", body: { to } });
          haptic();
          toast(to === "family" && sent < 2 ? "Отправила вам. Муж получит, когда напишет боту /start" : "Отправила в Telegram 📤", 4500);
        }),
      );
    const f = $("#send-family", view);
    if (f) f.onclick = send("family");
    const m = $("#send-me", view);
    if (m) m.onclick = send("me");
    $("#setup-finish", view).onclick = () => guard(finishSetup);
  },
];
