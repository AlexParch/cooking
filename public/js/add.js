// Добавление рецептов: голос, текст, ссылка, фото. И «что приготовить из того, что есть».
import { openEditor, openRecipe, recipeRow } from "./recipes.js";
import { $, $$, api, busy, esc, guard, haptic, openSheet, replaceSheet, sheetHead, state, toast } from "./ui.js";
import { mountRecorder } from "./voice.js";

const needAi = () => {
  if (state.config.ai) return true;
  toast("Эта функция заработает, когда подключат ключ Claude API", 4000);
  return false;
};

export function openAddRecipe() {
  openSheet(
    `${sheetHead("Добавить рецепт")}
     <p class="muted">Выберите, как удобнее. Я сама всё оформлю: продукты, шаги, время.</p>
     <div class="choice-list">
       <button class="choice" data-way="voice"><span class="choice-icon">🎙</span><span><b>Рассказать голосом</b><small>Просто расскажите рецепт, как подруге</small></span></button>
       <button class="choice" data-way="photo"><span class="choice-icon">📷</span><span><b>Сфотографировать</b><small>Страницу из книги или записку</small></span></button>
       <button class="choice" data-way="link"><span class="choice-icon">🔗</span><span><b>Вставить ссылку</b><small>С сайта — перепишу без глютена и сахара</small></span></button>
       <button class="choice" data-way="text"><span class="choice-icon">📝</span><span><b>Вставить текст</b><small>Скопированный рецепт или заметка</small></span></button>
       <button class="choice" data-way="manual"><span class="choice-icon">✍️</span><span><b>Заполнить самой</b><small>Название, продукты, шаги</small></span></button>
     </div>`,
    (root) => {
      $$("[data-way]", root).forEach(
        (b) =>
          (b.onclick = () => {
            const way = b.dataset.way;
            if (way === "manual") return openEditor(null, { title: "Новый рецепт" });
            if (way !== "voice" && !needAi()) return;
            ({ voice: openVoice, photo: openPhoto, link: openLink, text: openText })[way]();
          }),
      );
    },
  );
}

/** Показать разобранный ИИ рецепт: сохранить сразу или поправить. */
export async function reviewParsed(recipe) {
  haptic();
  openEditor(recipe, { title: "Проверьте рецепт" });
}

// ---------- голос ----------
/** Надиктовать рецепт: запись → текст → Claude оформляет → проверка и сохранение. */
export async function voiceToRecipe(text, setStatus) {
  if (!state.config.ai) return reviewParsed({ title: text.split(/[.!?\n]/)[0].slice(0, 60), notes: text, ingredients: [], steps: [], meal_types: [], categories: [], source: "voice" });
  setStatus(`<span class="spinner"></span> Оформляю рецепт…<br><small class="muted">«${esc(text.slice(0, 140))}${text.length > 140 ? "…" : ""}»</small>`);
  await reviewParsed(await api("/recipes/parse", { method: "POST", body: { text, source: "voice" } }));
}

function openVoice() {
  openSheet(
    `${sheetHead("🎙 Рассказать голосом")}
     <p class="muted">Нажмите на кнопку и расскажите: как называется блюдо, какие продукты и сколько, как готовить. Можно сбиваться — я разберусь.</p>
     <div id="rec"></div>
     <div class="notice">💬 <b>Можно и в чате:</b> отправьте боту обычное голосовое сообщение — я сохраню рецепт так же.</div>`,
    (root) => mountRecorder($("#rec", root), { idle: "Нажмите, чтобы начать", onText: voiceToRecipe }),
  );
}

// ---------- фото ----------
function pickPhoto(onFile) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => input.files?.[0] && onFile(input.files[0]);
  input.click();
}

/** Уменьшает фото до ~1600px, чтобы быстрее отправлялось. */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

async function sendPhoto(file, statusEl) {
  const form = new FormData();
  form.append("image", await shrink(file), "photo.jpg");
  statusEl.innerHTML = `<div class="empty"><span class="spinner"></span><br>Смотрю фото… это займёт до минуты</div>`;
  return api("/photo", { method: "POST", body: form });
}

function openPhoto() {
  openSheet(
    `${sheetHead("📷 Рецепт по фото")}
     <p class="muted">Сфотографируйте страницу из кулинарной книги, записку или экран с рецептом. Лучше ровно и при хорошем свете.</p>
     <button class="big-btn primary block" id="shot">📷 Сделать или выбрать фото</button><div id="status"></div>`,
    (root) => {
      $("#shot", root).onclick = () =>
        pickPhoto((file) =>
          guard(async () => {
            const res = await sendPhoto(file, $("#status", root));
            if (res.kind === "recipe") return reviewParsed(res.recipe);
            if (res.kind === "products") return showProducts(res.products, res.matches, true);
            $("#status", root).innerHTML = `<div class="notice">${esc(res.comment || "Не нашла на фото рецепта.")} Попробуйте ещё раз.</div>`;
          }),
        );
    },
  );
}

// ---------- ссылка ----------
function openLink() {
  openSheet(
    `${sheetHead("🔗 Рецепт по ссылке")}
     <p class="muted">Скопируйте адрес страницы с рецептом и вставьте сюда. Я уберу лишнее и заменю продукты с глютеном и сахаром.</p>
     <input id="url" type="url" inputmode="url" placeholder="https://…" />
     <button class="big-btn primary block" id="go">Загрузить рецепт</button>
     <p class="muted small">Из Instagram и закрытых сайтов загрузить не получится — тогда скопируйте текст рецепта и выберите «Вставить текст».</p>`,
    (root) => {
      $("#go", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Читаю страницу…", async () => {
            const url = $("#url", root).value.trim();
            if (!/^https?:\/\//.test(url)) throw new Error("Вставьте ссылку, которая начинается с https://");
            await reviewParsed(await api("/recipes/import", { method: "POST", body: { url } }));
          }),
        );
    },
  );
}

// ---------- текст ----------
function openText() {
  openSheet(
    `${sheetHead("📝 Вставить текст")}
     <p class="muted">Вставьте рецепт как есть — даже одним куском. Я разложу на продукты и шаги.</p>
     <textarea id="raw" rows="10" placeholder="Например: Суп из чечевицы. Чечевица 200 г, морковь, лук…"></textarea>
     <button class="big-btn primary block" id="go">✨ Оформить рецепт</button>`,
    (root) => {
      $("#go", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Оформляю…", async () => {
            const text = $("#raw", root).value.trim();
            if (text.length < 10) throw new Error("Вставьте текст рецепта");
            await reviewParsed(await api("/recipes/parse", { method: "POST", body: { text } }));
          }),
        );
    },
  );
}

// ---------- что приготовить из того, что есть ----------
export function openFridge() {
  openSheet(
    `${sheetHead("🧺 Что приготовить?")}
     <p class="muted">Сфотографируйте продукты (или открытый холодильник) — или просто напишите, что есть дома. Я найду подходящие рецепты.</p>
     ${state.config.ai ? `<button class="big-btn primary block" id="shot">📷 Сфотографировать продукты</button><div class="or">или</div>` : ""}
     <textarea id="products" rows="3" placeholder="Например: кабачок, фарш индейки, гречка, яйца"></textarea>
     <button class="big-btn block" id="find">🔍 Найти рецепты</button>
     <div id="status"></div>`,
    (root) => {
      const shot = $("#shot", root);
      if (shot)
        shot.onclick = () =>
          pickPhoto((file) =>
            guard(async () => {
              const res = await sendPhoto(file, $("#status", root));
              if (res.kind === "products") return showProducts(res.products, res.matches);
              if (res.kind === "recipe") return reviewParsed(res.recipe);
              $("#status", root).innerHTML = `<div class="notice">${esc(res.comment || "Не разглядела продукты.")} Попробуйте ещё раз или напишите списком.</div>`;
            }),
          );
      $("#find", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Ищу…", async () => {
            const products = $("#products", root).value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
            if (!products.length) throw new Error("Напишите хотя бы один продукт");
            const res = await api("/products", { method: "POST", body: { products } });
            showProducts(res.products, res.matches);
          }),
        );
    },
  );
}

function showProducts(products, matches, push = false) {
  const html = `${sheetHead("🧺 Что приготовить")}
    <div class="notice">Продукты: <b>${esc(products.join(", "))}</b></div>
    ${
      matches.length
        ? `<h3>Из ваших рецептов</h3><div class="list">${matches
            .map((m) => recipeRow(m.recipe, m.missing.length ? `докупить: ${m.missing.slice(0, 3).join(", ")}` : "✅ всё есть"))
            .join("")}</div>`
        : `<p class="muted">В книге пока нет подходящих рецептов.</p>`
    }
    ${state.config.ai ? `<button class="big-btn primary block" id="idea">✨ Придумать новое блюдо из этого</button><div id="idea-box"></div>` : ""}`;
  const mount = (root) => {
    $$("[data-open]", root).forEach((el) => (el.onclick = () => openRecipe(Number(el.dataset.open))));
    const btn = $("#idea", root);
    if (btn)
      btn.onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Придумываю…", async () => {
            const idea = await api("/idea", { method: "POST", body: { products } });
            await reviewParsed({ ...idea, source: "ai" });
          }),
        );
  };
  push ? openSheet(html, mount) : replaceSheet(html, mount);
}

/** Новая идея от ИИ под недостающие продукты. */
export function openIdea(meal = "") {
  if (!needAi()) return;
  openSheet(
    `${sheetHead("✨ Придумать блюдо")}
     <p class="muted">Я придумаю новое блюдо без глютена и сахара — с тем, чего не хватало в питании на этой неделе.</p>
     <h3>На какой приём пищи?</h3>
     <div class="chips" data-chips="im" data-single>
       ${[["", "Любой"], ["breakfast", "🍳 Завтрак"], ["lunch", "🍲 Обед"], ["snack", "🍎 Полдник"], ["dinner", "🌙 Ужин"]]
         .map(([k, l]) => `<button class="chip ${k === meal ? "on" : ""}" data-key="${k}">${l}</button>`)
         .join("")}
     </div>
     <label>Пожелание (можно пропустить)</label>
     <input id="wish" placeholder="Например: с кабачком, быстро, дети любят" />
     <button class="big-btn primary block" id="go">✨ Придумать</button>`,
    (root) => {
      $("#go", root).onclick = (e) =>
        guard(() =>
          busy(e.currentTarget, "Придумываю… (до минуты)", async () => {
            const m = $$("[data-chips=im] .chip.on", root)[0]?.dataset.key || "";
            const idea = await api("/idea", { method: "POST", body: { meal: m, wish: $("#wish", root).value } });
            await reviewParsed({ ...idea, source: "ai" });
          }),
        );
    },
  );
}
