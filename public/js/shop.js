// Список покупок: общий для всей семьи, по отделам магазина.
import { $, $$, addDays, api, bus, busy, confirmDialog, esc, guard, haptic, hint, openSheet, sheetHead, state, toast } from "./ui.js";
import { mountRecorder } from "./voice.js";

let showBought = false;

export async function renderShop(view) {
  const items = await api("/shopping");
  const todo = items.filter((i) => !i.checked);
  const bought = items.filter((i) => i.checked);
  const aisles = state.config.aisles.filter((a) => todo.some((i) => i.aisle === a));

  view.innerHTML = `
    <div class="page-head"><h1>🛒 Покупки</h1></div>
    ${hint("shop", "Нажмите <b>«Собрать из меню»</b> — я сложу продукты всех блюд недели в один список, уже на вашу семью. В магазине просто нажимайте на продукт — он отметится купленным. Список общий: муж видит то же самое.")}
    <button class="big-btn primary block" id="from-plan">🗓 Собрать из меню на неделю</button>
    ${todo.length ? `<button class="big-btn block" id="have-home">🏠 Что-то уже есть дома? Отметить</button>` : ""}
    <div class="inline-form add-item"><input id="new" placeholder="Добавить продукт, напр. «молоко»" enterkeyhint="done" /><button class="btn primary" id="add">＋</button></div>
    ${
      todo.length
        ? aisles
            .map(
              (a) => `<div class="card aisle"><h3>${esc(a)}</h3>${todo
                .filter((i) => i.aisle === a)
                .map((i) => `<button class="shop-item" data-check="${i.id}"><span class="box"></span><span class="grow">${esc(i.name)}</span><span class="amount">${esc(i.amount)}</span></button>`)
                .join("")}</div>`,
            )
            .join("")
        : `<div class="empty"><div class="empty-icon">🧺</div>Список пуст.<br>Соберите его из меню или добавьте продукт вручную.</div>`
    }
    ${
      bought.length
        ? `<button class="link block center" id="toggle-bought">${showBought ? "Скрыть" : "Показать"} купленное (${bought.length})</button>
           ${
             showBought
               ? `<div class="card aisle bought">${bought
                   .map((i) => `<button class="shop-item done" data-uncheck="${i.id}"><span class="box">✓</span><span class="grow">${esc(i.name)}</span><span class="amount">${esc(i.amount)}</span></button>`)
                   .join("")}</div>`
               : ""
           }
           <button class="btn secondary block" id="clear-bought">🧹 Убрать купленное из списка</button>`
        : ""
    }
    ${todo.length ? `<div class="row-btns"><button class="btn secondary grow" id="send-family">📤 Отправить всей семье</button><button class="btn secondary" id="send">Себе</button></div>` : ""}`;

  const add = () =>
    guard(async () => {
      const name = $("#new", view).value.trim();
      if (!name) return;
      await api("/shopping", { method: "POST", body: { name } });
      haptic("light");
      bus.render();
    });
  $("#add", view).onclick = add;
  const haveBtn = $("#have-home", view);
  if (haveBtn) haveBtn.onclick = openHaveAtHome;
  $("#new", view).onkeydown = (e) => e.key === "Enter" && add();
  $("#from-plan", view).onclick = (e) =>
    guard(() =>
      busy(e.currentTarget, "Собираю…", async () => {
        const res = await api("/shopping/from-plan", { method: "POST", body: { from: state.config.today, to: addDays(state.config.today, 6) } });
        if (!res.dishes) throw new Error("Сначала составьте меню на неделю (вкладка «Меню»)");
        haptic();
        toast(`Готово: ${res.count} продуктов для ${res.dishes} блюд`);
        bus.render();
      }),
    );
  $$("[data-check]", view).forEach(
    (b) =>
      (b.onclick = () =>
        guard(async () => {
          b.classList.add("done");
          haptic("light");
          await api(`/shopping/${b.dataset.check}`, { method: "PATCH", body: { checked: true } });
          setTimeout(bus.render, 250);
        })),
  );
  $$("[data-uncheck]", view).forEach(
    (b) =>
      (b.onclick = () =>
        guard(async () => {
          await api(`/shopping/${b.dataset.uncheck}`, { method: "PATCH", body: { checked: false } });
          bus.render();
        })),
  );
  const toggle = $("#toggle-bought", view);
  if (toggle) toggle.onclick = () => ((showBought = !showBought), bus.render());
  const clear = $("#clear-bought", view);
  if (clear)
    clear.onclick = async () => {
      if (!(await confirmDialog("Убрать все купленные продукты из списка?"))) return;
      guard(async () => {
        await api("/shopping/clear", { method: "POST", body: { what: "checked" } });
        bus.render();
      });
    };
  const sendTo = (to) => (e) =>
    guard(() =>
      busy(e.currentTarget, "Отправляю…", async () => {
        const { sent } = await api("/shopping/send", { method: "POST", body: { to } });
        toast(to === "family" ? (sent > 1 ? "Отправила всей семье в Telegram 📤" : "Отправила вам. Остальные получат, когда напишут боту /start") : "Отправила вам в чат с ботом 📤", 4500);
      }),
    );
  const send = $("#send", view);
  if (send) send.onclick = sendTo("me");
  const sendFamily = $("#send-family", view);
  if (sendFamily) sendFamily.onclick = sendTo("family");
}

// ---------- «Что уже есть дома?» ----------
/**
 * Список продуктов с переключателем «Купить / Есть дома» + ввод голосом или текстом.
 * Используется в мастере первого запуска и во вкладке «Покупки».
 */
export async function mountHaveList(container, { onChange } = {}) {
  const items = await api("/shopping");
  const all = items;
  const toBuy = all.filter((i) => !i.checked).length;
  const aisles = state.config.aisles.filter((a) => all.some((i) => i.aisle === a));
  container.innerHTML = `
    <div id="have-rec"></div>
    <div class="inline-form"><input id="have-text" placeholder="или напишите: гречка, яйца, морковь" enterkeyhint="done" /><button class="btn primary" id="have-go">OK</button></div>
    <div class="have-counter">🛒 Купить: <b>${toBuy}</b> из ${all.length}</div>
    ${aisles
      .map(
        (a) => `<div class="card aisle"><h3>${esc(a)}</h3>${all
          .filter((i) => i.aisle === a)
          .map(
            (i) => `<button class="have-item ${i.checked ? "have" : ""}" data-toggle="${i.id}" data-checked="${i.checked ? 1 : 0}">
              <span class="grow"><span class="have-name">${esc(i.name)}</span><span class="amount">${esc(i.amount)}</span></span>
              <span class="pill">${i.checked ? "✓ Есть" : "Купить"}</span></button>`,
          )
          .join("")}</div>`,
      )
      .join("")}`;

  const refresh = () => mountHaveList(container, { onChange }).then(() => onChange?.());
  const markText = (text) =>
    guard(async () => {
      const res = await api("/shopping/have", { method: "POST", body: { text } });
      haptic();
      toast(res.matched.length ? `✅ Есть дома: ${res.matched.join(", ").toLowerCase()}` : `Не нашла в списке: ${res.products.join(", ")}`, 4000);
      await refresh();
    });
  mountRecorder($("#have-rec", container), {
    idle: "Скажите, что есть дома: «гречка, яйца, молоко»",
    small: true,
    onText: async (text) => markText(text),
  });
  const input = $("#have-text", container);
  const go = () => input.value.trim() && markText(input.value.trim());
  $("#have-go", container).onclick = go;
  input.onkeydown = (e) => e.key === "Enter" && go();
  $$("[data-toggle]", container).forEach(
    (b) =>
      (b.onclick = () =>
        guard(async () => {
          const checked = b.dataset.checked !== "1";
          b.classList.toggle("have", checked);
          b.dataset.checked = checked ? "1" : "0";
          $(".pill", b).textContent = checked ? "✓ Есть" : "Купить";
          haptic("light");
          await api(`/shopping/${b.dataset.toggle}`, { method: "PATCH", body: { checked } });
          const left = $$("[data-toggle]", container).filter((x) => x.dataset.checked !== "1").length;
          const counter = $(".have-counter", container);
          if (counter) counter.innerHTML = `🛒 Купить: <b>${left}</b> из ${all.length}`;
          onChange?.();
        })),
  );
}

export function openHaveAtHome() {
  openSheet(
    `${sheetHead("🏠 Что уже есть дома?")}
     <p class="muted">Нажмите на продукт, который уже есть, — он уйдёт из покупок. Или скажите голосом.</p>
     <div id="have"></div>
     <button class="big-btn primary block" data-close>Готово</button>`,
    (root) => mountHaveList($("#have", root), { onChange: () => bus.render() }),
  );
}
