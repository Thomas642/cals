#!/usr/bin/env bash
# Cals — sauvegarde a chaud de la base SQLite vers ./backups (garde les 30 dernieres).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T backend node src/backup.js /data/backups
LATEST="$(docker compose exec -T backend sh -c 'ls -1t /data/backups/*.db | head -1' | tr -d '\r')"
docker compose cp "backend:$LATEST" "backups/$(basename "$LATEST")"
docker compose exec -T backend sh -c 'ls -1t /data/backups/*.db | tail -n +2 | xargs -r rm -f'
ls -1t backups/*.db | tail -n +31 | xargs -r rm -f
echo "Sauvegarde : backups/$(basename "$LATEST")"
