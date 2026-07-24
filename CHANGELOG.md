# Changelog

## Unreleased

### Fixed
- Updated the transitive build-time `tar` resolution from 7.5.19 to 7.5.22,
  resolving `GHSA-r292-9mhp-454m` without broad dependency updates.
- Automated Electron proof runs no longer create real Windows notification-area
  icons. Tray creation is now idempotent, proof instances explicitly suppress
  the tray, and normal app shutdown destroys its tray icon before exit.

## v11.1.2 — Desktop Consolidation (2026-07-22)

Desktop: 11.1.2
Android Companion: 11.1.1, unchanged

### Changed
- **Startup returns to Tonight.** Normal launches and legacy saved
  `set`/`help` routes now settle on Tonight without flashing Settings. The
  migration completes before the renderer declares itself ready and preserves
  unrelated saved settings.
- **Usable Power, Settings, and Help menus.** Top menus now remain open while
  the pointer enters them and support click toggling, outside-click and Escape
  dismissal, mutual exclusion, arrow-key navigation, Enter activation, and
  focus return. Power choices still select intent only; confirmation and Dry
  Run safeguards remain on the shared start path.
- **Authoritative Use Tonight selection.** A selected Night Mode now drives the
  hero title, duration, action, ritual summary, preview, CTA, start payload,
  active-run identity, receipt attribution, and restart restoration from one
  state. The main process continues to resolve canonical mode identity and
  execution values.
- **Settings is a desktop workspace.** Settings is now a primary in-flow view
  with a persistent category rail and one selected category at a time instead
  of a widened modal or all-category mega-scroll. Save, Cancel, Back, Escape,
  sidebar state, and return navigation share one predictable lifecycle.
- **One primary Start action.** The visible Tonight hero CTA, Space shortcut,
  and Play Tonight Again all delegate to the same command and payload path.
  The hidden duplicate Start control and competing listeners are gone.
- **Focused active-run presentation.** The current countdown and selected mode
  dominate while Saved Profiles, streak content, and prior proof are hidden.
  Pause/Resume, Snooze, Cancel, and Dry Run status remain prominent, including
  while paused.
- **Navigation and terminology cleanup.** Desktop labels, routes, and control
  descriptions now match the consolidated Tonight, Modes, Schedule, Settings,
  and Stats surfaces.

### Fixed
- Registered ritual side-effect callbacks before the renderer becomes
  interactive, closing an early-launch window where a standard ritual could
  reach its timer step without creating the countdown or receipt.
- Replaced the desktop proof runner's preload-existence guess with an explicit
  renderer-ready handshake, fresh debugging ports, console/exception capture,
  route/view/modal diagnostics, and enforced native assertions.

### Safety
- Timer, receipt, companion, and Windows power-action boundaries remain
  unchanged. Dry Run is enabled in all release proof scenarios, and the native
  desktop gate records zero real power actions.
- This release does not claim Windows Authenticode signing.
- Android source, `versionCode`, and `versionName` are unchanged.

## v11.1.0 — Night Modes Library (2026-07-16)

### Added
- **Night Modes Library.** A new Modes panel offers six declarative bedtime
  presets. Four modes are ready to arm; Quiet House and School Night remain
  visibly unavailable with honest reasons. Selecting "Use Tonight" only loads
  canonical duration/action/ritual values into the lobby—it never starts a
  timer by itself. The Electron main process resolves mode identity, receipts
  record the canonical mode ID/title/version, and Night Modes cannot introduce
  arbitrary script or shell execution paths.

### Fixed
- **Static browser preview now initializes Night Modes.** The fallback API now
  supplies the smart-light getter used during startup plus safe preview-only
  Night Modes catalogue/arming methods. This prevents an unrelated missing
  method from aborting initial data loading and leaving the Modes panel empty.

### Verification
- ESLint, entry-point syntax checks, 214 unit tests, 239 smoke checks, the
  20-check Night Modes source proof, an 8-check real Electron runtime proof,
  static-preview interaction checks, and the full portable/NSIS production
  build pass. Real Electron interaction confirmed all four ready modes across
  DOM/preload/IPC/main, canonical receipt attribution, ritual handoff and
  cancellation, an accelerated Dry Run completion, and zero real power actions.

## v11.0.1 — Windows Production Readiness (2026-07-13)

This release includes all desktop work merged after v11.0.0. Android companion
source also changed in the same repository range, but it is not part of the
Windows installer and is not certified by the Windows production proof.

### Added
- **Family Profiles identity and receipt attribution.** Saved profiles can carry
  local family identity metadata, selected identity remains inert until a user
  explicitly starts a timer, and completed-run proof records the selected
  profile without breaking legacy profiles or receipts (PR #24).
- **Display-only profile accents.** Profiles can use an optional accent from a
  constrained palette. The accent is scoped to profile cards and manager rows;
  it never changes the desktop theme or timer behavior (PR #25).

### Changed
- **Settings, header, and pairing presentation.** Advanced options persist as
  they change, the wordmark no longer overlaps narrow desktop layouts, and the
  desktop/PWA pairing and companion-stat cards have clearer presentation
  (PRs #21–#23).
- **Companion diagnostics and host recovery.** Failed pairing attempts are
  surfaced, phone battery display is wired, stale socket callbacks cannot
  replace healthy connections, expired pairing is explained, and offline-host
  retries recover cleanly (commits `8d1e353`, `522adf7`, `85953c7`, `3675674`,
  and `5442ad1`). The Windows installer contains the Electron companion host
  and PWA changes.
- **Android companion recovery source.** Native Android recovery gained saved
  token reuse, subnet discovery, and a load watchdog (`e8dd021`, `85953c7`, and
  `5442ad1`). These sources require a separately signed, installed, and tested
  APK; this Windows release does not claim Android production readiness.

### Fixed
- **Desktop window movement, resizing, and placement persistence.** The custom
  frameless header now exposes a usable drag region, retains the native Windows
  resize border, and includes an explicit maximize/restore control. Manual
  dimensions are no longer overwritten by content mutations, the layout uses
  the available width, and normal window bounds survive Mini Mode and app
  restarts. Restored coordinates are clamped to an available display so a
  monitor change cannot strand the app off-screen.
- **Mini Mode geometry.** Entering Mini Mode now lowers the active minimum
  before requesting its 260×320 geometry. Exiting restores the 480×600 normal
  minimum, display-clamped saved bounds, and the prior maximized state. A real
  isolated Electron BrowserWindow test verifies the resulting geometry and
  relaunch behavior.
- **System volume setting now honors the requested percentage.** The media
  helper previously calculated a clamped volume but referenced an undefined
  PowerShell variable instead of inserting that value into the command. Volume
  commands now sanitize and clamp input, convert it to two-percent key steps,
  and guard the zero-step case so PowerShell cannot interpret `1..0` as a
  descending range. Unit coverage locks the 0%, 50%, 100%, invalid, and
  out-of-range cases. Confirmed dead bindings were removed and intentional
  cross-script renderer exports are now declared explicitly, leaving ESLint
  clean without suppressing dead-local detection.
## v11.0.0 — Serious Night Mode (2026-07-09)

### Fixed
- **Critical: the phone companion was completely non-functional.** Found via
  live device testing (a real phone physically paired against a real
  desktop instance) — every connection attempt silently failed and stayed
  stuck on "Connecting…" forever, regardless of a correct pairing code or
  network. Root cause: two unrelated past markup redesigns each left behind
  a dead DOM reference in `companion.html` (`#pair-reset`, then separately
  `#disconnected`/`#disconnected-msg`) that threw an uncaught exception and
  silently aborted the page's script before it ever attempted a connection.
  Fixed by removing the dead code; the status pill and automatic reconnect
  already covered everything those removed elements provided. Verified
  end-to-end afterward on a real device: real pairing, real WebSocket, live
  connected state. No reinstall needed on already-installed phones — the
  companion app loads this page fresh from the desktop on every connection.

### New
- **Trusted LAN mode.** Enabling "Connect Phone" (the mode that exposes the
  companion server to your Wi-Fi network) now requires explicitly
  confirming a warning that states exactly what's exposed (any device on
  the network with the pairing code can start/pause/snooze/cancel) and what
  stays off-limits (never a forced shutdown, logout, or hibernate).
- **Weekly Reports.** A "This Week" section on the Streaks tab summarizes
  the last 7 nights in plain language (nights logged, streak, bedtime
  consistency, snooze rate, actions taken) with a one-click "Copy Report"
  to clipboard. Built entirely from data already tracked — no new claims,
  no fabricated scoring.
- Full-screen clock mode (reuses the main window, hides all chrome, scales
  the analog clock to read from across a room) — carried over from the
  unreleased tail of v10.4.0's follow-through work.

### Removed
- `companion-mobile`, an unfinished, unused duplicate of the real Android
  companion app (`companion-android`) — no signing setup, no QR pairing, no
  CI or documentation references.

### Descoped
- **Smart light integration** is explicitly not part of this release.
  Code exists (`smartLights.js`) but has never been runtime-proven against
  real hardware, and this project ships proof-first — it stays parked
  until either real hardware is available to test against, or there's an
  explicit decision to ship it labeled experimental.

## v10.4.0 — Phone Companion Easy Connect + Profiles Upgrade + Streaks (2026-07-08)

### New
- **Phone Companion Easy Connect** — redesigned pairing flow with three modes:
  `Off` (disabled), `This PC only` (binds `127.0.0.1`, local machine only), and
  `Same Wi-Fi` (binds for LAN access). Desktop status pill shows live state:
  `Off`, `This PC only`, `Waiting for phone`, `Phone connected`, or
  `Connection failed`.
- **QR + manual pairing** — in `Same Wi-Fi` mode the desktop shows a scannable
  QR code, a manual URL fallback, and a short 6-character pairing code, with
  one-click copy for the manual URL. `This PC only` mode never exposes a QR.
- **Token-protected remote actions** — every phone command requires the
  pairing token; invalid or missing tokens are rejected with a proper
  WebSocket 401/403 response before the handshake completes. A hard safety
  check in the message handler also rejects any command while mode is `Off`,
  independent of the token check.
- **Real-time connection status** — the desktop status pill and the phone's
  own connection state (`Connecting…`, `Connected to [PC]`, `Disconnected`,
  `Pairing expired`, `Wrong network or PC offline`) update live, and the
  desktop shows how many phones are connected. All phone-side timer actions
  require confirmation and are disabled while disconnected.
- **Companion integration smoke test** — `npm run smoke:companion` starts the
  real HTTP/WebSocket bridge and verifies off/local/wifi mode, token gating,
  token rotation, and rejection semantics (`test/companion-integration.test.js`).

### Features (merged from `blackboxai/pr7-scope-cleanup`)
- **Profiles search, filter & pin** — the Profiles panel now has a search box,
  category filters, and the ability to pin favorite profiles to the top.
- **30-day sleep-history grid** — a calendar-style grid visualizes the last 30
  nights (on-time / snoozed / neutral) with hover tooltips; a streak-celebration
  modal fires on milestone streaks.
- **Companion auto-firewall + system status** — enabling `Same Wi-Fi` mode opens
  Windows Firewall inbound rules for the companion port/discovery and removes
  them on stop; the phone view shows the PC power plan and battery charge.

### Internal
- `companion.js` tracks connected client count and emits `status` events;
  main process broadcasts `remote-control-status` to the renderer on every
  state change.
- Updated `main.js`, `renderer.js`, `companion.js`, `companion.html`, and
  `styles.css`.

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

## v10.4.0 — Easy Connect Companion (2026-07-01)

### New
- **Easy Connect for phone companion** — redesigned pairing flow:
  - **Three connection modes**: `Off` (disabled), `This PC only` (local binding), and `Same Wi-Fi` (LAN binding)
  - **QR Code pairing**: Scan from the desktop app to pair instantly in `Same Wi-Fi` mode
  - **Short pairing codes**: 6-character codes for manual fallback
  - **Desktop status pill**: Real-time status indication (`Off`, `This PC only`, `Same Wi-Fi`)
  - **Mobile-first companion UX**: Improved layout, connection state feedback (`Connecting`, `Connected`, `Disconnected`, `Pairing expired`), and action confirmations
  - **One-click copy**: Copy the manual pairing URL to clipboard
- **Security hardening**:
  - Token-protected WebSocket handshake with 401/403 rejection
  - Explicit host binding control per mode
  - Hard safety check in message handlers to reject commands when mode is `Off`

### Internal
- New integration test: `test/companion-integration.test.js`
- Smoke suite: 116/116 (+6 over v10.3.0)
- Updated `main.js`, `renderer.js`, `companion.js`, `companion.html`, and `styles.css`
