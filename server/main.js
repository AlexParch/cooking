// Запуск на своём сервере (Node.js + SQLite) вместо Cloudflare Workers.
// Тот же код приложения (src/index.ts), но база — файл SQLite, статика — из public/,
// напоминания — таймер раз в минуту, плюс ночной бэкап базы.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.ts";
import { createD1 } from "./d1.js";

const ROOT = resolve(process.env.APP_ROOT || process.cwd());
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, "data"));
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- база: SQLite с интерфейсом как у Cloudflare D1 ----------
mkdirSync(DATA_DIR, { recursive: true });
const sqlite = new DatabaseSync(join(DATA_DIR, "cooking.db"));
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const DB = createD1(sqlite);

function migrate() {
  sqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const done = new Set(sqlite.prepare("SELECT name FROM _migrations").all().map((r) => r.name));
  const dir = join(ROOT, "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    log("миграция", file);
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(readFileSync(join(dir, file), "utf8"));
      sqlite.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  }
}

// ---------- статика ----------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const PUBLIC = join(ROOT, "public");
const ASSETS = {
  async fetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(PUBLIC, path);
    if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) file = join(PUBLIC, "index.html");
    const type = TYPES[extname(file)] || "application/octet-stream";
    // HTML не кэшируем, чтобы обновления приходили сразу.
    const cache = type.startsWith("text/html") ? "no-cache" : "public, max-age=300";
    return new Response(readFileSync(file), { headers: { "content-type": type, "cache-control": cache } });
  },
};

// ---------- окружение как у Worker ----------
const env = {
  DB,
  ASSETS,
  TZ: process.env.TZ || "Europe/Moscow",
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "",
  ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS || "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
  OPENAI_TRANSCRIBE_MODEL: process.env.OPENAI_TRANSCRIBE_MODEL || undefined,
  TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE || undefined,
  DEV_AUTH: process.env.DEV_AUTH || undefined,
};

const ctx = () => ({ waitUntil: (p) => Promise.resolve(p).catch((e) => log("фоновая задача упала", e)), passThroughOnException() {} });

// ---------- HTTP ----------
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
    const base = PUBLIC_URL || `${proto}://${host}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const request = new Request(new URL(req.url, base), { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
    const response = await worker.fetch(request, env, ctx());
    const out = {};
    response.headers.forEach((v, k) => (out[k] = v));
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    log("ошибка запроса", req.method, req.url, e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Ошибка сервера");
  }
});

// ---------- напоминания и бэкапы ----------
let lastHour = "";
let lastBackup = "";
function localParts(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: env.TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

function backup() {
  const { date } = localParts();
  if (lastBackup === date) return;
  lastBackup = date;
  const dir = join(DATA_DIR, "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `cooking-${date}.db`);
  if (!existsSync(file)) {
    sqlite.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    log("бэкап базы", file);
  }
  // Храним две недели.
  const files = readdirSync(dir).filter((f) => f.startsWith("cooking-")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 14))) rmSync(join(dir, old));
}

function tick() {
  const now = new Date();
  const key = now.toISOString().slice(0, 13);
  if (key !== lastHour) {
    lastHour = key;
    worker.scheduled({ scheduledTime: now.getTime(), cron: "hourly", noRetry() {} }, env, ctx()).catch((e) => log("напоминания упали", e));
  }
  if (localParts(now).hour === 3) {
    try {
      backup();
    } catch (e) {
      log("бэкап не удался", e);
    }
  }
}

// ---------- подключение бота к Telegram ----------
async function connectTelegram(attempt = 1) {
  if (!PUBLIC_URL || !env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET) {
    log("PUBLIC_URL / TELEGRAM_BOT_TOKEN / WEBHOOK_SECRET не заданы — бот не подключён к Telegram");
    return;
  }
  try {
    const res = await worker.fetch(new Request(`${PUBLIC_URL}/setup?key=${encodeURIComponent(env.WEBHOOK_SECRET)}`), env, ctx());
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    log("бот подключён:", text);
  } catch (e) {
    log(`не удалось подключить бота (попытка ${attempt}):`, e.message || e);
    if (attempt < 10) setTimeout(() => connectTelegram(attempt + 1), attempt * 15_000);
  }
}

migrate();
server.listen(PORT, () => {
  log(`Наша кухня запущена на порту ${PORT}. База: ${join(DATA_DIR, "cooking.db")}. Адрес: ${PUBLIC_URL || "(PUBLIC_URL не задан)"}`);
  setTimeout(connectTelegram, 3000);
  setInterval(tick, 60_000);
  setTimeout(tick, 10_000);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log("остановка…");
    server.close(() => {
      sqlite.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
