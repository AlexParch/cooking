// Список покупок: общий для всей семьи, по отделам магазина.
import { $, $$, addDays, api, bus, busy, confirmDialog, esc, guard, haptic, hint, state, toast } from "./ui.js";

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
    ${todo.length ? `<button class="btn secondary block" id="send">📤 Прислать список в чат</button>` : ""}`;

  const add = () =>
    guard(async () => {
      const name = $("#new", view).value.trim();
      if (!name) return;
      await api("/shopping", { method: "POST", body: { name } });
      haptic("light");
      bus.render();
    });
  $("#add", view).onclick = add;
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
  const send = $("#send", view);
  if (send)
    send.onclick = (e) =>
      guard(() =>
        busy(e.currentTarget, "Отправляю…", async () => {
          await api("/shopping/send", { method: "POST" });
          toast("Отправила список в чат с ботом — его можно переслать 📤", 4000);
        }),
      );
}
