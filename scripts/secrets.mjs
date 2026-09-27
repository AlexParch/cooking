// Собирает непустые секреты из переменных окружения в JSON для `wrangler secret bulk`.
const names = ["TELEGRAM_BOT_TOKEN", "WEBHOOK_SECRET", "ALLOWED_USER_IDS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const out = Object.fromEntries(names.filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
for (const required of names.slice(0, 3)) {
  if (!out[required]) {
    console.error(`Не задан секрет ${required} в Settings → Secrets and variables → Actions`);
    process.exit(1);
  }
}
process.stdout.write(JSON.stringify(out));
