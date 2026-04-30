#!/usr/bin/env bash
# Family Tracker — SSL certificate setup (run on an already-deployed server)
# Usage: DOMAIN=famille.gameone-val.com EMAIL=you@example.com bash ssl-setup.sh

set -euo pipefail

DOMAIN="${DOMAIN:-famille.gameone-val.com}"
EMAIL="${EMAIL:-}"

if [[ -z "$EMAIL" ]]; then
  echo "ERROR: EMAIL is required."
  echo "Usage: DOMAIN=famille.gameone-val.com EMAIL=you@example.com bash ssl-setup.sh"
  exit 1
fi

echo "=== SSL Setup for $DOMAIN ==="

# Install certbot if missing
if ! command -v certbot &>/dev/null; then
  apt-get update && apt-get install -y certbot python3-certbot-nginx
fi

# Ensure nginx is serving HTTP on port 80 first (Cloudflare must be in Flexible or DNS-only)
echo "Testing nginx config..."
nginx -t

# Obtain/renew certificate
certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  -m "$EMAIL" \
  --redirect

echo ""
echo "=== SSL certificate installed! ==="
echo "Cloudflare SSL/TLS mode should be set to 'Full (strict)' now."
echo "Certificate auto-renewal is handled by: systemctl status certbot.timer"
echo ""

# Verify renewal timer
systemctl is-active certbot.timer && echo "Auto-renewal timer: ACTIVE" || \
  echo "WARNING: certbot.timer not active — run: systemctl enable --now certbot.timer"
