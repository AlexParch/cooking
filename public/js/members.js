// Члены семьи: редактор, выбор «Кто ел?», таблица «кто что ел» для главной.
import { $, $$, api, esc, guard, haptic, state, toast } from "./ui.js";

export const members = () => state.config.members || [];
export const hasFamily = () => members().length >= 2;

const EMOJIS = ["👩", "👨", "👧", "👦", "🧒", "👶", "👵", "👴", "🙂"];

/** Аватарки тех, кто ел (или для кого блюдо в меню), если это не вся семья. */
export function eatersBadge(eaters, prefix = "") {
  if (!eaters?.length || !hasFamily()) return "";
  const who = members().filter((m) => eaters.includes(m.id));
  if (!who.length) return "";
  return `<span class="eaters" title="${esc(who.map((m) => m.name).join(", "))}">${prefix}${who.map((m) => m.emoji).join("")} <small>${esc(who.map((m) => m.name).join(", "))}</small></span>`;
}

/** Члены семьи, которым в этой клетке меню ещё не выбрано блюдо. */
export function uncovered(items) {
  if (!hasFamily() || !items.length || items.some((p) => !p.eaters?.length)) return [];
  const ids = new Set(items.flatMap((p) => p.eaters));
  return members().filter((m) => !ids.has(m.id));
}

// ---------- «Кто ел?» ----------
export function whoAteHtml(selected = null, { title = "Кто ел?", note = "Снимите тех, кто ел что-то другое" } = {}) {
  if (!hasFamily()) return "";
  const sel = selected ?? members().map((m) => m.id);
  return `<div class="who-ate"><h3>${title}</h3>
    <p class="muted small">${note}</p>
    <div class="chips who" data-who>${members()
      .map((m) => `<button type="button" class="chip ${sel.includes(m.id) ? "on" : ""}" data-member="${m.id}">${m.emoji} ${esc(m.name)}</button>`)
      .join("")}</div></div>`;
}

/** Выбранные id; null — если выбраны все (так и хранится «вся семья»). */
export function whoAteValue(root, empty = "Отметьте, кто ел") {
  const box = $("[data-who]", root);
  if (!box) return null;
  const ids = $$(".chip.on", box).map((c) => Number(c.dataset.member));
  if (!ids.length) throw new Error(empty);
  return ids.length === members().length ? null : ids;
}

document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-who] .chip");
  if (!chip) return;
  chip.classList.toggle("on");
  haptic("light");
});

// ---------- таблица «кто что ел» ----------
const GRID_CATS = ["meat", "poultry", "fish", "eggs", "legumes", "dairy", "vegetables", "fruits"];
const STATUS = { ok: { icon: "✓", label: "хватает" }, low: { icon: "!", label: "мало" }, missing: { icon: "—", label: "не было" } };

function cellText(b) {
  if (b.status === "missing") return b.daysSince == null ? "давно не было" : `не было ${b.daysSince} дн.`;
  return `${b.count} из ${b.target}${b.status === "ok" ? " — хватает" : " — маловато"}`;
}

export function familyGridHtml(family, days = 7) {
  if (!family?.length) return "";
  const cats = GRID_CATS.map((k) => family[0].balance.find((b) => b.key === k)).filter(Boolean);
  // Короткие выводы: какую группу кто ещё не ел.
  const gaps = cats
    .map((c) => ({ c, who: family.filter((f) => f.balance.find((b) => b.key === c.key).status === "missing").map((f) => f.member.name) }))
    .filter((g) => g.who.length)
    .sort((a, b) => b.who.length - a.who.length)
    .slice(0, 3);
  return `
    <div class="fam-grid" style="--cols:${cats.length}" role="table" aria-label="Кто что ел за ${days} дней">
      <div class="fg-row fg-head" role="row"><span class="fg-name" role="columnheader"></span>${cats
        .map((c) => `<span class="fg-cat" role="columnheader" title="${esc(c.name)}">${c.emoji}</span>`)
        .join("")}</div>
      ${family
        .map(
          (f) => `<div class="fg-row" role="row">
            <button class="fg-name" data-member-balance="${f.member.id}" role="rowheader">${f.member.emoji} <span>${esc(f.member.name)}</span></button>
            ${cats
              .map((c) => {
                const b = f.balance.find((x) => x.key === c.key);
                return `<button class="fg-cell ${b.status}" role="cell" data-tip="${esc(`${f.member.name} · ${c.name}: ${cellText(b)}`)}" aria-label="${esc(`${c.name}: ${STATUS[b.status].label}`)}">${
                  b.status === "missing" ? STATUS.missing.icon : b.status === "ok" ? `${STATUS.ok.icon}` : b.count
                }</button>`;
              })
              .join("")}
          </div>`,
        )
        .join("")}
    </div>
    <div class="fg-legend"><span><i class="fg-dot ok">✓</i> хватает</span><span><i class="fg-dot low">1</i> мало</span><span><i class="fg-dot missing">—</i> не было</span></div>
    ${
      gaps.length
        ? `<div class="fg-gaps">${gaps
            .map((g) => `<div>${g.c.emoji} <b>${esc(g.c.name)}</b> ${g.who.length === family.length ? "ещё никто не ел" : `ещё не ели: ${esc(g.who.join(", "))}`}</div>`)
            .join("")}</div>`
        : `<div class="fg-gaps ok">🎉 У всех разнообразно!</div>`
    }`;
}

export function bindFamilyGrid(root, onMember) {
  $$(".fg-cell", root).forEach((c) => (c.onclick = () => (haptic("light"), toast(c.dataset.tip, 3000))));
  $$("[data-member-balance]", root).forEach((b) => (b.onclick = () => onMember?.(Number(b.dataset.memberBalance))));
}

// ---------- редактор семьи ----------
export async function mountMembersEditor(container, { onChange } = {}) {
  const list = members();
  container.innerHTML = `
    <div class="members-list">${list
      .map(
        (m) => `<div class="member-row" data-id="${m.id}">
          <button class="member-emoji" title="Сменить значок">${m.emoji}</button>
          <input class="member-name" value="${esc(m.name)}" placeholder="Имя" maxlength="40" />
          <button class="close-btn member-del" aria-label="Удалить">✕</button>
        </div>`,
      )
      .join("")}</div>
    <div class="row-btns">
      <button class="btn secondary grow" data-add="adult">＋ Взрослый</button>
      <button class="btn secondary grow" data-add="child">＋ Ребёнок</button>
    </div>`;

  const refresh = async (updated) => {
    state.config.members = updated;
    state.config.settings.family_size = updated.length || state.config.settings.family_size;
    await mountMembersEditor(container, { onChange });
    onChange?.(updated);
  };
  const save = (row, patch) =>
    guard(async () => {
      const m = list.find((x) => x.id === Number(row.dataset.id));
      const updated = await api(`/members/${m.id}`, { method: "PUT", body: { ...m, ...patch } });
      state.config.members = updated;
      onChange?.(updated);
    });

  $$(".member-row", container).forEach((row) => {
    const m = list.find((x) => x.id === Number(row.dataset.id));
    $(".member-emoji", row).onclick = () => {
      const next = EMOJIS[(EMOJIS.indexOf(m.emoji) + 1) % EMOJIS.length];
      $(".member-emoji", row).textContent = next;
      m.emoji = next;
      haptic("light");
      save(row, { emoji: next });
    };
    const input = $(".member-name", row);
    input.onchange = () => input.value.trim() && save(row, { name: input.value.trim() });
    $(".member-del", row).onclick = () =>
      guard(async () => {
        if (list.length <= 1) return toast("Должен остаться хотя бы один человек");
        await refresh(await api(`/members/${m.id}`, { method: "DELETE" }));
      });
  });
  $$("[data-add]", container).forEach(
    (b) =>
      (b.onclick = () =>
        guard(async () => {
          const kind = b.dataset.add;
          const updated = await api("/members", { method: "POST", body: { kind, emoji: kind === "child" ? "🧒" : "🙂", name: "" } });
          haptic();
          await refresh(updated);
          // Сразу фокус на имя нового, чтобы вписать.
          const inputs = $$(".member-name", container);
          const last = inputs[inputs.length - 1];
          last?.focus();
          last?.select();
        })),
  );
}

/** Если семьи ещё нет — создаём «Мама» и «Папа», чтобы было с чего начать. */
export async function ensureDefaultMembers() {
  if (members().length) return;
  await api("/members", { method: "POST", body: { name: "Мама", emoji: "👩" } });
  state.config.members = await api("/members", { method: "POST", body: { name: "Папа", emoji: "👨" } });
}
