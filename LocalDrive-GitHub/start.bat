@echo off
setlocal
cd /d "%~dp0"

set "PORTABLE_NODE=%~dp0.tools\node24\node-v24.22.3-win-x64"
if exist "%PORTABLE_NODE%\node.exe" set "PATH=%PORTABLE_NODE%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 LTS or newer is required.
  echo Install it from https://nodejs.org/ or run: winget install OpenJS.NodeJS.LTS
  echo Then close and reopen this window and run start.bat again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with its npm feature enabled.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env with the initial LocalDrive settings.
)

if not exist "node_modules" (
  echo Installing LocalDrive packages. This first step needs an internet connection.
  call npm install
  if errorlevel 1 goto failed
)

echo Building LocalDrive...
call npm run build
if errorlevel 1 goto failed

echo.
echo LocalDrive is starting in gaming-aware mode. It pauses while CS2 or Dota 2 is running.
echo Keep this window open while you use LocalDrive. Press Ctrl+C to stop the server.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\gaming-mode.ps1"
exit /b %errorlevel%

:failed
echo.
echo LocalDrive could not start. Review the error above, then run start.bat again.
pause
exit /b 1