// Точка входа WebApp «Наша кухня».
import "./home.js";
import { renderHome } from "./home.js";
import { renderBalance, renderMore, showOnboarding } from "./more.js";
import { openRecipe, renderRecipes } from "./recipes.js";
import { renderSetup } from "./setup.js";
import { renderShop } from "./shop.js";
import { $, $$, api, bus, guard, inTelegram, loadRecipes, state, store, tg } from "./ui.js";
import { renderWeek } from "./week.js";

const SCREENS = { home: renderHome, week: renderWeek, recipes: renderRecipes, shop: renderShop, more: renderMore, balance: renderBalance, setup: renderSetup };
// Какая кнопка внизу подсвечивается для экрана
const NAV_OF = { balance: "more" };

if (inTelegram) {
  document.documentElement.classList.add("tg");
  tg.ready();
  tg.expand();
  try {
    tg.disableVerticalSwipes?.(); // чтобы приложение не закрывалось случайно при прокрутке
  } catch {}
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const view = $("#view");
  const tab = state.tab;
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === (NAV_OF[tab] || tab)));
  await guard(async () => {
    const tmp = document.createElement("div");
    await SCREENS[tab](tmp);
    if (seq !== renderSeq) return; // пока грузили, пользователь ушёл на другую вкладку
    view.replaceChildren(...tmp.childNodes);
  });
}

function go(tab) {
  if (!SCREENS[tab]) tab = "home";
  if (tab !== "setup") {
    state.setupActive = false;
    document.body.classList.remove("setup-mode");
  }
  const changed = state.tab !== tab;
  state.tab = tab;
  if (changed) window.scrollTo(0, 0);
  render();
}

bus.render = render;
bus.go = go;

$$(".tabs button").forEach((b) => (b.onclick = () => (tg?.HapticFeedback?.selectionChanged?.(), go(b.dataset.tab))));
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab-go]");
  if (t) go(t.dataset.tabGo);
});

(async function init() {
  $("#view").innerHTML = `<div class="empty"><span class="spinner"></span><br>Загружаю…</div>`;
  await guard(async () => {
    state.config = await api("/config");
    await loadRecipes();
  });
  if (!state.config) {
    $("#view").innerHTML = `<div class="empty"><div class="empty-icon">🔒</div>Не удалось загрузиться.<br>Откройте приложение кнопкой «Кухня» в чате с ботом.</div>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  const recipeId = Number(params.get("recipe"));
  // Первый запуск — пошаговый мастер (кнопка из бота может сразу открыть шаг «Меню»).
  if (!state.config.settings.setup_done && !recipeId) {
    if (params.get("setup") === "plan") store.set("setupStep", 2);
    return go("setup");
  }
  const tab = params.get("tab");
  go({ today: "home", week: "week", shop: "shop", balance: "balance", recipes: "recipes" }[tab] || "home");
  if (recipeId) openRecipe(recipeId);
  else showOnboarding();
})();
