@echo off
setlocal
rem Let Windows Explorer own the app, independently of this launcher's process group.
if not exist "%~dp0Launch Lights Out.cmd" exit /b 1
start "" "%SystemRoot%\explorer.exe" "%~dp0Launch Lights Out.cmd"
endlocal
