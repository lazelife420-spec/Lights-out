# Changelog

## v10.1.0 — Visual Northstar (2026-06-24)

### New
- **Northstar Last Light overlay** — cinematic full-screen wind-down sequence with
  countdown ring, flavor panels, and UNPLUG button (informational-only; power action
  proceeds automatically after the sequence)
- **Northstar Lobby shell** — icon sidebar rail (LIB / SCH / SET / STATS / ?),
  centered header wordmark, and Tonight's Run hero card with PLAY shortcut; shown
  in idle state, hidden while running
- **Northstar Morning Proof hero** — full-width mission-complete card with dynamic
  headline, real stat pills (session length, action, snoozes, total runs), and
  actions: Play Tonight Again / View Ledger / Copy Proof / Dismiss. No fake data;
  streak pill omitted until tracking is implemented
- **Settings persistence for northstar UI state** — active sidebar tab and selected
  mode card now round-trip through `settings.json` alongside existing prefs
- **Timer name persistence** — `timerName` (editable session name) now saves on
  every edit and restores on launch
- **Expanded smoke suite** — +57 assertions covering tray guards, IPC handler
  presence, renderer control wiring, keyboard shortcuts, preview-safe defaults,
  login/warning wording, and preload bridge

### Fixed
- UNPLUG button correctly marked `disabled` with `aria-disabled`; sub-label updated
  to "PROCEEDING AUTOMATICALLY" so intent is unambiguous
- CSS orphaned custom properties wrapped in `:root` block
- Stray closing brace removed from `styles.css`
- `clearLastLightTimers` now correctly handles both `setTimeout` IDs and interval
  wrapper objects from the northstar ring ticker

### Unchanged
- Timer logic, countdown, and phase transitions
- Shutdown execution path (`executePowerAction`)
- Last Light audio/sequence engine
- IPC handler signatures
- PowerShell fallback (`SleepTimer.exe v5.3.0`)

---

## v10.0.10 — Startup crash fix (2026-06-16)

Fixed a packaged-app startup crash (`remoteControl.js` missing from electron-builder
file manifest) and corrected settings saves for WiFi Guard, Content Blocker, and
Accountability.

## v10.0.9 — Streaks tab restored (2026-06-15)

Restored the Streaks tab panel and fixed a cancel-timer error where guided breathing
cleanup could show a red error toast.

## v10.0.8 — Updater download target (2026-06-14)

Fixed in-app updater download target so it selects the real installer asset.
