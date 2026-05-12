#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker — Regenerate PNG icons from icon.svg
#
#  Source : frontend/icons/icon.svg (master, vector)
#  Output : icon-72.png, icon-192.png, icon-512.png, favicon.ico
#
#  Requires either rsvg-convert (preferred) or imagemagick:
#    sudo apt install librsvg2-bin imagemagick
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICON_DIR="$REPO_ROOT/frontend/icons"
SRC="$ICON_DIR/icon.svg"

[ -f "$SRC" ] || { echo "ERROR: $SRC not found"; exit 1; }

# Pick the renderer
if command -v rsvg-convert >/dev/null; then
    render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }
elif command -v convert >/dev/null; then
    render() { convert -background none -resize "${2}x${2}" "$1" "$3"; }
else
    echo "ERROR: install librsvg2-bin (preferred) or imagemagick:"
    echo "  sudo apt install librsvg2-bin"
    exit 1
fi

echo "Generating PNG icons from $SRC..."
for size in 72 192 512; do
    out="$ICON_DIR/icon-${size}.png"
    render "$SRC" "$size" "$out"
    echo "  $(basename "$out") — $(du -h "$out" | cut -f1)"
done

# favicon (32px ico)
if command -v convert >/dev/null; then
    convert -background none -resize 32x32 "$SRC" "$REPO_ROOT/frontend/favicon.ico"
    echo "  favicon.ico — $(du -h "$REPO_ROOT/frontend/favicon.ico" | cut -f1)"
fi

echo "Done."
