#!/usr/bin/env bash
# Animes — mise a jour : sauvegarde, recuperation du code, reconstruction.
# Usage : bash ~/cals/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

bash deploy/backup.sh
git pull --ff-only origin "$BRANCH"
PROFILE_ARGS=()
if grep -qE '^CLOUDFLARE_TUNNEL_TOKEN=.+' .env; then PROFILE_ARGS=(--profile tunnel); fi
docker compose "${PROFILE_ARGS[@]}" up -d --build
docker image prune -f >/dev/null
# Cache de construction Docker : inutile une fois les images construites, il grossit a chaque mise a jour
# (plusieurs Go). Le vider ne fait que ralentir un peu la prochaine construction (y compris des autres projets).
echo "Nettoyage du cache de construction Docker : $(docker builder prune -f 2>/dev/null | grep -i 'total' || echo 'rien a liberer')"

PORT="$(grep -E '^CALS_HTTP_PORT=' .env | cut -d= -f2)"; PORT="${PORT:-8080}"
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" && { echo; echo "Mise a jour OK ($(git rev-parse --short HEAD))"; exit 0; }
  sleep 2
done
echo "Le site ne repond pas apres la mise a jour : docker compose logs backend" >&2
exit 1
