#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  FamilyTracker – Setup Android build toolchain on Ubuntu VPS
#
#  Run ONCE as a user that has sudo. Installs:
#    - OpenJDK 17
#    - Node.js 20 (if missing)
#    - Android command-line tools
#    - SDK Platform 34 + Build-Tools 34
#
#  After this, use scripts/build-android.sh to (re)build the APK.
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
CMDLINE_TOOLS_VERSION="11076708"  # Latest stable as of writing

echo "═══════════════════════════════════════════════"
echo "  FamilyTracker – Android toolchain setup"
echo "  SDK location: $ANDROID_SDK_ROOT"
echo "═══════════════════════════════════════════════"

# ── 1. JDK 17 ───────────────────────────────────────────────────────────────
echo "[1/5] Installing JDK 17..."
if ! java -version 2>&1 | grep -q "17\."; then
  sudo apt-get update
  sudo apt-get install -y openjdk-17-jdk-headless unzip wget
fi
JAVA_HOME_PATH=$(dirname "$(dirname "$(readlink -f "$(which java)")")")
echo "    JAVA_HOME=$JAVA_HOME_PATH"

# ── 2. Node.js 20 ───────────────────────────────────────────────────────────
echo "[2/5] Checking Node.js..."
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE "v(18|20|22|24)\."; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    Node: $(node --version), npm: $(npm --version)"

# ── 3. Android command-line tools ───────────────────────────────────────────
echo "[3/5] Installing Android command-line tools..."
mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"

if [ ! -d "$ANDROID_SDK_ROOT/cmdline-tools/latest" ]; then
  TMP_ZIP="/tmp/cmdline-tools.zip"
  wget -q "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" -O "$TMP_ZIP"
  unzip -q "$TMP_ZIP" -d "$ANDROID_SDK_ROOT/cmdline-tools"
  mv "$ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools" "$ANDROID_SDK_ROOT/cmdline-tools/latest"
  rm "$TMP_ZIP"
fi

export ANDROID_HOME="$ANDROID_SDK_ROOT"
export ANDROID_SDK_ROOT
export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$PATH"

# ── 4. Accept licenses + install SDK packages ────────────────────────────────
echo "[4/5] Accepting licenses and installing SDK Platform 34 + Build-Tools 34..."
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager --install \
  "platform-tools" \
  "platforms;android-34" \
  "build-tools;34.0.0" >/dev/null

# ── 5. Persist environment variables ─────────────────────────────────────────
echo "[5/5] Writing environment variables to ~/.bashrc..."
SHELL_RC="$HOME/.bashrc"
if ! grep -q "ANDROID_SDK_ROOT" "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" <<EOF

# FamilyTracker — Android SDK
export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
export ANDROID_HOME="\$ANDROID_SDK_ROOT"
export JAVA_HOME="$JAVA_HOME_PATH"
export PATH="\$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:\$ANDROID_SDK_ROOT/platform-tools:\$PATH"
EOF
  echo "    Added to $SHELL_RC"
fi

echo
echo "═══════════════════════════════════════════════"
echo "  SETUP COMPLETE"
echo "═══════════════════════════════════════════════"
echo "  ANDROID_SDK_ROOT : $ANDROID_SDK_ROOT"
echo "  JAVA_HOME        : $JAVA_HOME_PATH"
echo
echo "  Open a NEW shell or run:  source ~/.bashrc"
echo "  Then build with:          bash scripts/build-android.sh"
echo "═══════════════════════════════════════════════"
