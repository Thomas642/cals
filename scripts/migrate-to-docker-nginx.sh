#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker — Migrate from host Nginx to Docker Nginx
#
#  What this script does:
#    1. Backs up the current host Nginx config
#    2. Stops & disables the system Nginx service
#    3. Starts the Docker Nginx container
#    4. Configures Certbot to reload the container after renewals
#    5. Verifies the migration
#
#  Downtime: ~10 seconds.
#
#  ROLLBACK (if anything fails):
#    sudo systemctl enable --now nginx
#    docker compose stop nginx
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DOMAIN="${DOMAIN:-famille.gameone-val.com}"
BACKUP_DIR="$HOME/familytracker-nginx-backup-$(date +%Y%m%d-%H%M%S)"

echo "═══════════════════════════════════════════════"
echo "  FamilyTracker — Nginx migration to Docker"
echo "═══════════════════════════════════════════════"
echo "  Domain : $DOMAIN"
echo "  Backup : $BACKUP_DIR"
echo

# ── Pre-flight checks ───────────────────────────────────────────────────────
command -v docker >/dev/null || { echo "ERROR: docker not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin missing."; exit 1; }

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "ERROR: SSL cert not found at /etc/letsencrypt/live/$DOMAIN/"
  echo "Run scripts/ssl-setup.sh first."
  exit 1
fi

# ── 1. Backup ────────────────────────────────────────────────────────────────
echo "[1/5] Backing up host Nginx config..."
mkdir -p "$BACKUP_DIR"
sudo cp -a /etc/nginx "$BACKUP_DIR/etc-nginx" 2>/dev/null || true
sudo systemctl status nginx --no-pager > "$BACKUP_DIR/nginx-status.txt" 2>&1 || true
echo "    Backup: $BACKUP_DIR"

# ── 2. Stop host Nginx ───────────────────────────────────────────────────────
echo "[2/5] Stopping host Nginx..."
if systemctl is-active --quiet nginx; then
  sudo systemctl stop nginx
fi
if systemctl is-enabled --quiet nginx 2>/dev/null; then
  sudo systemctl disable nginx
fi
echo "    Host Nginx stopped & disabled."

# ── 3. Start Docker Nginx ────────────────────────────────────────────────────
echo "[3/5] Starting Docker stack (api + db + nginx)..."
docker compose up -d --build

echo -n "    Waiting for Nginx container to be healthy"
for i in {1..30}; do
  if docker compose ps nginx --format json 2>/dev/null | grep -q '"State":"running"'; then
    echo " — OK"
    break
  fi
  echo -n "."
  sleep 1
done

# ── 4. Configure Certbot deploy hook ─────────────────────────────────────────
echo "[4/5] Configuring Certbot to reload Docker Nginx after renewals..."
HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
HOOK_FILE="$HOOK_DIR/familytracker-reload.sh"
sudo mkdir -p "$HOOK_DIR"
sudo tee "$HOOK_FILE" >/dev/null <<EOF
#!/usr/bin/env bash
# Reload the Dockerized Nginx after a successful Certbot renewal
cd "$REPO_ROOT" && docker compose exec -T nginx nginx -s reload
EOF
sudo chmod +x "$HOOK_FILE"
echo "    Deploy hook: $HOOK_FILE"

# ── 5. Verify ────────────────────────────────────────────────────────────────
echo "[5/5] Verifying..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/health" || echo "000")
echo "    GET https://$DOMAIN/api/health → HTTP $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo
  echo "═══════════════════════════════════════════════"
  echo "  MIGRATION SUCCESSFUL"
  echo "═══════════════════════════════════════════════"
  echo "  Nginx is now running in Docker."
  echo "  Backup of old config: $BACKUP_DIR"
  echo
  echo "  Useful commands:"
  echo "    docker compose logs -f nginx"
  echo "    docker compose exec nginx nginx -s reload"
  echo "    docker compose ps"
  echo "═══════════════════════════════════════════════"
else
  echo
  echo "⚠ WARNING: site returned HTTP $HTTP_CODE — check logs:"
  echo "    docker compose logs nginx"
  echo
  echo "  To rollback:"
  echo "    docker compose stop nginx"
  echo "    sudo systemctl enable --now nginx"
  exit 1
fi
