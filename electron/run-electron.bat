@echo off
:: Lights Out Electron Launcher
cd /d "%~dp0"

echo Lights Out Electron
echo ===================
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo.
    echo Please install Node.js 22.13.0+ from https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies when missing
if not exist "node_modules" (
    echo Installing dependencies...
    call npm ci --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

:: Provision locked Electron binary when missing
if not exist "node_modules\electron\dist\electron.exe" (
    echo Provisioning locked Electron runtime...
    call npm run electron:provision
    if %errorlevel% neq 0 (
        echo ERROR: Failed to provision Electron binary
        pause
        exit /b 1
    )
)

:: Launch
echo Starting Lights Out...
call npm start
