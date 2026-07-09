Lights Out

APP (Electron)
  dist\LightsOut.exe  - the portable Electron app (primary shipping build)
  Run it directly or build from source: cd electron && npm run build

OTHER FILES
  LightsOut-Logo.png  - title logo
  archive\            - stale builds and historical backups

Settings:             %APPDATA%\Lights Out\userData\settings.json
Emergency cancel:     Ctrl+Shift+S
Run at login:         creates a startup shortcut that opens Lights Out minimized and idle.
Agent handoff:        read AGENTS.md before making code changes.

BUILD
  cd electron
  npm ci               # first time only
  npm run build        # produces dist\LightsOut.exe + installer

VERIFY
  cd electron
  npm test             # unit tests (network-boundary validation, sanitizers)
  npm run smoke        # syntax + settings + startup/tray/IPC guards (expected: all pass)
  npm start            # run dev build
