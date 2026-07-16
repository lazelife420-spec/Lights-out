# Companion V2 C1 runtime proof

These captures come from `npm run test:companion-v2-runtime`, which launches the
shipping Electron main process and companion HTTP/WebSocket server with isolated
user data and a free ephemeral port. The proof starts a canonical Quick Sleep in
Dry Run, drives a real companion `BrowserWindow`, and records the authoritative
desktop state after each command.

## Result

- 36 behavioral assertions passed; 0 failed.
- Six mutation commands were observed; zero real power actions occurred.
- `+5`, `+15`, and `+30` added exactly 300, 900, and 1,800 seconds.
- Rapid double input sent one command, pending commands were never replayed, and
  success appeared only after the desktop state echo.
- Pause, resume, cancel, reconnect, offline/stale handling, canonical Night Mode
  and profile identity, and Dry Run/Real Action labeling passed.
- Active layouts passed at 320, 360, 390, 412, and 430 CSS pixels with no
  horizontal clipping, controls at least 48 pixels high, and the primary controls
  visible in the initial frame.
- The proof blocks PowerShell side effects in its child process and runs every
  timer in Dry Run. Production safety boundaries are unchanged.

## Captures

- `01-active-*.png`: active controller at all five required widths
- `02-custom-timer-real-action.png`: honest fallback identity and Real Action state
- `03-details-open.png`: secondary statistics behind the collapsed Details panel
- `04-paused.png`: authoritative paused state
- `05-pending-add-time.png`: disabled conflicting actions while awaiting PC state
- `06-reconnecting.png`: reconnect state
- `07-offline-stale.png`: stale-state treatment and disabled mutations
- `08-large-font-narrow-fallback.png`: narrow/large-font fallback
- `09-cancel-confirmation.png`: in-page destructive-action confirmation

Run the proof again with `node scripts/companion-v2-electron-proof.js
--capture-docs` from `electron/` to refresh both the assertions and captures.
