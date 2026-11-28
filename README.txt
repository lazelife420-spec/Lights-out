Lights Out: the bedtime system for Windows (v11.3.5)
Forged by The Proof Foundry. MIT License.

APP (Electron)
  dist-native\win-unpacked\Lights Out.exe  - native unpacked Windows launcher
  dist-native\Lights-Out-Setup-v11.3.5.exe - NSIS installer
  dist-native\Lights-Out-Portable-v11.3.5-win-x64.zip - portable ZIP
  Build from source: cd electron && npm ci && npm run electron:provision && npm run build

OTHER FILES
  LightsOut-Logo.png  - title logo

Settings:             %APPDATA%\lights-out-electron\settings.json (userData\settings.json);
                      portable: <extracted folder>\user-data\settings.json.
                      Quit Lights Out (tray > Quit) before editing it: the app
                      rewrites settings.json while it runs, so an edit made while
                      it is open is lost. Then start it again.
Emergency cancel:     Ctrl+Shift+X from anywhere (also during Last Light, until the
                      power request is sent) or the tray's cancel. Esc in the window
                      also cancels, but it closes an open dialog or panel first (or
                      leaves a focused field): at
                      the imminent-action warning Esc only closes the warning and
                      the countdown keeps going, so use its Cancel timer button or
                      Ctrl+Shift+X. Ctrl+Shift+S only shows/hides the window.
Quick-start hotkeys:  Ctrl+Shift+L and Ctrl+Shift+1..4 are off by default. To turn
                      them on, quit Lights Out (tray > Quit), set
                      "globalQuickStartShortcuts": true in the "app" section of
                      settings.json, then start Lights Out again.
Backups:              Export all data leaves out credentials, the pairing code and any
                      running timer; Import all data keeps this PC's own credentials.
Wi-Fi Guard:          experimental and off by default. It saves a recovery record
                      (userData\wifi-guard-recovery.json, no credentials) before any
                      network change and tries to undo a leftover block when you quit
                      or, after a crash, at the next launch (unless you chose to keep
                      it). Unit-tested only; real router/adapter behaviour is not
                      qualified.
Run at login:         creates a startup entry that opens Lights Out minimized and idle.
Agent handoff:        read AGENTS.md before making code changes.

BUILD
  cd electron
  npm ci                     # first time only
  npm run electron:provision # download locked Electron binary
  npm run build              # produces ../dist-native installer, portable ZIP & SHA256SUMS.txt

VERIFY
  cd electron
  npm run lint         # ESLint static correctness checks
  npm test             # unit tests (network-boundary validation, sanitizers, security regressions)
  npm run smoke        # syntax + settings + startup/tray/IPC guards (expected: all pass)
  npm start            # run dev build
