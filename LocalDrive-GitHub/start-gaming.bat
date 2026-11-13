@echo off
setlocal
cd /d "%~dp0"

set "PORTABLE_NODE=%~dp0.tools\node24\node-v24.22.3-win-x64"
if exist "%PORTABLE_NODE%\node.exe" set "PATH=%PORTABLE_NODE%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 LTS or newer is required.
  pause
  exit /b 1
)

if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\gaming-mode.ps1"
