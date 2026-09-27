// Находит (или создаёт) базу D1 «cooking» в Cloudflare и прописывает её id в wrangler.toml.
// Запускается в GitHub Actions перед деплоем, чтобы не нужно было ничего делать руками.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "cooking";
const run = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

let db = JSON.parse(run("npx wrangler d1 list --json")).find((d) => d.name === NAME);
if (!db) {
  console.log(`Создаю базу D1 «${NAME}»…`);
  run(`npx wrangler d1 create ${NAME}`);
  db = JSON.parse(run("npx wrangler d1 list --json")).find((d) => d.name === NAME);
}
if (!db?.uuid) throw new Error("Не удалось получить id базы D1");

const toml = readFileSync("wrangler.toml", "utf8").replace(/database_id = "[^"]*"/, `database_id = "${db.uuid}"`);
writeFileSync("wrangler.toml", toml);
console.log(`D1 «${NAME}»: ${db.uuid}`);
