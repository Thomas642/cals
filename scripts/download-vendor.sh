#!/usr/bin/env bash
# Download vendor JS/CSS libraries to serve them locally (no CDN dependency)
# Run from the repo root: bash scripts/download-vendor.sh

set -euo pipefail

VENDOR_DIR="frontend/vendor"
LEAFLET_VERSION="1.9.4"
LEAFLET_BASE="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist"
LEAFLET_HEAT_VERSION="0.2.0"
LEAFLET_ROTATE_VERSION="0.2.8"
SOCKETIO_VERSION="4.7.5"

echo "=== Downloading vendor assets ==="
mkdir -p "$VENDOR_DIR"

curl -fsSL "${LEAFLET_BASE}/leaflet.css" -o "${VENDOR_DIR}/leaflet.css"
curl -fsSL "${LEAFLET_BASE}/leaflet.js"  -o "${VENDOR_DIR}/leaflet.js"
curl -fsSL "https://unpkg.com/leaflet.heat@${LEAFLET_HEAT_VERSION}/dist/leaflet-heat.js" -o "${VENDOR_DIR}/leaflet-heat.js"
curl -fsSL "https://unpkg.com/leaflet-rotate@${LEAFLET_ROTATE_VERSION}/dist/leaflet-rotate-src.js" -o "${VENDOR_DIR}/leaflet-rotate.js"
curl -fsSL "https://cdn.socket.io/${SOCKETIO_VERSION}/socket.io.min.js" -o "${VENDOR_DIR}/socket.io.js"

echo "Vendor assets downloaded to ${VENDOR_DIR}/"
echo "=== Done ==="
