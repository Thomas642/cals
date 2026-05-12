@echo off
:: ════════════════════════════════════════════════════════════════════════════
::  FamilyTracker – Build Android APK on Windows
::
::  Prerequisites (install once):
::    1. Node.js 18+   → https://nodejs.org
::    2. JDK 17+       → https://adoptium.net  (Temurin 17 LTS recommended)
::    3. Android Studio → https://developer.android.com/studio
::       – During setup choose: SDK Platform 34, Build-Tools 34, Command-line tools
::       – Set ANDROID_HOME environment variable to your SDK folder
::         e.g.  C:\Users\YOU\AppData\Local\Android\Sdk
::       – Add  %ANDROID_HOME%\platform-tools  and  %ANDROID_HOME%\cmdline-tools\latest\bin
::         to your PATH
::    4. JAVA_HOME must point to your JDK folder
::         e.g.  C:\Program Files\Eclipse Adoptium\jdk-17.0.x.x-hotspot
:: ════════════════════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

echo.
echo ══════════════════════════════════════════════════
echo   FamilyTracker – Android APK Builder
echo ══════════════════════════════════════════════════
echo.

:: ── Step 1 – Install JS dependencies ────────────────────────────────────────
echo [1/6] Installing Node dependencies...
call npm install
if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )

:: ── Step 2 – Download vendor JS/CSS files ───────────────────────────────────
echo [2/6] Downloading vendor assets (Leaflet, socket.io)...

if not exist "frontend\vendor" mkdir "frontend\vendor"

:: Leaflet 1.9.4
if not exist "frontend\vendor\leaflet.js" (
  curl -fsSL "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"  -o "frontend\vendor\leaflet.js"
  if errorlevel 1 ( echo ERROR: Could not download leaflet.js & pause & exit /b 1 )
)
if not exist "frontend\vendor\leaflet.css" (
  curl -fsSL "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" -o "frontend\vendor\leaflet.css"
  if errorlevel 1 ( echo ERROR: Could not download leaflet.css & pause & exit /b 1 )
)
if not exist "frontend\vendor\leaflet-heat.js" (
  curl -fsSL "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js" -o "frontend\vendor\leaflet-heat.js"
  if errorlevel 1 ( echo ERROR: Could not download leaflet-heat.js & pause & exit /b 1 )
)

:: socket.io client – must match server version (4.x)
if not exist "frontend\vendor\socket.io.js" (
  curl -fsSL "https://cdn.socket.io/4.7.5/socket.io.min.js" -o "frontend\vendor\socket.io.js"
  if errorlevel 1 ( echo ERROR: Could not download socket.io.js & pause & exit /b 1 )
)

echo    Vendor assets OK.

:: ── Step 3 – Init Capacitor Android project (only needed once) ───────────────
if not exist android (
  echo [3/6] Adding Android platform...
  call npx cap add android
  if errorlevel 1 ( echo ERROR: cap add android failed & pause & exit /b 1 )
) else (
  echo [3/6] Android platform already present, skipping.
)

:: ── Step 4 – Sync web assets into Android project ───────────────────────────
echo [4/6] Syncing web assets to Android...
call npx cap sync android
if errorlevel 1 ( echo ERROR: cap sync failed & pause & exit /b 1 )

:: ── Step 5 – Apply required AndroidManifest permissions ─────────────────────
echo [5/6] Verifying AndroidManifest.xml permissions...
findstr /C:"ACCESS_BACKGROUND_LOCATION" "android\app\src\main\AndroidManifest.xml" >nul 2>&1
if errorlevel 1 (
  echo   NOTE: Background location permission not found.
  echo   Please open android\app\src\main\AndroidManifest.xml and add inside ^<manifest^>:
  echo     ^<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/^>
  echo     ^<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/^>
  echo     ^<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/^>
  echo   Then re-run this script.
  pause
)

:: ── Step 6 – Build debug APK via Gradle ─────────────────────────────────────
echo [6/6] Building debug APK (this may take a few minutes)...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 ( cd .. & echo ERROR: Gradle build failed & pause & exit /b 1 )
cd ..

:: ── Copy APK to project root ─────────────────────────────────────────────────
copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "FamilyTracker.apk"

echo.
echo ══════════════════════════════════════════════════
echo   BUILD SUCCESSFUL
echo   APK: %CD%\FamilyTracker.apk
echo.
echo   To install on your phone:
echo   1. Enable "Install from unknown sources" in
echo      Android Settings → Security (or Special app access)
echo   2. Copy FamilyTracker.apk to your phone via USB or Google Drive
echo   3. Open it from the file manager and tap Install
echo ══════════════════════════════════════════════════
echo.
pause
