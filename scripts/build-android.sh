#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker – Build Android APK on Linux (VPS)
#
#  Prerequisites: run scripts/setup-android-build.sh once.
#  Run this script from the repo root:
#      bash scripts/build-android.sh
#
#  Output: FamilyTracker.apk at the repo root, also copied to frontend/download/
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Sanity checks ────────────────────────────────────────────────────────────
: "${ANDROID_SDK_ROOT:?ANDROID_SDK_ROOT is not set. Run scripts/setup-android-build.sh first or 'source ~/.bashrc'.}"
: "${JAVA_HOME:?JAVA_HOME is not set. Run scripts/setup-android-build.sh first or 'source ~/.bashrc'.}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"

echo "═══════════════════════════════════════════════"
echo "  FamilyTracker – Android APK Builder (Linux)"
echo "═══════════════════════════════════════════════"
echo "  JAVA_HOME        : $JAVA_HOME"
echo "  ANDROID_SDK_ROOT : $ANDROID_SDK_ROOT"
echo

# ── 1. JS dependencies ──────────────────────────────────────────────────────
echo "[1/6] Installing Node dependencies..."
npm install --no-audit --no-fund

# ── 2. Vendor JS/CSS ────────────────────────────────────────────────────────
echo "[2/6] Downloading vendor assets..."
mkdir -p frontend/vendor

download_if_missing() {
  local url="$1" dest="$2"
  [ -f "$dest" ] || curl -fsSL "$url" -o "$dest"
}

download_if_missing "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"        "frontend/vendor/leaflet.js"
download_if_missing "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"       "frontend/vendor/leaflet.css"
download_if_missing "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js" "frontend/vendor/leaflet-heat.js"
download_if_missing "https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js" "frontend/vendor/leaflet-rotate.js"
download_if_missing "https://cdn.socket.io/4.7.5/socket.io.min.js"           "frontend/vendor/socket.io.js"

# ── 3. Capacitor: add Android platform if missing ───────────────────────────
if [ ! -d android ]; then
  echo "[3/6] Adding Android platform..."
  npx cap add android
else
  echo "[3/6] Android platform already present."
fi

# ── 4. Sync web assets ──────────────────────────────────────────────────────
echo "[4/6] Syncing web assets to Android project..."
npx cap sync android

# ── 5. Patch AndroidManifest.xml with required permissions ──────────────────
echo "[5/6] Patching AndroidManifest.xml..."
MANIFEST="android/app/src/main/AndroidManifest.xml"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found." >&2
  exit 1
fi

if ! grep -q "ACCESS_BACKGROUND_LOCATION" "$MANIFEST"; then
  python3 - "$MANIFEST" <<'PY'
import sys, re
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    content = f.read()

perms = '''
    <!-- Background GPS - added by build-android.sh -->
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
'''

# Insert permissions before </manifest>
content = re.sub(r'(</manifest>)', perms + r'\1', content, count=1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Manifest patched.")
PY
else
  echo "    Permissions already present."
fi

# ── 5.5. Bump versionCode / versionName so in-app update check fires ───────
#   versionCode = monotonically increasing integer (epoch minutes since 1970)
#   versionName = human-readable date-based version
VERSION="${VERSION:-$(date +%Y.%m.%d-%H%M)}"
VERSION_CODE=$(( $(date +%s) / 60 ))
GRADLE_FILE="android/app/build.gradle"
if [ -f "$GRADLE_FILE" ]; then
    sed -i.bak -E "s/versionCode [0-9]+/versionCode $VERSION_CODE/" "$GRADLE_FILE"
    sed -i.bak -E "s/versionName \"[^\"]*\"/versionName \"$VERSION\"/" "$GRADLE_FILE"
    rm -f "$GRADLE_FILE.bak"
    echo "    Set versionName=$VERSION  versionCode=$VERSION_CODE"
fi

# ── 6. Gradle build ─────────────────────────────────────────────────────────
echo "[6/6] Building debug APK with Gradle (this may take a few minutes)..."
cd android
chmod +x gradlew
./gradlew assembleDebug
cd ..

APK_SRC="android/app/build/outputs/apk/debug/app-debug.apk"
APK_DEST="$REPO_ROOT/FamilyTracker.apk"
cp "$APK_SRC" "$APK_DEST"

# Also publish to the download folder served by Nginx
DOWNLOAD_DIR="$REPO_ROOT/frontend/download"
mkdir -p "$DOWNLOAD_DIR"
cp "$APK_SRC" "$DOWNLOAD_DIR/FamilyTracker.apk"
cat > "$DOWNLOAD_DIR/version.json" <<EOF
{
  "version": "$VERSION",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "notes": "Build $VERSION"
}
EOF

echo
echo "═══════════════════════════════════════════════"
echo "  BUILD SUCCESSFUL"
echo "═══════════════════════════════════════════════"
echo "  APK      : $APK_DEST"
echo "  Published: $DOWNLOAD_DIR/FamilyTracker.apk"
echo "  Version  : $VERSION"
echo "  URL      : https://famille.gameone-val.com/download"
echo "═══════════════════════════════════════════════"
