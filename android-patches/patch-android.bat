@echo off
::  Applies required Android permissions to AndroidManifest.xml
::  Run ONCE after "npx cap add android" (or call from build-android.bat)

setlocal

set MANIFEST=..\android\app\src\main\AndroidManifest.xml

if not exist "%MANIFEST%" (
  echo ERROR: %MANIFEST% not found.
  echo Run this script from the android-patches folder AFTER npx cap add android.
  pause & exit /b 1
)

:: Check if already patched
findstr /C:"ACCESS_BACKGROUND_LOCATION" "%MANIFEST%" >nul 2>&1
if not errorlevel 1 (
  echo Manifest already patched. Nothing to do.
  pause & exit /b 0
)

:: Use PowerShell to insert permissions before </manifest>
powershell -Command ^
  "(Get-Content '%MANIFEST%') -replace '</manifest>'," ^
  "'    <!-- Background GPS - added by patch-android.bat -->`n" ^
  "    <uses-permission android:name=""android.permission.ACCESS_BACKGROUND_LOCATION"" />`n" ^
  "    <uses-permission android:name=""android.permission.FOREGROUND_SERVICE"" />`n" ^
  "    <uses-permission android:name=""android.permission.FOREGROUND_SERVICE_LOCATION"" />`n" ^
  "    <uses-permission android:name=""android.permission.WAKE_LOCK"" />`n" ^
  "    <uses-permission android:name=""android.permission.RECEIVE_BOOT_COMPLETED"" />`n" ^
  "</manifest>'" ^
  "| Set-Content '%MANIFEST%'"

if errorlevel 1 (
  echo ERROR: Patch failed. Edit AndroidManifest.xml manually (see android-patches\permissions.xml).
  pause & exit /b 1
)

echo Manifest patched successfully.
pause
