#!/usr/bin/env bash
# Бэкап базы с тестового сервера: снимок на сервере + копия на этот компьютер.
# Вызывается из deploy.sh перед каждой выкладкой, можно и вручную: ./scripts/backup-server.sh
# Если бэкап не получился — выходим с ошибкой, и деплой не идёт: базу семьи терять нельзя.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER=deploy@143.198.120.25
KEY="${DEPLOY_KEY:-$HOME/.ssh/exp_server}"
REMOTE=/srv/projects/cooking
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$SERVER")
STAMP=$(date +%Y-%m-%d_%H-%M-%S)
NAME="before-deploy-$STAMP.db"

if ! "${SSH[@]}" "test -f $REMOTE/data/cooking.db"; then
  echo "ℹ️  На сервере ещё нет базы — бэкапить нечего"
  exit 0
fi

# Снимок делаем через SQLite внутри контейнера (VACUUM INTO) — он целостный, даже если в базу
# в этот момент пишут. Если контейнер не запущен, в базу никто не пишет — хватит простой копии.
"${SSH[@]}" "cd $REMOTE && mkdir -p data/backups && \
  if docker compose exec -T app true 2>/dev/null; then \
    docker compose exec -T app node --disable-warning=ExperimentalWarning -e \"new (require('node:sqlite').DatabaseSync)('/data/cooking.db').exec(\\\"VACUUM INTO '/data/backups/$NAME'\\\")\"; \
  else \
    cp data/cooking.db data/backups/$NAME; \
  fi && \
  ls -1t data/backups/before-deploy-*.db | tail -n +31 | xargs -r rm -f"

mkdir -p backups
scp -q -i "$KEY" "$SERVER:$REMOTE/data/backups/$NAME" "backups/$NAME"
SIZE=$(wc -c <"backups/$NAME" | tr -d ' ')
if [ "$SIZE" -lt 4096 ]; then
  echo "❌ Бэкап подозрительно маленький ($SIZE байт) — деплой остановлен" >&2
  exit 1
fi
echo "💾 Бэкап базы: сервер $REMOTE/data/backups/$NAME и локально backups/$NAME ($SIZE байт)"
