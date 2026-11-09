@echo off
setlocal

title n1ssan Development Launcher
cd /d "%~dp0"

echo.
echo  ==========================================
echo       n1ssan - Development Launcher
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not on PATH.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm is not installed or not on PATH.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERROR] package.json was not found.
    echo Place this BAT file in the n1ssan-web-bridge project root.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [ERROR] Dependencies are missing.
    echo Run "npm install" in this folder first.
    pause
    exit /b 1
)

echo [1/2] Starting n1ssan Bridge...
start "n1ssan Bridge" cmd /k "cd /d ""%~dp0"" && npm run bridge"

timeout /t 2 /nobreak >nul

echo [2/2] Starting Vite...
start "n1ssan Vite" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo.
echo Both services have been launched in separate windows.
echo Keep those windows open while testing.
echo.
exit /b 0
