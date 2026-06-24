Lights Out

PRIMARY APP (Electron)
  dist\LightsOut.exe  - the portable Electron app (primary shipping build)
  Run it directly or build from source: cd electron && npm run build

CLASSIC FALLBACK (PowerShell)
  SleepTimer.exe      - PowerShell/WinForms fallback (not the primary app)
  modules\            - required beside SleepTimer.exe
  source\             - PowerShell source (for dev/rebuild)

START HERE
  Double-click "Lights Out.bat"                    (opens Steam UI idle — safe default)
  Double-click "Lights Out Premium Preview.bat"    (DryRun preview — safe)
  Double-click "Lights Out - Force Shutdown Within 1 Hour.bat" only when you want force shutdown

OTHER FILES
  SleepTimer.ico      - tray icon
  LightsOut-Logo.png  - title logo
  archive\            - stale builds and historical backups

Settings (Electron):  %APPDATA%\Lights Out\userData\settings.json
Settings (classic):   %LOCALAPPDATA%\CoolTimer\settings.json
Emergency cancel:     Ctrl+Shift+S
Run at login:         creates a startup shortcut that opens Lights Out minimized and idle.
Agent handoff:        read AGENTS.md before making code changes.

BUILD (Electron — primary)
  cd electron
  npm install          # first time only
  npm run build        # produces dist\LightsOut.exe + installer

VERIFY (Electron)
  cd electron
  npm run smoke        # syntax + settings + startup/tray/IPC guards (expected: all pass)
  npm start            # run dev build

BUILD (PowerShell fallback — only if SleepTimer.exe needs a rebuild)
  Invoke-ps2exe -inputFile "source\SleepTimer-Tonight.ps1" `
    -outputFile "SleepTimer.exe" -noConsole `
    -title "Lights Out" -iconFile "SleepTimer.ico"
  Requires: ps2exe module (Install-Module ps2exe)

TESTING (PowerShell fallback)
  .\SleepTimer.exe -SteamUi -NoAutoStart -DryRun
  DryRun mode skips actual power actions.
  Verify: no popup errors, ring animation, options expand, tray menu works.
