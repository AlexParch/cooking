#!/usr/bin/env bash
# Бэкап баз с тестового сервера: снимок на сервере + копия на этот компьютер.
# Вызывается из deploy.sh перед каждой выкладкой, можно и вручную: ./scripts/backup-server.sh
# Если бэкап не получился — выходим с ошибкой, и деплой не идёт: базу семьи терять нельзя.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER=deploy@143.198.120.25
KEY="${DEPLOY_KEY:-$HOME/.ssh/exp_server}"
REMOTE=/srv/projects/cooking
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$SERVER")
STAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Все базы: cooking.db — Катина (основная), остальные — отдельные (например, тестовая test.db).
DBS=$("${SSH[@]}" "cd $REMOTE/data 2>/dev/null && ls -1 *.db 2>/dev/null" || true)
if [ -z "$DBS" ]; then
  echo "ℹ️  На сервере ещё нет базы — бэкапить нечего"
  exit 0
fi

mkdir -p backups
for DB in $DBS; do
  BASE=${DB%.db}
  NAME="before-deploy-$STAMP-$BASE.db"
  # Снимок делаем через SQLite внутри контейнера (VACUUM INTO) — он целостный, даже если в базу
  # в этот момент пишут. Если контейнер не запущен, в базу никто не пишет — хватит простой копии.
  "${SSH[@]}" "cd $REMOTE && mkdir -p data/backups && \
    if docker compose exec -T app true 2>/dev/null; then \
      docker compose exec -T app node --disable-warning=ExperimentalWarning -e \"new (require('node:sqlite').DatabaseSync)('/data/$DB').exec(\\\"VACUUM INTO '/data/backups/$NAME'\\\")\"; \
    else \
      cp data/$DB data/backups/$NAME; \
    fi"
  scp -q -i "$KEY" "$SERVER:$REMOTE/data/backups/$NAME" "backups/$NAME"
  SIZE=$(wc -c <"backups/$NAME" | tr -d ' ')
  if [ "$SIZE" -lt 4096 ]; then
    echo "❌ Бэкап $DB подозрительно маленький ($SIZE байт) — деплой остановлен" >&2
    exit 1
  fi
  echo "💾 Бэкап $DB: сервер data/backups/$NAME и локально backups/$NAME ($SIZE байт)"
done

# На сервере храним 60 последних снимков перед деплоем (локальные копии не трогаем).
"${SSH[@]}" "cd $REMOTE && ls -1t data/backups/before-deploy-*.db | tail -n +61 | xargs -r rm -f"
