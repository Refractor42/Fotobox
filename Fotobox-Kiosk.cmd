@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ============================================================
rem  Fotobox im Kioskmodus starten / beenden
rem  - Strg+Alt+K (Windows-Verknuepfung) schaltet den Kiosk um
rem  - startet den lokalen HTTPS-Server, falls er nicht laeuft
rem  - oeffnet Chrome/Edge mit --kiosk: keine Adressleiste, kein X
rem  - eigenes Browserprofil, damit der Kiosk nicht am bereits
rem    laufenden Browser haengt
rem  Beenden: Strg+Alt+K (dieses Skript) oder Alt+F4.
rem ============================================================

set "PORT=8443"
set "URL=https://localhost:%PORT%/"
set "KIOSK_PROFILE=%LOCALAPPDATA%\SnapBoxKiosk"

if /i "%~1"=="--dry-run" goto :after_toggle

rem --- Laeuft der Kiosk schon? Dann beenden und fertig. -------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = @(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains('SnapBoxKiosk') -and $_.CommandLine.Contains('--kiosk') }); if ($p.Count -gt 0) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0 }; exit 1"
if errorlevel 1 goto :after_toggle
echo Kiosk beendet.
exit /b 0

:after_toggle

echo Fotobox Kiosk
echo -------------

rem --- Automatische Abhaengigkeitspruefung (npm install) -----------
if not exist "node_modules\" (
    echo Abhaengigkeiten fehlen. Fuehre 'npm install' aus...
    call npm install
    if errorlevel 1 (
        echo.
        echo FEHLER: 'npm install' ist fehlgeschlagen.
        pause
        exit /b 1
    )
    echo Abhaengigkeiten erfolgreich installiert.
    echo.
)

rem --- Server pruefen, sonst starten ---------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',%PORT%); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Server laeuft nicht - starte ihn ...
  start "Fotobox Server" /min cmd /c "node dev-https-server.js"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ $c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',%PORT%); $c.Close(); $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    echo.
    echo FEHLER: Der Server konnte nicht gestartet werden.
    pause
    exit /b 1
  )
)

rem --- Browser finden (Chrome zuerst, dann Edge) --------------------
set "BROWSER="
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"

if not defined BROWSER (
  echo.
  echo FEHLER: Chrome oder Edge wurde nicht gefunden.
  pause
  exit /b 1
)

if /i "%~1"=="--dry-run" (
  echo URL:      %URL%
  echo Browser: %BROWSER%
  echo Profil:  %KIOSK_PROFILE%
  exit /b 0
)

echo Starte Kiosk ...
start "" "%BROWSER%" --kiosk --user-data-dir="%KIOSK_PROFILE%" --allow-insecure-localhost --use-fake-ui-for-media-stream --no-first-run --no-default-browser-check --disable-session-crashed-bubble "%URL%"
exit /b 0