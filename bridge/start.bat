@echo off
rem Double-click launcher for Windows: runs the bridge without opening a terminal by hand
rem and asks for the PS4's IP address instead of making the user type a command line.
rem
rem 1. Move to this script's own folder, so it finds bridge.py regardless of where it was launched from.
rem 2. Check Python 3 is available; there's nothing else to install (README "Run it").
rem 3. Ask for the PS4's IP, remembering the last one used in a local, gitignored file.
rem 4. Run the bridge, then keep the window open so any error stays visible after it exits.
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PYTHON="
where python3 >nul 2>nul && set "PYTHON=python3"
if not defined PYTHON (
    where python >nul 2>nul && set "PYTHON=python"
)
if not defined PYTHON (
    echo Python 3 is required but wasn't found on this PC.
    echo Install it from https://python.org, then double-click this file again.
    pause
    exit /b 1
)

set "IP_FILE=.bridge-ip"
set "SAVED_IP="
if exist "%IP_FILE%" set /p SAVED_IP=<"%IP_FILE%"

echo GT7 Telemetry Bridge
echo --------------------
if defined SAVED_IP (
    set /p "IP=PS4 IP address [%SAVED_IP%]: "
    if "!IP!"=="" set "IP=%SAVED_IP%"
) else (
    set /p "IP=PS4 IP address (Settings ^> Network ^> View Connection Status): "
)

if "!IP!"=="" (
    echo No IP address entered.
    pause
    exit /b 1
)

echo !IP!> "%IP_FILE%"

%PYTHON% bridge.py --ps4-ip !IP!

echo.
pause
