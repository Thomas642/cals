#!/usr/bin/env bash
# Download vendor JS/CSS libraries to serve them locally (no CDN dependency)
# Run from the repo root: bash scripts/download-vendor.sh

set -euo pipefail

VENDOR_DIR="frontend/vendor"
LEAFLET_VERSION="1.9.4"
LEAFLET_BASE="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist"

echo "=== Downloading vendor assets ==="
mkdir -p "$VENDOR_DIR"

curl -fsSL "${LEAFLET_BASE}/leaflet.css" -o "${VENDOR_DIR}/leaflet.css"
curl -fsSL "${LEAFLET_BASE}/leaflet.js"  -o "${VENDOR_DIR}/leaflet.js"

echo "Leaflet ${LEAFLET_VERSION} downloaded to ${VENDOR_DIR}/"
echo "=== Done ==="
