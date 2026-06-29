# Changelog

## Unreleased — Code quality + hardening

### Fixed
- **System volume bug** (`media.js`) — `setSystemVolume` built a PowerShell
  command referencing `$vol`, an undefined PowerShell variable, instead of
  interpolating the JS-computed value. The volume-up step count always evaluated
  to 0, so the target volume was never reached. Now interpolates the real value.

### Internal
- **Electron integration tests** — added a Playwright-driven lane (`npm run test:e2e`,
  specs in `electron/e2e/`) that launches the real app and verifies the window
  opens, the preload bridge is wired, the idle-startup safety invariant holds
  (no auto-started countdown), and a full start → pause → resume → cancel cycle
  works over real IPC in dry-run (so no power action can ever fire). Runs in CI
  on `windows-latest` (the real target OS, no display shim needed).
- **ESLint** — added a flat config (`eslint.config.js`) with per-surface globals
  (main/Node, renderer/browser, dual-context UMD scripts, tests) and `npm run lint`
  / `npm run lint:fix`. `no-undef` is intentionally off for the renderer monolith
  (cross-`<script>` globals make ESLint's scope analysis unreliable there).
- **CI** — the verify job now actually lints, and the syntax-check step
  auto-discovers every first-party JS file (`*.js test/*.js scripts/*.js`) so the
  list can no longer drift as new modules are added.
- **WiFi Guard hardening** — MAC addresses from imported/shared config are now
  validated (`validMacs`, colon/hyphen/bare-hex forms only) at the block/unblock
  boundary, matching the existing `net.isIP` rigor for firewall IPs. Guards are
  exported for unit testing.
- **New tests** — `test/wifiGuard.test.js` covers the IP and MAC validation
  guards; unit suite is now 29 assertions (was 24).
- **Dead-code cleanup** — removed unused imports/locals across `alarm.js`,
  `contentBlocker.js`, `calendarProviders.js`, `smartLights.js`, `focusSessions.js`,
  `companion.js`, `overrideTax.js`, `accountability.js`, `calendar.js`,
  `screenTime.js`, `ambientVisuals.js`, and `wifiGuard.js`.

## v10.3.0 — Ritual Mode + Intelligence (2026-06-28)

### New
- **Ritual Mode** — guided bedtime ritual chains multiple systems together:
  breathing → content block → dim → timer → smart lights. Each step auto-advances
  or awaits acknowledgment. Fully skippable and configurable. "Begin Ritual" button
  on the main lobby.
- **Stats Dashboard** (`statsDashboard.js`) — single IPC that aggregates sleep score,
  debt, override history, streak, screen time, and recent receipts for the STATS panel
- **Smart Suggestions** (`smartSuggestions.js`) — analyzes sleep debt, override history,
  streak patterns to recommend bedtime adjustments and timer durations
- **Notification Center** — in-app notification feed with badge counter. Bell button in
  footer opens a scrollable drawer with all recent notifications (timestamped, colored by
  type). Notifications auto-accumulate from all `notify()` calls.
- **Companion stats view** — phone UI now shows sleep score, debt, streak, override tax
  debt, and autopilot badge in a dedicated section
- **Companion full stats broadcast** — state updates now include aggregated stats payload

### Internal
- New modules: `ritualMode.js`, `statsDashboard.js`, `smartSuggestions.js`
- Smoke suite: 72/72 (+4 over v10.2.0)
- Build files list updated for all new modules

## v10.2.0 — Override Tax + Autopilot (2026-06-28)

### New
- **Override Tax** — escalating cost for hitting snooze. First snooze is free; 2nd
  is logged and accountability partner notified; 3rd+ shortens tomorrow's timer by
  15 min; 4th+ requires a typed reason. Configurable via settings panel: free snoozes,
  tighten amount, max cap, reason threshold. Tray menu shows live cost level.
- **Override Tax settings panel** — full UI to enable/disable, adjust parameters,
  and view live session stats (snooze count, tomorrow's debt)
- **Snooze escalation modal** — renderer popup shows consequences list before
  allowing non-free snoozes, with required reason input for high-level overrides
- **Autopilot Bedtime** — learns your bedtime from streak history (median + std dev),
  schedules auto-start at habitual time with 5-min warning. Fully opt-in.
- **Autopilot settings panel** — shows learned bedtime, confidence, sample size;
  optional manual override time input
- **Companion phone tax indicator** — phone UI shows snooze cost warning when the
  next snooze would be penalized
- **Last Call** — default timer name renamed from "Witching Hour" to "Last Call"
- **Expanded smoke suite** — 68 assertions (+11 over v10.1.0) covering Override Tax
  module, IPC, modal, renderer integration, and Autopilot wiring

### Changed
- `snoozeTimer` now accepts a `reason` parameter for Override Tax compliance
- Tray snooze label dynamically reflects current cost level
- Companion state broadcast includes Override Tax stats

### Internal
- New modules: `overrideTax.js`, `autopilot.js`
- New test: `test/overrideTax.test.js` (11 assertions)
- Build files list includes new modules

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
