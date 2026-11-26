@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "LIGHTS_OUT_QA_POWER_LOCK="
set "LIGHTS_OUT_SUPPRESS_TRAY="
set "LIGHTS_OUT_DESKTOP_UX_GATE="
start "" "%~dp0app\Lights Out.exe" "--user-data-dir=%~dp0user-data" --no-auto-start
endlocal
