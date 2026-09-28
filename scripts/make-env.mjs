// Собирает .env для сервера из секретов GitHub (вызывается в GitHub Actions).
const e = process.env;
const required = ["TELEGRAM_BOT_TOKEN", "WEBHOOK_SECRET", "ALLOWED_USER_IDS"];
const missing = required.filter((k) => !e[k]);
if (missing.length) {
  console.error(`Не заданы секреты: ${missing.join(", ")} (Settings → Secrets and variables → Actions)`);
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(e.WEBHOOK_SECRET)) {
  console.error("WEBHOOK_SECRET может содержать только латинские буквы, цифры, _ и -");
  process.exit(1);
}
// Нет своего домена — используем бесплатный вида 1.2.3.4.sslip.io (он указывает на IP сервера).
const host = e.SSH_HOST || "";
const domain = e.DOMAIN || (/^\d+\.\d+\.\d+\.\d+$/.test(host) ? `${host}.sslip.io` : host);
if (!domain) {
  console.error("Не задан DOMAIN");
  process.exit(1);
}
const useCaddy = (e.USE_CADDY || "true").toLowerCase() !== "false";
const lines = {
  DOMAIN: domain,
  PUBLIC_URL: e.PUBLIC_URL || `https://${domain}`,
  COMPOSE_PROFILES: useCaddy ? "caddy" : "",
  APP_PORT: e.APP_PORT || "8080",
  TELEGRAM_BOT_TOKEN: e.TELEGRAM_BOT_TOKEN,
  WEBHOOK_SECRET: e.WEBHOOK_SECRET,
  ALLOWED_USER_IDS: e.ALLOWED_USER_IDS,
  FAMILY_DBS: e.FAMILY_DBS || "",
  ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY || "",
  OPENAI_API_KEY: e.OPENAI_API_KEY || "",
  TZ: e.TZ || "Europe/Moscow",
  ANTHROPIC_MODEL: e.ANTHROPIC_MODEL || "claude-opus-5",
  OPENAI_MODEL: e.OPENAI_MODEL || "",
  // Прокси для запросов к OpenAI/Anthropic/Telegram (нужен, если сервер в России).
  HTTPS_PROXY: e.HTTPS_PROXY || "",
  NODE_USE_ENV_PROXY: e.HTTPS_PROXY ? "1" : "",
  NO_PROXY: "localhost,127.0.0.1",
};
process.stdout.write(Object.entries(lines).map(([k, v]) => `${k}=${String(v).replace(/\n/g, "")}`).join("\n") + "\n");
console.error(`Адрес приложения: ${lines.PUBLIC_URL}`);
