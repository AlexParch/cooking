// «Ещё»: баланс питания, шпаргалка замен, настройки, помощь и знакомство.
import { openFridge, openIdea } from "./add.js";
import { $, $$, api, bus, esc, guard, haptic, hint, openSheet, sheetHead, state, store, toast } from "./ui.js";
import { bindFamilyGrid, familyGridHtml, hasFamily, members, mountMembersEditor } from "./members.js";

export function renderMore(view) {
  view.innerHTML = `
    <div class="page-head"><h1>☰ Ещё</h1></div>
    <div class="list big-list">
      <button class="row-item" data-go="balance"><span class="row-emoji">📊</span><span class="row-main"><span class="row-title">Баланс питания</span><span class="row-sub">чего не хватало на неделе</span></span><span class="row-arrow">›</span></button>
      <button class="row-item" data-open="fridge"><span class="row-emoji">🧺</span><span class="row-main"><span class="row-title">Что приготовить из того, что есть</span><span class="row-sub">по фото или списку продуктов</span></span><span class="row-arrow">›</span></button>
      <button class="row-item" data-open="idea"><span class="row-emoji">✨</span><span class="row-main"><span class="row-title">Придумать новое блюдо</span><span class="row-sub">без глютена и сахара</span></span><span class="row-arrow">›</span></button>
      <button class="row-item" data-open="subs"><span class="row-emoji">🔄</span><span class="row-main"><span class="row-title">Чем заменить</span><span class="row-sub">мука, сахар, панировка, макароны…</span></span><span class="row-arrow">›</span></button>
      <button class="row-item" data-open="settings"><span class="row-emoji">⚙️</span><span class="row-main"><span class="row-title">Настройки</span><span class="row-sub">размер семьи, напоминания</span></span><span class="row-arrow">›</span></button>
      <button class="row-item" data-open="help"><span class="row-emoji">❓</span><span class="row-main"><span class="row-title">Как пользоваться</span><span class="row-sub">короткая инструкция</span></span><span class="row-arrow">›</span></button>
    </div>`;
  $$("[data-go]", view).forEach((b) => (b.onclick = () => ((state.balanceMember = null), bus.go(b.dataset.go))));
  $$("[data-open]", view).forEach(
    (b) => (b.onclick = () => ({ fridge: openFridge, idea: () => openIdea(), subs: openSubstitutions, settings: openSettings, help: () => showOnboarding(true) })[b.dataset.open]()),
  );
}

// ---------- баланс ----------
let balanceDays = 7;

export async function renderBalance(view) {
  const member = hasFamily() ? members().find((m) => m.id === state.balanceMember) : null;
  const [balance, family] = await Promise.all([
    api(`/balance?days=${balanceDays}${member ? `&member=${member.id}` : ""}`),
    hasFamily() && !member ? api(`/balance/family?days=${balanceDays}`) : Promise.resolve([]),
  ]);
  const need = balance.filter((b) => b.status !== "ok");
  view.innerHTML = `
    <div class="page-head"><button class="back-link" data-go="more">‹ Назад</button><h1>📊 ${member ? `${member.emoji} ${esc(member.name)}` : "Баланс питания"}</h1></div>
    ${hint("balance", "Здесь видно, сколько раз за период в меню были разные продукты. <b>Зелёная</b> полоска — всё хорошо, <b>жёлтая</b> — маловато, <b>красная</b> — не было совсем. Считается по тому, что вы отмечаете «Съели».")}
    ${
      hasFamily()
        ? `<div class="chips scroll-x">${[{ id: 0, emoji: "👨‍👩‍👧‍👦", name: "Вся семья" }, ...members()]
            .map((m) => `<button class="chip ${(member?.id ?? 0) === m.id ? "on" : ""}" data-member="${m.id}">${m.emoji} ${esc(m.name)}</button>`)
            .join("")}</div>`
        : ""
    }
    <div class="chips">${[7, 14, 30].map((d) => `<button class="chip ${d === balanceDays ? "on" : ""}" data-days="${d}">${d} дней</button>`).join("")}</div>
    ${family.length ? `<div class="card">${familyGridHtml(family, balanceDays)}</div>` : ""}
    ${
      need.length
        ? `<div class="card"><h3>${member ? `Чего не хватает: ${esc(member.name)}` : hasFamily() ? "Чего не хватает (хоть кому-то)" : "Чего не хватает"}</h3>${need
            .slice(0, 6)
            .map((b) => `<div class="need"><b>${b.emoji} ${esc(b.name)}</b> <span class="muted">${b.count === 0 ? (b.daysSince == null ? "давно не было" : `не было ${b.daysSince} дн.`) : `${b.count} из ${b.target}`}</span><div class="muted small">Идеи: ${esc(b.ideas.join(", "))}</div></div>`)
            .join("")}
            ${state.config.ai ? `<button class="big-btn primary block" data-idea>✨ Придумать блюдо с этим</button>` : ""}</div>`
        : `<div class="card center">🎉 Всё разнообразно — так держать!</div>`
    }
    <div class="card">${balance
      .map((b) => {
        const pct = Math.min(100, Math.round((b.count / b.target) * 100));
        return `<div class="bar-row"><div class="bar-label"><span>${b.emoji} ${esc(b.name)}</span><span class="muted">${b.count} из ${b.target}</span></div><div class="bar ${b.status}"><i style="width:${Math.max(pct, b.count ? 6 : 0)}%"></i></div></div>`;
      })
      .join("")}</div>
    <p class="muted small">Цифра справа — сколько раз было и сколько желательно за период для разнообразия.</p>`;
  $$("[data-days]", view).forEach((c) => (c.onclick = () => ((balanceDays = Number(c.dataset.days)), bus.render())));
  $$("[data-member]", view).forEach((c) => (c.onclick = () => ((state.balanceMember = Number(c.dataset.member) || null), bus.render())));
  bindFamilyGrid(view, (id) => ((state.balanceMember = id), bus.render()));
  $$("[data-go]", view).forEach((b) => (b.onclick = () => bus.go(b.dataset.go)));
  const idea = $("[data-idea]", view);
  if (idea) idea.onclick = () => openIdea();
}

// ---------- замены ----------
const SUBS = [
  ["🌾 Пшеничная мука", "Рисовая, кукурузная, миндальная, гречневая или нутовая мука. Для соусов — кукурузный или картофельный крахмал."],
  ["🍞 Панировочные сухари", "Молотый миндаль, кукурузная крупа, молотый лён или кунжут, кокосовая стружка."],
  ["🍝 Макароны", "Гречневая лапша (100% гречка), рисовая лапша, фунчоза, «спагетти» из кабачка."],
  ["🥖 Хлеб", "Хлебцы из гречки или риса (проверьте состав), листья салата вместо булки, безглютеновый хлеб."],
  ["🥣 Манка, булгур, кускус", "Кукурузная крупа, рисовая крупка, киноа, пшено."],
  ["🥣 Овсянка", "Только с пометкой «без глютена». Или гречневые, рисовые, киноа-хлопья."],
  ["🍬 Сахар", "Эритрит или стевия. В выпечке для детей — спелый банан или яблочное пюре."],
  ["🍯 Мёд, сиропы", "Эритрит, стевия. В каше — ягоды, корица, ваниль."],
  ["🍫 Шоколад", "Какао-порошок без сахара или горький шоколад 85%+ на эритрите."],
  ["🍅 Кетчуп", "Томатная паста + чеснок + паприка + капля лимона."],
  ["🥚 Майонез", "Греческий йогурт + горчица + лимонный сок + соль."],
  ["🥢 Соевый соус", "Тамари без пшеницы (смотрите состав) или кокосовые аминосы."],
];
const HIDDEN = [
  ["Глютен прячется в", "колбасе и сосисках, крабовых палочках, бульонных кубиках, готовых смесях специй, соусах, овсянке без маркировки, пиве."],
  ["Сахар прячется в", "кетчупе и соусах, сладких йогуртах, мюсли и гранолах, консервированной кукурузе и горошке, «фитнес»-батончиках, копчёностях."],
];

function openSubstitutions() {
  openSheet(
    `${sheetHead("🔄 Чем заменить")}
     ${SUBS.map(([what, how]) => `<div class="sub"><b>${what}</b><div>${esc(how)}</div></div>`).join("")}
     <h3>Будьте внимательны</h3>
     ${HIDDEN.map(([what, how]) => `<div class="notice warn"><b>${what}</b> ${esc(how)}</div>`).join("")}
     <p class="muted small">Совет: смотрите состав на упаковке — ищите слова «пшеничн», «глютен», «сахар», «сироп», «декстроза», «мальтодекстрин».</p>`,
  );
}

// ---------- настройки ----------
function openSettings() {
  const s = { ...state.config.settings };
  const hours = (from, to, sel) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${h}:00</option>`).join("");
  openSheet(
    `${sheetHead("⚙️ Настройки")}
     <h3>👨‍👩‍👧‍👦 Семья</h3>
     <p class="muted small">Для каждого считается свой баланс. Сколько человек — на столько порций пересчитываю продукты. Нажмите на значок, чтобы сменить его.</p>
     <div id="members"></div>
     <div class="setting">
       <label class="check-row"><input type="checkbox" id="nm" ${s.notify_morning ? "checked" : ""}/><span><b>☀️ Утром присылать меню на день</b><br><small class="muted">и напоминать, что достать из морозилки</small></span></label>
       <select id="mh">${hours(5, 12, s.morning_hour)}</select>
     </div>
     <div class="setting">
       <label class="check-row"><input type="checkbox" id="ne" ${s.notify_evening ? "checked" : ""}/><span><b>🌙 Вечером напоминать</b><br><small class="muted">что замочить на завтра, и спросить, понравилась ли еда</small></span></label>
       <select id="eh">${hours(16, 23, s.evening_hour)}</select>
     </div>
     <div class="setting">
       <label class="check-row"><input type="checkbox" id="me" ${state.config.me?.notify !== false ? "checked" : ""}/><span><b>Присылать напоминания мне</b><br><small class="muted">можно выключить только для себя, у остальных останутся</small></span></label>
     </div>
     ${!state.config.me ? `<div class="notice">Чтобы получать сообщения, напишите боту в чат /start</div>` : ""}
     <button class="big-btn primary block" id="save">Сохранить</button>`,
    (root) => {
      mountMembersEditor($("#members", root), { onChange: (list) => (s.family_size = list.length || s.family_size) });
      $("#save", root).onclick = () =>
        guard(async () => {
          const settings = await api("/settings", {
            method: "PUT",
            body: {
              notify_morning: $("#nm", root).checked,
              morning_hour: Number($("#mh", root).value),
              notify_evening: $("#ne", root).checked,
              evening_hour: Number($("#eh", root).value),
            },
          });
          if (state.config.me) await api("/me", { method: "PUT", body: { notify: $("#me", root).checked } });
          state.config.settings = settings;
          if (state.config.me) state.config.me.notify = $("#me", root).checked;
          haptic();
          toast("Настройки сохранены");
          $("[data-close]", root).click();
        });
    },
  );
}

// ---------- знакомство ----------
const SLIDES = [
  ["👋", "Привет! Это ваша кухня", "Здесь хранятся ваши рецепты, меню на неделю и список покупок. Всё общее для семьи — муж видит то же самое."],
  ["🎙", "Рецепты — голосом", "Нажмите «Добавить рецепт» и просто расскажите, как готовите. Я сама запишу продукты и шаги. Ещё можно сфотографировать страницу из книги или вставить ссылку."],
  ["🗓", "Меню на неделю — одной кнопкой", "Я подберу блюда из ваших рецептов так, чтобы было разнообразно: и рыба, и бобовые, и яйца. А потом сама соберу список покупок."],
  ["✅", "Отмечайте, что съели", "Нажимайте «Съели» на главном экране. Так я пойму, чего не хватает, и буду подсказывать. А ещё утром пришлю меню и напомню с вечера замочить нут."],
];

export function showOnboarding(force = false) {
  if (!force && store.get("onboarded")) return;
  const el = $("#onboard");
  let i = 0;
  const render = () => {
    const [icon, title, text] = SLIDES[i];
    el.innerHTML = `<div class="onb">
      <div class="onb-icon">${icon}</div><h1>${title}</h1><p>${text}</p>
      <div class="dots">${SLIDES.map((_, n) => `<i class="${n === i ? "on" : ""}"></i>`).join("")}</div>
      <button class="big-btn primary block" id="onb-next">${i < SLIDES.length - 1 ? "Дальше" : "Начать 🚀"}</button>
      ${i < SLIDES.length - 1 ? `<button class="link block" id="onb-skip">Пропустить</button>` : ""}
    </div>`;
    $("#onb-next", el).onclick = () => (i < SLIDES.length - 1 ? (i++, haptic("light"), render()) : done());
    const skip = $("#onb-skip", el);
    if (skip) skip.onclick = done;
  };
  const done = () => {
    store.set("onboarded", true);
    el.classList.add("hidden");
  };
  el.classList.remove("hidden");
  render();
}
