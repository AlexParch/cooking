// Справочник групп продуктов, недельные ориентиры и логика «чего не хватает».

export const MEAL_TYPES = {
  breakfast: "Завтрак",
  lunch: "Обед",
  snack: "Полдник",
  dinner: "Ужин",
} as const;
export type MealType = keyof typeof MEAL_TYPES;
export const MEAL_TYPE_KEYS = Object.keys(MEAL_TYPES) as MealType[];

export interface Category {
  key: string;
  name: string;
  emoji: string;
  /** Сколько раз в неделю хорошо бы встречаться в рационе. */
  perWeek: number;
  /** Корни слов для автоопределения по ингредиентам. */
  keywords: string[];
  /** Что можно добавить, если группы не хватает. */
  ideas: string[];
}

export const CATEGORIES: Category[] = [
  {
    key: "meat", name: "Мясо", emoji: "🥩", perWeek: 2,
    keywords: ["говядин", "телятин", "свинин", "баранин", "фарш", "мяс", "стейк", "кролик"],
    ideas: ["тушёная говядина с овощами", "тефтели без хлеба", "кролик в сметане"],
  },
  {
    key: "poultry", name: "Птица", emoji: "🍗", perWeek: 3,
    keywords: ["куриц", "курин", "индейк", "индюш", "утк", "филе бедр", "окорочк", "грудк"],
    ideas: ["запечённые бёдра", "котлеты из индейки", "курица с брокколи"],
  },
  {
    key: "fish", name: "Рыба", emoji: "🐟", perWeek: 2,
    keywords: ["рыб", "лосос", "сёмг", "семг", "форел", "треск", "минта", "скумбри", "сельд", "тунец", "хек", "судак", "дорадо", "сибас", "горбуш"],
    ideas: ["запечённая скумбрия", "треска на пару", "салат с тунцом"],
  },
  {
    key: "seafood", name: "Морепродукты", emoji: "🦐", perWeek: 1,
    keywords: ["кревет", "кальмар", "мидии", "мидий", "осьмин", "гребеш", "краб"],
    ideas: ["креветки с кабачком", "салат с кальмаром"],
  },
  {
    key: "offal", name: "Субпродукты", emoji: "🫀", perWeek: 1,
    keywords: ["печен", "печён", "сердечк", "желудочк", "язык"],
    ideas: ["куриная печень с луком", "печёночные оладьи на рисовой муке"],
  },
  {
    key: "eggs", name: "Яйца", emoji: "🥚", perWeek: 4,
    keywords: ["яйц", "яиц", "яичн", "омлет", "перепел"],
    ideas: ["омлет с овощами", "фриттата", "яйца пашот на салате"],
  },
  {
    key: "legumes", name: "Бобовые", emoji: "🫘", perWeek: 3,
    keywords: ["фасол", "чечевиц", "нут", "горох", "горош", "маш", "хумус", "бобы", "эдамаме", "соя"],
    ideas: ["чечевичный суп", "хумус с овощами", "салат с фасолью", "нут с овощами в духовке"],
  },
  {
    key: "dairy", name: "Молочное", emoji: "🧀", perWeek: 4,
    keywords: ["творог", "сыр", "йогурт", "кефир", "молок", "сметан", "сливк", "брынз", "моцарел", "рикотт"],
    ideas: ["сырники на рисовой муке", "творог с ягодами", "запеканка"],
  },
  {
    key: "grains", name: "Крупы без глютена", emoji: "🌾", perWeek: 5,
    keywords: ["гречк", "гречнев", "рис", "киноа", "пшен", "амарант", "кукуруз", "овсян", "полент", "булгур"],
    ideas: ["гречка с грибами", "киноа-салат", "пшённая каша с тыквой"],
  },
  {
    key: "vegetables", name: "Овощи", emoji: "🥦", perWeek: 12,
    keywords: ["кабач", "брокко", "капуст", "морков", "свёкл", "свекл", "тыкв", "перец", "томат", "помидор", "огур", "баклажан", "лук", "цветн", "стручк", "спарж", "сельдер", "редис", "картоф"],
    ideas: ["овощное рагу", "запечённые овощи", "крем-суп из тыквы"],
  },
  {
    key: "greens", name: "Зелень и листья", emoji: "🥬", perWeek: 5,
    keywords: ["шпинат", "руккол", "салат", "зелень", "укроп", "петруш", "кинз", "базилик", "щавел", "мангольд"],
    ideas: ["шпинат в омлет", "салат с рукколой", "зелёный смузи"],
  },
  {
    key: "fruits", name: "Фрукты и ягоды", emoji: "🍓", perWeek: 5,
    keywords: ["яблок", "груш", "банан", "ягод", "клубник", "черник", "малин", "апельсин", "мандарин", "киви", "авокадо", "лимон", "вишн"],
    ideas: ["ягоды к творогу", "печёное яблоко с корицей"],
  },
  {
    key: "nuts", name: "Орехи и семена", emoji: "🥜", perWeek: 4,
    keywords: ["орех", "миндал", "кешью", "фундук", "семеч", "семен", "кунжут", "чиа", "лён", "льнян", "тыквенн"],
    ideas: ["горсть орехов на полдник", "чиа-пудинг", "кунжут в салат"],
  },
  {
    key: "mushrooms", name: "Грибы", emoji: "🍄", perWeek: 1,
    keywords: ["гриб", "шампиньон", "вешенк", "опят", "лисич", "белые"],
    ideas: ["гречка с грибами", "грибной крем-суп без муки"],
  },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
const byKey = new Map(CATEGORIES.map((c) => [c.key, c]));
export const categoryByKey = (key: string) => byKey.get(key);

/** Грубое определение групп по названиям ингредиентов (запасной вариант без ИИ). */
export function detectCategories(texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    const hay = text.toLowerCase().replace(/ё/g, "е");
    const here = CATEGORIES.filter((c) =>
      c.keywords.some((kw) => {
        const k = kw.toLowerCase().replace(/ё/g, "е");
        // Короткие корни ищем с начала слова, чтобы «рис» не находился в «барбарисе».
        return new RegExp(`(^|[^а-яa-z])${k}`, "i").test(hay);
      }),
    ).map((c) => c.key);
    // «Куриный фарш», «рыбный фарш» — это птица/рыба, а не мясо.
    const skipMeat = here.includes("meat") && (here.includes("poultry") || here.includes("fish"));
    for (const k of here) if (!(k === "meat" && skipMeat)) found.add(k);
  }
  return [...found];
}

export interface MealRecord {
  date: string; // YYYY-MM-DD
  meal_type: string;
  recipe_id: number | null;
  categories: string[];
  /** Кто ел (id членов семьи). null/пусто — вся семья. */
  eaters?: number[] | null;
}

/** Что ел конкретный человек: его блюда плюс общие «для всей семьи». */
export const mealsOf = <M extends MealRecord>(meals: M[], memberId: number): M[] =>
  meals.filter((m) => !m.eaters?.length || m.eaters.includes(memberId));

export interface MemberLite {
  id: number;
  name: string;
  emoji: string;
}

/** Баланс по каждому члену семьи. */
export function computeFamilyBalance<T extends MemberLite>(meals: MealRecord[], members: T[], today: string, days = 7) {
  return members.map((member) => ({ member, balance: computeBalance(mealsOf(meals, member.id), today, days) }));
}

/**
 * Общий баланс семьи для подсказок: если кто-то недоел рыбы — рыбы «мало», даже если родители ели.
 * Берём по каждой группе худший результат среди членов семьи.
 */
export function worstBalance(perMember: { balance: CategoryBalance[] }[]): CategoryBalance[] {
  if (!perMember.length) return [];
  return perMember[0].balance.map((b, i) => {
    const all = perMember.map((p) => p.balance[i]);
    const worst = all.reduce((a, x) => (x.count < a.count ? x : a));
    const since = all.map((x) => x.daysSince);
    return { ...worst, daysSince: since.includes(null) ? null : Math.max(...(since as number[])) };
  });
}

export interface CategoryBalance {
  key: string;
  name: string;
  emoji: string;
  count: number;
  target: number;
  /** Дней с последнего раза; null — не было за весь просмотренный период. */
  daysSince: number | null;
  status: "ok" | "low" | "missing";
  ideas: string[];
}

export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Баланс за `days` дней, заканчивая `today` включительно.
 * `meals` может содержать и более ранние записи — они используются для «давно не было».
 */
export function computeBalance(meals: MealRecord[], today: string, days = 7): CategoryBalance[] {
  const from = addDays(today, -(days - 1));
  return CATEGORIES.map((c) => {
    let count = 0;
    let last: string | null = null;
    for (const m of meals) {
      if (m.date > today || !m.categories.includes(c.key)) continue;
      if (m.date >= from) count++;
      if (!last || m.date > last) last = m.date;
    }
    const target = Math.max(1, Math.round((c.perWeek * days) / 7));
    const status = count === 0 ? "missing" : count < target * 0.6 ? "low" : "ok";
    return {
      key: c.key,
      name: c.name,
      emoji: c.emoji,
      count,
      target,
      daysSince: last ? daysBetween(last, today) : null,
      status,
      ideas: c.ideas,
    };
  });
}

export interface RecipeLite {
  id: number;
  title: string;
  meal_types: string[];
  categories: string[];
  likes?: number;
  dislikes?: number;
}

export interface Suggestion<R extends RecipeLite = RecipeLite> {
  recipe: R;
  score: number;
  reasons: string[];
}

/** Подбирает рецепты из базы, которые закрывают недостающие группы и давно не готовились. */
export function suggestRecipes<R extends RecipeLite>(
  recipes: R[],
  meals: MealRecord[],
  today: string,
  mealType?: string,
  limit = 5,
  familyBalance?: CategoryBalance[],
): Suggestion<R>[] {
  const balance = new Map((familyBalance ?? computeBalance(meals, today, 7)).map((b) => [b.key, b]));
  const lastCooked = new Map<number, string>();
  for (const m of meals) {
    if (m.recipe_id == null) continue;
    const prev = lastCooked.get(m.recipe_id);
    if (!prev || m.date > prev) lastCooked.set(m.recipe_id, m.date);
  }

  const scored = recipes
    .filter((r) => !mealType || r.meal_types.length === 0 || r.meal_types.includes(mealType))
    .map((recipe) => {
      let score = 0;
      const reasons: string[] = [];
      for (const key of recipe.categories) {
        const b = balance.get(key);
        if (!b) continue;
        const deficit = Math.max(0, b.target - b.count) / b.target;
        score += deficit * 3;
        if (b.count > b.target * 1.5) score -= 0.5;
        if (b.status === "missing") reasons.push(`${b.emoji} ${b.name}: не было ${b.daysSince == null ? "давно" : `${b.daysSince} дн.`}`);
        else if (b.status === "low") reasons.push(`${b.emoji} ${b.name}: мало (${b.count} из ${b.target})`);
      }
      const last = lastCooked.get(recipe.id);
      if (last) {
        const ago = daysBetween(last, today);
        if (ago <= 2) score -= 4;
        else if (ago <= 6) score -= 1.5;
        else if (ago >= 14) {
          score += 1;
          reasons.push(`давно не готовили (${ago} дн.)`);
        }
      } else {
        score += 0.5;
        reasons.push("ещё не готовили");
      }
      if (mealType && recipe.meal_types.includes(mealType)) score += 0.5;
      // Оценки семьи: любимое предлагаем чаще, неудачное — реже.
      const likes = recipe.likes ?? 0;
      const dislikes = recipe.dislikes ?? 0;
      if (likes || dislikes) {
        score += Math.min(2, likes * 0.4) - dislikes * 1.2;
        if (likes >= 3 && likes > dislikes * 2) reasons.push("❤️ семья любит");
      }
      return { recipe, score, reasons };
    });

  scored.sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title));
  return scored.slice(0, limit);
}

/** Короткое текстовое резюме баланса для бота и для подсказки ИИ. */
export function balanceSummary(balance: CategoryBalance[]): { missing: string[]; low: string[]; plenty: string[] } {
  return {
    missing: balance.filter((b) => b.status === "missing").map((b) => b.name),
    low: balance.filter((b) => b.status === "low").map((b) => b.name),
    plenty: balance.filter((b) => b.count > b.target * 1.5).map((b) => b.name),
  };
}
