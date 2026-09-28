#!/usr/bin/env bash
# Кладётся в корень проекта. Раскатывает проект на тестовый сервер.
# Использование:
#   ./deploy.sh web  <name> <internal_port>   # сайт/API/бот-на-вебхуке -> https://<name>.more-momentov.ru
#   ./deploy.sh worker <name>                 # бот long-polling / фоновый воркер (без входящего HTTP)
set -e
SERVER=deploy@143.198.120.25
KEY="${DEPLOY_KEY:-$HOME/.ssh/exp_server}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
RSYNC_RSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
KIND="$1"; NAME="$2"; PORT="${3:-8080}"
[ -z "$KIND" ] || [ -z "$NAME" ] && { echo "usage: ./deploy.sh web|worker <name> [port]"; exit 1; }
IP=143.198.120.25
DOMAIN=more-momentov.ru

# Сначала бэкап базы (на сервере и сюда). Не получился — не выкладываем.
if [ -x ./scripts/backup-server.sh ]; then
  ./scripts/backup-server.sh || { echo "❌ Бэкап базы не удался — деплой остановлен"; exit 1; }
fi

if [ "$KIND" = "web" ]; then
  $SSH "$SERVER" "newproject $NAME $PORT >/dev/null 2>&1 || true"
  rsync -az --delete -e "$RSYNC_RSH" --exclude '.git' --exclude 'deploy.sh' --exclude 'backups' --exclude 'data' ./ "$SERVER:/srv/projects/$NAME/app/"
  $SSH "$SERVER" "cd /srv/projects/$NAME && docker compose up -d --build"
  echo "OK -> https://$NAME.$DOMAIN"
elif [ "$KIND" = "worker" ]; then
  $SSH "$SERVER" "mkdir -p /srv/projects/$NAME && cp -n /srv/templates/worker-compose.yml /srv/projects/$NAME/docker-compose.yml"
  rsync -az --delete -e "$RSYNC_RSH" --exclude '.git' --exclude 'deploy.sh' ./ "$SERVER:/srv/projects/$NAME/"
  $SSH "$SERVER" "cd /srv/projects/$NAME && docker compose up -d --build"
  echo "OK -> воркер $NAME запущен (логи: ssh $SERVER 'cd /srv/projects/$NAME && docker compose logs -f')"
else
  echo "неизвестный тип: $KIND (web|worker)"; exit 1
fi
