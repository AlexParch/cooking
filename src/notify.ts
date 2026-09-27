// Утреннее и вечернее сообщения (Cron Trigger раз в час).
import { formatDay } from "./bot";
import { Repo } from "./db";
import { localHour, today, type Env } from "./env";
import { dayBrief, mealName } from "./service";
import { escapeHtml as h, Telegram } from "./telegram";

export async function runReminders(env: Env, now = new Date(), origin = ""): Promise<string[]> {
  const repo = new Repo(env.DB);
  const settings = await repo.getSettings();
  const hour = localHour(env, now);
  const date = today(env, now);
  const users = (await repo.listUsers()).filter((u) => u.notify);
  if (!users.length) return [];
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  const appButton = origin ? [{ text: "📱 Открыть приложение", web_app: { url: `${origin}/` } }] : [];
  const sent: string[] = [];

  const broadcast = async (text: string, keyboard: unknown[][]) => {
    for (const u of users) {
      try {
        await tg.send(u.chat_id, text, { reply_markup: { inline_keyboard: keyboard.filter((row) => row.length) } });
      } catch (e) {
        console.error("reminder failed", u.id, e);
      }
    }
  };

  if (settings.notify_morning && hour === settings.morning_hour && (await repo.markSent(`morning:${date}`))) {
    const brief = await dayBrief(env, date);
    if (brief.plan.length) {
      const text = [`☀️ <b>Доброе утро!</b> Вот меню на сегодня:`, "", formatDay({ ...brief, prepTomorrow: [] })];
      if (brief.gaps.length) {
        text.push("", "💡 <b>За неделю ещё не ели:</b>");
        for (const g of brief.gaps.slice(0, 3)) text.push(`${g.emoji} ${h(g.name)} — ${g.everyone ? "никто" : h(g.who.join(", "))}`);
      } else if (brief.missing.length) text.push("", `💡 На этой неделе ещё не было: ${h(brief.missing.slice(0, 3).join(", ").toLowerCase())}.`);
      await broadcast(text.join("\n"), [appButton]);
    } else {
      await broadcast("☀️ <b>Доброе утро!</b>\nМеню на сегодня ещё не составлено. Хотите, я подберу блюда на всю неделю?", [
        [{ text: "🗓 Составить меню на неделю", callback_data: "plan:week" }],
        appButton,
      ]);
    }
    sent.push("morning");
  }

  if (settings.notify_evening && hour === settings.evening_hour && (await repo.markSent(`evening:${date}`))) {
    const [brief, eaten] = await Promise.all([dayBrief(env, date), repo.listMeals(date, date)]);
    const toRate = eaten.filter((m) => m.recipe_id && m.rating == null).slice(-4);
    const text: string[] = ["🌙 <b>Добрый вечер!</b>"];
    if (brief.prepTomorrow.length) {
      text.push("", "⏰ <b>Сделайте с вечера на завтра:</b>");
      for (const p of brief.prepTomorrow) text.push(`• ${h(p.prep)} — для «${h(p.title)}» (${mealName(p.meal_type).toLowerCase()})`);
    }
    if (toRate.length) text.push("", "Как сегодня понравилась еда? Нажмите оценку — буду чаще предлагать любимое:");
    const keyboard = toRate.map((m) => [
      { text: `❤️ ${m.title}`.slice(0, 30), callback_data: `rate:${m.id}:2` },
      { text: "👍", callback_data: `rate:${m.id}:1` },
      { text: "👎", callback_data: `rate:${m.id}:-1` },
    ]);
    if (brief.prepTomorrow.length || toRate.length) {
      await broadcast(text.join("\n"), [...keyboard, appButton]);
      sent.push("evening");
    }
  }
  return sent;
}
