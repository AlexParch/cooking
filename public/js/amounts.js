// Пересчёт количеств под нужное число порций.
// Общий модуль: используется и в WebApp, и на сервере (список покупок).

const FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
// число: 2 | 1,5 | 0.5 | 1/2 | ½ | 1½ ; не трогаем проценты («творог 5%»)
const NUM = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?[½¼¾⅓⅔]?|[½¼¾⅓⅔])(?!\s*%)/g;

/** @param {string} s */
export function parseNumber(s) {
  s = s.trim();
  let extra = 0;
  const last = s.slice(-1);
  if (last in FRACTIONS) {
    extra = FRACTIONS[last];
    s = s.slice(0, -1).trim();
    if (!s) return extra;
  }
  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => Number(x.trim()));
    return b ? a / b + extra : NaN;
  }
  return Number(s.replace(",", ".")) + extra;
}

/** Красиво округляет: 0,3 → 0,3; 1,26 → 1,5; 13 → 13; 262 → 260. @param {number} n */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return "";
  let r;
  if (n < 1) r = Math.round(n * 4) / 4 || Math.round(n * 10) / 10;
  else if (n < 10) r = Math.round(n * 2) / 2;
  else if (n < 50) r = Math.round(n);
  else if (n < 200) r = Math.round(n / 5) * 5;
  else r = Math.round(n / 10) * 10;
  return String(r).replace(".", ",");
}

/**
 * Умножает все числа в строке количества: «200 г» ×1,5 → «300 г», «1/2 ч. л.» ×2 → «1 ч. л.».
 * @param {string | undefined | null} amount
 * @param {number} factor
 */
export function scaleAmount(amount, factor) {
  if (!amount || !Number.isFinite(factor) || Math.abs(factor - 1) < 0.01) return amount || "";
  return amount.replace(NUM, (m) => {
    const n = parseNumber(m);
    return Number.isFinite(n) ? formatNumber(n * factor) : m;
  });
}

/**
 * Разбирает «300 г» → { value: 300, unit: "г" }. Для сложения одинаковых продуктов в списке покупок.
 * @param {string | undefined | null} amount
 * @returns {{ value: number, unit: string } | null}
 */
export function parseQuantity(amount) {
  const m = (amount || "").trim().match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?[½¼¾⅓⅔]?|[½¼¾⅓⅔])\s*(.*)$/);
  if (!m) return null;
  const value = parseNumber(m[1]);
  const unit = m[2].trim().toLowerCase().replace(/\.$/, "");
  if (!Number.isFinite(value) || unit.length > 12 || /\d/.test(unit)) return null;
  return { value, unit };
}

/** Коэффициент пересчёта: рецепт на `from` порций, готовим на `to`. */
export function servingsFactor(from, to) {
  return from && to ? to / from : 1;
}
