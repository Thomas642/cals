@echo off
:: ════════════════════════════════════════════════════════════════════════════
::  FamilyTracker – Déployer une nouvelle version de l'APK sur le serveur
::
::  Prérequis :
::    - OpenSSH installé (inclus dans Windows 10/11)
::    - Clé SSH configurée pour le serveur (ou mot de passe demandé à la connexion)
::    - Avoir lancé build-android.bat d'abord pour générer FamilyTracker.apk
:: ════════════════════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

:: ── Configuration ────────────────────────────────────────────────────────────
set SERVER_USER=ubuntu
set SERVER_HOST=famille.gameone-val.com
set SERVER_PATH=/home/ubuntu/FamilyTracker/frontend/download
set APK_FILE=FamilyTracker.apk
set VERSION_FILE=version.json

:: ── Vérifications ────────────────────────────────────────────────────────────
echo.
echo ══════════════════════════════════════════════════
echo   FamilyTracker – Déploiement APK
echo ══════════════════════════════════════════════════
echo.

if not exist "%APK_FILE%" (
  echo ERREUR : %APK_FILE% introuvable.
  echo Lance d'abord build-android.bat pour générer l'APK.
  pause & exit /b 1
)

:: ── Demande la version ────────────────────────────────────────────────────────
set /p VERSION="Numéro de version (ex: 1.0.1) : "
if "%VERSION%"=="" set VERSION=1.0.0

:: ── Génère version.json ───────────────────────────────────────────────────────
for /f "tokens=1-3 delims=/ " %%a in ("%DATE%") do (
  set DD=%%a& set MM=%%b& set YYYY=%%c
)
set ISO_DATE=%YYYY%-%MM%-%DD%T12:00:00Z

echo { "version": "%VERSION%", "built_at": "%ISO_DATE%", "notes": "Mise a jour %VERSION%" } > %VERSION_FILE%
echo Version.json créé : v%VERSION%

:: ── Upload vers le serveur ────────────────────────────────────────────────────
echo.
echo Envoi de l'APK vers %SERVER_HOST%...
scp "%APK_FILE%" "%SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/FamilyTracker.apk"
if errorlevel 1 ( echo ERREUR : échec de l'envoi de l'APK. & pause & exit /b 1 )

echo Envoi de version.json...
scp "%VERSION_FILE%" "%SERVER_USER%@%SERVER_HOST%:%SERVER_PATH%/version.json"
if errorlevel 1 ( echo ERREUR : échec de l'envoi de version.json. & pause & exit /b 1 )

:: ── Résultat ─────────────────────────────────────────────────────────────────
echo.
echo ══════════════════════════════════════════════════
echo   DÉPLOIEMENT RÉUSSI  v%VERSION%
echo.
echo   Les membres peuvent télécharger la nouvelle
echo   version depuis :
echo   https://famille.gameone-val.com/download
echo ══════════════════════════════════════════════════
echo.
pause
