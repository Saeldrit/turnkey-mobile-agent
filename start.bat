@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies ^(one-time^)...
  call npm install
)

call npm start
echo.
pause
