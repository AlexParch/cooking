export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  TZ: string;
  ANTHROPIC_MODEL: string;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ALLOWED_USER_IDS: string;
  ANTHROPIC_API_KEY?: string;
  DEV_AUTH?: string;
}

export const allowedIds = (env: Env) =>
  new Set(
    (env.ALLOWED_USER_IDS ?? "")
      .split(/[,\s]+/)
      .map((s) => Number(s))
      .filter(Boolean),
  );

/** Сегодняшняя дата YYYY-MM-DD в часовом поясе семьи. */
export function today(env: Pick<Env, "TZ">, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env.TZ || "Europe/Moscow" }).format(now);
}

/** Какой приём пищи логично планировать сейчас. */
export function currentMeal(env: Pick<Env, "TZ">, now = new Date()): "breakfast" | "lunch" | "snack" | "dinner" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: env.TZ || "Europe/Moscow", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 10) return "breakfast";
  if (hour < 14) return "lunch";
  if (hour < 17) return "snack";
  return "dinner";
}
