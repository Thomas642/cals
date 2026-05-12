#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker — Install Brotli compression for the host Nginx
#
#  Brotli typically saves 15-25% bytes over gzip on JS/CSS, which matters on
#  mobile networks. This script:
#    1. Installs the libnginx-mod-http-brotli-* packages (Ubuntu 22.04+)
#    2. Writes /etc/nginx/conf.d/brotli-snippet.conf that the site config
#       includes (see nginx/familytracker.conf)
#    3. Reloads Nginx after verifying the config
#
#  Re-run safe: idempotent.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SNIPPET="/etc/nginx/conf.d/brotli-snippet.conf"

echo "═══════════════════════════════════════════════"
echo "  Brotli installation for Nginx"
echo "═══════════════════════════════════════════════"

# ── Install Ubuntu packages ─────────────────────────────────────────────────
echo "[1/3] Installing libnginx-mod-http-brotli-{filter,static}..."
sudo apt-get update -qq
sudo apt-get install -y libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static

# ── Write the brotli snippet that the site config includes ──────────────────
echo "[2/3] Writing $SNIPPET..."
sudo tee "$SNIPPET" >/dev/null <<'EOF'
# Brotli compression — applied to text-based responses only.
brotli            on;
brotli_comp_level 5;
brotli_static     on;
brotli_min_length 256;
brotli_types
    text/plain
    text/css
    application/json
    application/javascript
    application/xml+rss
    application/atom+xml
    image/svg+xml
    application/manifest+json;
EOF

# ── Validate + reload ───────────────────────────────────────────────────────
echo "[3/3] Validating Nginx config and reloading..."
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo
    echo "═══════════════════════════════════════════════"
    echo "  Brotli enabled. Verify with:"
    echo "    curl -sI -H 'Accept-Encoding: br' https://famille.gameone-val.com/css/app.css | grep -i content-encoding"
    echo "  Expected: content-encoding: br"
    echo "═══════════════════════════════════════════════"
else
    echo
    echo "ERROR: nginx -t failed. Rollback:"
    echo "    sudo rm -f $SNIPPET && sudo systemctl reload nginx"
    exit 1
fi
