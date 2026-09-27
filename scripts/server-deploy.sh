#!/usr/bin/env bash
# Запускается НА СЕРВЕРЕ (GitHub Actions вызывает его по SSH, можно и вручную).
# Ставит Docker, если его нет, собирает и перезапускает приложение.
set -euo pipefail
cd "$(dirname "$0")/.."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

if [ ! -f .env ]; then
  echo "❌ Нет файла .env — скопируйте .env.example в .env и заполните." >&2
  exit 1
fi
set -a; . ./.env; set +a

if ! command -v docker >/dev/null 2>&1; then
  echo "🐳 Docker не найден — устанавливаю…"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! $SUDO docker compose version >/dev/null 2>&1; then
  echo "❌ Нужен плагин docker compose (apt install docker-compose-plugin)" >&2
  exit 1
fi

mkdir -p data
echo "🔨 Собираю и запускаю…"
$SUDO docker compose up -d --build --remove-orphans
$SUDO docker image prune -f >/dev/null || true

echo "⏳ Жду, пока приложение поднимется…"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/health" >/dev/null 2>&1; then
    echo "✅ Приложение работает: ${PUBLIC_URL:-http://127.0.0.1:${APP_PORT:-8080}}"
    $SUDO docker compose ps
    $SUDO docker compose logs --tail=15 app
    exit 0
  fi
  sleep 3
done
echo "❌ Приложение не ответило. Последние логи:" >&2
$SUDO docker compose logs --tail=60 app >&2
exit 1
