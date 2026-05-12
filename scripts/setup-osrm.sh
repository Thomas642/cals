#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker — Bootstrap OSRM (routing engine) with OSM data
#
#  Downloads the OpenStreetMap extract for the chosen region from Geofabrik,
#  pre-processes it (extract → partition → customize) and prepares the
#  ./osrm-data/region.osrm files used by the osrm-routed container.
#
#  Usage:
#    REGION=aquitaine bash scripts/setup-osrm.sh
#
#  Common French regions (≈ download / processed size):
#    - aquitaine       (~ 180 MB / 1.5 GB)        ← default, suits Dax
#    - nouvelle-aquitaine (~ 400 MB / 4 GB)
#    - midi-pyrenees   (~ 200 MB / 1.5 GB)
#    - france          (~ 4.5 GB / 30 GB, needs 8+ GB RAM)
#
#  Re-run any time to refresh data with a newer OSM snapshot.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

REGION="${REGION:-aquitaine}"
DATA_DIR="$REPO_ROOT/osrm-data"
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"

# Geofabrik URL: regions under /europe/france/ ; full country under /europe/
if [ "$REGION" = "france" ]; then
    URL="https://download.geofabrik.de/europe/france-latest.osm.pbf"
else
    URL="https://download.geofabrik.de/europe/france/${REGION}-latest.osm.pbf"
fi

echo "═══════════════════════════════════════════════"
echo "  OSRM bootstrap"
echo "  Region : $REGION"
echo "  Data   : $DATA_DIR"
echo "  Source : $URL"
echo "═══════════════════════════════════════════════"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

# ── 1. Download OSM extract ─────────────────────────────────────────────────
echo "[1/4] Downloading OSM extract..."
curl -fL --progress-bar "$URL" -o region.osm.pbf
echo "      $(du -h region.osm.pbf | cut -f1) downloaded."

# ── 2. Extract (car profile) ────────────────────────────────────────────────
echo "[2/4] osrm-extract (car profile)..."
docker run --rm -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
    osrm-extract -p /opt/car.lua /data/region.osm.pbf

# ── 3. Partition (MLD) ──────────────────────────────────────────────────────
echo "[3/4] osrm-partition (MLD algorithm)..."
docker run --rm -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
    osrm-partition /data/region.osrm

# ── 4. Customize ────────────────────────────────────────────────────────────
echo "[4/4] osrm-customize..."
docker run --rm -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
    osrm-customize /data/region.osrm

# Cleanup the raw .osm.pbf (we only need the processed .osrm files)
rm -f region.osm.pbf

echo
echo "═══════════════════════════════════════════════"
echo "  OSRM data ready"
echo "  Final size : $(du -sh "$DATA_DIR" | cut -f1)"
echo
echo "  Start the routing service:"
echo "    docker compose --profile routing up -d osrm"
echo
echo "  Test it:"
echo "    curl 'http://localhost:5000/route/v1/driving/-0.624,43.700;-0.611,43.704'"
echo "═══════════════════════════════════════════════"
