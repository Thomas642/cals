#!/usr/bin/env bash
# Family Tracker — Initial server setup script
# Run once on a fresh Ubuntu 22.04 VPS as root or sudo
# Usage: DOMAIN=famille.gameone-val.com EMAIL=admin@example.com bash setup.sh

set -euo pipefail

DOMAIN="${DOMAIN:-famille.gameone-val.com}"
CERTBOT_EMAIL="${EMAIL:-}"

echo "=== Family Tracker Setup ==="
echo "Domain: $DOMAIN"

# ── 1. Dependencies ──────────────────────────────────────────────────────────
apt-get update && apt-get install -y \
  curl git nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib postgis \
  nodejs npm

# Install Node.js 20 via NodeSource if needed
if ! node --version | grep -q "v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node: $(node --version), npm: $(npm --version)"

# ── 2. PostgreSQL ────────────────────────────────────────────────────────────
DB_USER="familytracker"
DB_NAME="familytracker"
DB_PASS="${DB_PASSWORD:-$(openssl rand -hex 20)}"

sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true

echo "DB_PASSWORD=$DB_PASS" >> /root/.ft_secrets

# ── 3. App deployment ────────────────────────────────────────────────────────
APP_DIR="/var/www/familytracker"
mkdir -p "$APP_DIR"

# Download vendor assets (Leaflet) before copying frontend
bash scripts/download-vendor.sh

# Copy files (assumes script is run from repo root)
cp -r ./frontend "$APP_DIR/"
cp -r ./backend  "$APP_DIR/"
cp -r ./database "$APP_DIR/"
mkdir -p "$APP_DIR/uploads"
chown -R www-data:www-data "$APP_DIR/uploads"

# Backend setup
cd "$APP_DIR/backend"
npm ci --omit=dev

# Apply database schema
PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -d "$DB_NAME" -f ../database/schema.sql

# ── 4. Environment file ──────────────────────────────────────────────────────
JWT_SECRET=$(openssl rand -hex 32)
VAPID=$(npx web-push generate-vapid-keys --json)
VAPID_PUBLIC=$(echo "$VAPID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).publicKey))")
VAPID_PRIVATE=$(echo "$VAPID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).privateKey))")

cat > "$APP_DIR/backend/.env" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=30d
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
VAPID_EMAIL=mailto:${CERTBOT_EMAIL:-admin@example.com}
FRONTEND_URL=https://${DOMAIN}
UPLOAD_DIR=$APP_DIR/uploads
EOF

echo "JWT_SECRET=$JWT_SECRET" >> /root/.ft_secrets
echo "VAPID_PUBLIC=$VAPID_PUBLIC" >> /root/.ft_secrets

# ── 5. Systemd service ───────────────────────────────────────────────────────
cat > /etc/systemd/system/familytracker.service <<EOF
[Unit]
Description=Family Tracker API
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=$APP_DIR/backend
ExecStart=/usr/bin/node src/app.js
Restart=on-failure
RestartSec=5
EnvironmentFile=$APP_DIR/backend/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable familytracker
systemctl start familytracker

# ── 6. Nginx ─────────────────────────────────────────────────────────────────
# Replace placeholder domain in nginx config if needed
sed "s/famille\.gameone-val\.com/$DOMAIN/g" ./nginx/familytracker.conf \
  > /etc/nginx/sites-available/familytracker
ln -sf /etc/nginx/sites-available/familytracker /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# ── 7. SSL (Let's Encrypt via Certbot) ───────────────────────────────────────
if [[ -n "$CERTBOT_EMAIL" ]]; then
  echo "=== Installing SSL certificate via Certbot ==="
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL"
  echo "=== SSL installed! Auto-renewal is active via certbot systemd timer ==="
else
  echo ""
  echo "=== IMPORTANT: SSL not configured (no EMAIL provided) ==="
  echo "Run this command manually on the server to enable HTTPS:"
  echo "  certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m you@example.com"
  echo ""
fi

echo "=== Setup complete! ==="
echo "Secrets saved to /root/.ft_secrets"
echo "Next: create the first admin account manually:"
echo "  cd $APP_DIR/backend && node scripts/create-admin.js"
