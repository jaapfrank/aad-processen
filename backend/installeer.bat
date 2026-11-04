@echo off
rem ============================================================
rem  Service Procesgids - installatie als Windows-service
rem  Dubbelklik dit bestand; het vraagt zelf om beheerdersrechten.
rem ============================================================
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Beheerdersrechten nodig - opnieuw starten als administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo  Service Procesgids wordt geinstalleerd als Windows-service...
echo  Bij een nieuwe installatie kiest u zo een beheerderswachtwoord.
echo  Bij een upgrade blijven bestaande accounts en wachtwoorden behouden.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"

if %errorlevel% neq 0 (
  echo.
  echo  Installatie mislukt. Bekijk de foutmelding hierboven.
  echo.
  pause
  exit /b 1
)

echo.
echo  Klaar! De gids draait op http://localhost:5088
echo  Log in als Admin met het wachtwoord dat bij de eerste installatie is gekozen.
echo  Eigen huisstijl instellen: Beheer ^> Huisstijl
echo.
pause
