@echo off
rem Snel proberen zonder installatie: start de gids en opent de browser.
rem (Voor vast gebruik: installeer.bat - dan draait hij als Windows-service.)
cd /d "%~dp0"
if not exist "App_Data\service-procesgids.db" (
  echo Eerste start: kies eerst een veilig wachtwoord voor de lokale beheerder.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-local-admin.ps1" -Executable "%~dp0ServiceProcesgids.Api.exe"
  if errorlevel 1 (
    echo Bootstrap mislukt; de gids is niet gestart.
    pause
    exit /b 1
  )
)
echo De Service Procesgids start... De browser opent zo op http://localhost:5088
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:5088'"
ServiceProcesgids.Api.exe
