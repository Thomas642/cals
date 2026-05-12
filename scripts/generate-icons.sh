#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker — Regenerate ALL icons from icon.svg
#
#  Source : frontend/icons/icon.svg (master, vector)
#
#  Generates:
#    1. PWA icons     : frontend/icons/icon-72/192/512.png + favicon.ico
#    2. Android icons : android/app/src/main/res/mipmap-*/ic_launcher.png
#                       (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)
#       Both ic_launcher.png (square) and ic_launcher_round.png (round mask)
#
#  Requires either rsvg-convert (preferred) or imagemagick:
#    sudo apt install librsvg2-bin imagemagick
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/frontend/icons/icon.svg"

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

# ── 1. PWA / web icons ──────────────────────────────────────────────────────
ICON_DIR="$REPO_ROOT/frontend/icons"
echo "[1/2] Generating PWA icons in $ICON_DIR..."
for size in 72 192 512; do
    out="$ICON_DIR/icon-${size}.png"
    render "$SRC" "$size" "$out"
    echo "    $(basename "$out") — $(du -h "$out" | cut -f1)"
done

# Favicon (ico format requires imagemagick)
if command -v convert >/dev/null; then
    convert -background none -resize 32x32 "$SRC" "$REPO_ROOT/frontend/favicon.ico"
    echo "    favicon.ico"
fi

# ── 2. Android mipmap icons (if the android project exists) ────────────────
ANDROID_RES="$REPO_ROOT/android/app/src/main/res"
if [ ! -d "$ANDROID_RES" ]; then
    echo "[2/2] Skipping Android icons — $ANDROID_RES not found."
    echo "      Run scripts/build-android.sh first to create the android/ project."
    exit 0
fi

echo "[2/2] Generating Android launcher icons..."
declare -A MIPMAP_SIZES=(
    ["mipmap-mdpi"]=48
    ["mipmap-hdpi"]=72
    ["mipmap-xhdpi"]=96
    ["mipmap-xxhdpi"]=144
    ["mipmap-xxxhdpi"]=192
)
for dir in "${!MIPMAP_SIZES[@]}"; do
    size="${MIPMAP_SIZES[$dir]}"
    target_dir="$ANDROID_RES/$dir"
    mkdir -p "$target_dir"
    render "$SRC" "$size" "$target_dir/ic_launcher.png"
    render "$SRC" "$size" "$target_dir/ic_launcher_round.png"
    # Adaptive icon foreground (108dp at each density = 1.125x of the base size)
    fg_size=$(( size * 108 / 48 ))
    render "$SRC" "$fg_size" "$target_dir/ic_launcher_foreground.png"
    echo "    $dir — $size px (foreground: $fg_size px)"
done

echo
echo "═══════════════════════════════════════════════"
echo "  Done. Next steps:"
echo "    1. bash scripts/build-android.sh  # rebuild APK with new icons"
echo "    2. Distribute the new APK via https://famille.gameone-val.com/download"
echo "═══════════════════════════════════════════════"
