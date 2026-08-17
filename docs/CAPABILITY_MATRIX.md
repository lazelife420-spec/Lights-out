# Lights Out — Source-Verified Capability Matrix

This matrix is derived from an actual inspection of the Electron source (`electron/`). It separates what the code currently does from what the website and roadmap describe as future direction.

| State | Meaning |
|---|---|
| **Shipped / Visible** | Code exists, UI surface is exposed, and the feature is treated as available in the current release. |
| **Shipped / Buried** | Code exists and is wired, but the UI is hidden inside a Settings sub-section or behind an opt-in/setup gate. |
| **Partial / Stubbed** | UI or module exists, but it is gated, disabled, experimental, or not runtime-proven with real hardware/accounts. |
| **Absent / Planned** | No real implementation; belongs in the long-term whole-room bedtime control vision. |

---

## Tonight (the nightly ritual)

| Capability | Status | Notes |
|---|---|---|
| PC countdown timer | **Shipped / Visible** | `main.js` `startTimer`, `beginValidatedCountdown`; actions: `shutdown`, `restart`, `sleep`, `hibernate`, `lock`, `logout`. |
| Pause / resume / snooze / cancel | **Shipped / Visible** | `pauseTimer`, `resumeTimer`, `snoozeTimer`, `cancelTimer` in `main.js`; tray, keyboard, and phone companion can all trigger. |
| Wind-down phase (focus, dim, last light) | **Shipped / Visible** | `applyDimPhase`, `applyFocusMode`, `playLastLightRitual` in `main.js`; ambient canvas, warm shift, sounds. |
| Last Light cinematic finale | **Shipped / Visible** | `lastLight.js`; renderer shows UNPLUG visual and final countdown. |
| Grace-period warning / emergency cancel | **Shipped / Visible** | `imminent-action` warning + `Ctrl+Shift+S` emergency cancel. |
| Force shutdown as explicit opt-in | **Shipped / Visible** | Settings > Power & Safety; never the default. |
| Dry Run mode | **Shipped / Visible** | Skips real power action; used in smoke tests. |
| Night Modes library | **Shipped / Visible** | `nightModes.js`; 4 ready cards (`quick-sleep`, `lights-down`, `movie-wind-down`, `full-shutdown`). |
| Night Modes disabled cards | **Partial / Stubbed** | `quiet-house` and `school-night` are in the catalogue but marked `status: 'coming_soon'` / `'needs_router_setup'` and cannot be used. |
| Autopilot bedtime learning | **Partial / Stubbed** | Settings persist `autopilotEnabled` (default `false`) and `autopilotBedtime`; no evidence of a learned model runtime. |

## Devices (PC, phone, lights, Wi-Fi)

| Capability | Status | Notes |
|---|---|---|
| Phone Companion Easy Connect | **Shipped / Visible** | `companion.js`, `companion.html`, `remoteControl.js`; QR + token, off by default, local or same-Wi-Fi. Real phone pairing is the next pending proof lane. |
| Companion action set | **Shipped / Visible** | `remoteControl.js` `COMPANION_ACTIONS`: `start`, `startNightMode`, `getNightModes`, `togglePause`, `snooze`, `cancel`. `ALLOWED_ACTIONS` for remote start: `shutdown`, `sleep`, `restart`. No `hibernate`, `lock`, `logout`, no force shutdown. |
| Family LAN remote | **Shipped / Buried** | `family.js` + `main.js` `familyCommandHandler`; `start`, `pause`, `resume`, `snooze`, `cancel` over LAN beacon. Discovery is surfaced in the Devices panel; configuration stays under Settings > Phone Companion. |
| Smart Lights | **Partial / Stubbed** | `smartLights.js` is a full implementation (Hue, HTTP, Home Assistant, IFTTT, MQTT), but it is gated: `enabled` requires a successful `testSmartLightConnection()` and the UI lives under Settings > Wind-Down with a `REQUIRES SETUP` pill. No real hardware proof is claimed. |
| WiFi Guard | **Partial / Stubbed** | `wifiGuard.js` has providers (`tplink`, `asus`, `netgear`, `webhook`, `adapter`) and is wired to block on dim / unblock on cancel, but marked `EXPERIMENTAL` and rejected for the retired `firewall` provider. Tests only cover input sanitizers. |
| Per-device whole-room scheduling | **Absent / Planned** | No data model or UI for independent timers per device. Vision lives in `docs/ROADMAP.md`. |
| Native "Devices" top-level panel | **Shipped / Visible** | `index.html` sidebar now has `DEVICES` (`ns-panel-dev`) exposing This PC, Phone Companion, Family LAN, Smart Lights, and WiFi Guard with read-only status and settings shortcuts. |
| Native "Proof" top-level panel | **Shipped / Visible** | `index.html` sidebar `PROOF` (`ns-panel-stats`) shows run history / session receipts; Companion Status moved to Devices. |

## Schedule (when it happens)

| Capability | Status | Notes |
|---|---|---|
| Built-in recurring schedule rules | **Shipped / Visible** | `calendarProviders.js` `normalizeScheduleRules` / `getDefaultCalendarEvents`; time, days, duration, action (`shutdown`, `sleep`, `hibernate`). UI in Schedule > Schedule. |
| .ics / iCal import | **Shipped / Visible** | `calendar.js` parses ICS text; renderer imports file or URL. |
| Google / Outlook / Calendly providers | **Partial / Stubbed** | `calendarProviders.js` has fetch functions, but they require user API keys/tokens and are not runtime-proven in the test suite. |
| Saved profiles | **Shipped / Visible** | `profiles.js` stores named timer profiles; visible in the schedule panel and tray. |
| Per-device schedules / presets | **Absent / Planned** | Only the PC has a schedule today. Multi-device "Tonight's Plan" is a design direction, not code. |

## Proof (what actually ran)

| Capability | Status | Notes |
|---|---|---|
| Run receipts | **Shipped / Visible** | `runReceipts.js` creates durable, append-only `run-receipts.json` with `power_executed`, `dry_run_completed`, `cancelled`, etc. |
| Morning Proof hero | **Shipped / Visible** | `renderer-receipts.js` `renderMorningProof` shows the latest receipt in the lobby. |
| Streaks / history | **Shipped / Visible** | `streaks.js`, `stats.js`; visible in Schedule > Streaks and the lobby. |
| Proof / run history panel | **Shipped / Visible** | `index.html` `ns-panel-stats` (sidebar label `PROOF`) shows Session History and the `View Full Ledger` button. Companion status was removed and now lives in the Devices panel. |
| Full "what ran, what failed/skipped" ledger | **Partial / Stubbed** | `btn-stats-view-ledger` exists and opens the full receipt ledger; the panel is still a session summary, not a full device-by-device proof timeline. |

## Settings (persistent preferences)

| Capability | Status | Notes |
|---|---|---|
| Power, wind-down, clock, appearance | **Shipped / Visible** | `renderer-settings.js`, `settings.js`. |
| Phone Companion | **Shipped / Visible** | Settings > Phone Companion; off / local / same-Wi-Fi, port, token regen, QR. |
| Smart Lights config | **Shipped / Buried** | Nested under Settings > Wind-Down. |
| WiFi Guard config | **Shipped / Buried** | Nested under Settings > Protection. |
| Family Mode config | **Shipped / Buried** | Nested under Settings > Phone Companion. |
| Content Blocker / Accountability | **Shipped / Buried** | `contentBlocker.js`, `accountability.js`; in Settings > Protection / Accountability. |
| First Light alarm | **Shipped / Buried** | `alarm.js`; in Settings > Automations. |

---

## Information Architecture Reality Check

Current top-level nav in `index.html`:

- **TONIGHT** (`ns-panel-lib`) — lobby, timer, armed night mode, Morning Proof.
- **MODES** (`ns-panel-modes`) — Night Modes library.
- **SCHEDULE** (`ns-panel-sch`) — quick setup, schedule rules, calendar, focus, streaks.
- **DEVICES** (`ns-panel-dev`) — PC status, Phone Companion, Family LAN, Smart Lights, WiFi Guard, with settings shortcuts.
- **PROOF** (`ns-panel-stats`) — Session History / run receipts.
- **SETTINGS** (`ns-panel-set`) — persistent preferences, including the configuration for Phone Companion, Smart Lights, WiFi Guard, and Family.
- **HELP** (`ns-panel-help`) — about / docs.

Desired northstar:

- **Tonight** — ✅ exists.
- **Schedule** — ✅ exists.
- **Devices** — ✅ exists; device configuration remains in Settings (which is the persistent-preferences surface).
- **Proof** — ✅ exists and is labeled `PROOF`.
- **Settings** — ✅ exists as the persistent-preferences surface.

---

## Honest product statement

What works today:
- A Windows PC bedtime timer with pause, snooze, cancel, wind-down, Last Light, and emergency cancel.
- Saved profiles, schedule rules, calendar import, streaks, and Morning Proof.
- A token-protected phone companion that can start, pause, snooze, or cancel the PC timer from the same Wi-Fi.

What does **not** work today (and must not be marketed as shipped):
- Independent schedules for lights, Wi-Fi, or other devices.
- Whole-room "Tonight's Plan" orchestration.
- Per-device recurrence, presets, or rituals spanning more than the PC.
- Native smart-light control as a first-class device (the Smart Lights module is opt-in and unproven with real hardware).
- Wi-Fi/router control as a first-class device (WiFi Guard is experimental and unproven with real routers).
