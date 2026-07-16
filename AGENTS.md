# Lights Out Agent Master Plan

This file is the handoff document for any code agent working in this repo.
The product is a single Electron app under `electron/`. (A legacy PowerShell /
WinForms "classic" app — `source\SleepTimer-Tonight.ps1`, `modules\*.psm1`, and
its `SleepTimer.exe` launchers — was removed on 2026-06-29; do not reintroduce
it. PowerShell is now used only as `child_process` calls from the Electron main
process for Windows system actions, never as a separate app surface.)

## Mission

Lights Out is a Windows bedtime shutdown ritual app.
The core product idea is:

- open safely by default
- make shutdown intent clear
- allow stronger actions only when the user chooses them explicitly
- support a "lobby first" flow instead of surprising the user with an immediate countdown

## Product Surface

There is one *desktop* app surface: `electron\`.
It is the primary shipping UI, with a real build and packaging flow.
The old WinForms UI has been deprecated and removed in favor of this cockpit dashboard.

There is also an optional native Android companion, `companion-android\` — a
thin WebView wrapper (Kotlin) around `electron\companion.html` with its own QR
pairing scanner (CameraX + on-device ML Kit), documented in
`companion-android\README.md`. It is not part of the desktop build/release
train and has no CI coverage; treat changes to it as a separate, manual
workflow. Its release keystore
(`~/.android/lightsout-companion-release.jks`, gitignored
`companion-android\keystore.properties` alongside it) is the one and only
signing identity for this app going forward — it has no recovery path if
lost, so if you (the agent) ever generate or touch it, flag that loudly to
the user rather than treating it as disposable. (`companion-mobile\`, an
earlier, unfinished Capacitor-based duplicate of this same idea, was removed
2026-07-09 — if you see references to it in old history, that's why.)

## Current State

The important behavior is:

- force shutdown is never the default launcher behavior; it must be chosen explicitly
- "Run at login" means "start minimized and idle" — login startup never silently
  implies a force shutdown or an active countdown
- the current tagged/published release is `v11.1.0` — Night Modes Library:
  four main-resolved ready modes, two honestly unavailable future modes, safe
  lobby arming without auto-start, canonical receipt attribution, and real
  Electron runtime proof — shipped on top of v11.0.1 production hardening
- Electron build packaging succeeds with `npm run build`
- Electron smoke coverage guards startup wording/flags, tray menu wiring, timer
  control IPC, mini mode wiring, keyboard shortcuts, and browser-preview safe defaults
- unit tests cover the network trust boundaries: remote-command validation, the
  companion WebSocket handshake + frame codec, the family LAN discovery parser,
  and the wifiGuard input sanitizers
- Electron is pinned to `^43.0.0` and electron-builder to `^26.0.0` (bumped from
  30/24 to close 7 high-severity npm-audit CVEs against the old Electron line;
  `npm audit` is clean); `sharp`'s prebuilt N-API binary needs no rebuild across
  that jump
- `main.js` installs `process.on('uncaughtException'/'unhandledRejection', ...)`
  handlers that log to `userData/startup.log` and keep the app alive rather than
  letting an unrelated bug silently kill the user's active timer

## Source Of Truth

All app work happens in `electron\`:

- timer state, tray behavior, login-item behavior, and final Windows power actions:
  `electron\main.js`
- view state, browser-preview fallback behavior, and UI interactions: `electron\renderer.js`
- the IPC bridge: `electron\preload.js`
- markup and styles: `electron\index.html`, `electron\styles.css`
- feature modules (calendar, profiles, smart lights, companion, family, wifi guard,
  content blocker, etc.): the per-feature files in `electron\`

PowerShell is still invoked for ad-hoc system calls (battery, power plans, shutdown
commands) via `child_process.spawn` inside the Electron main process. There is no
standalone PowerShell app to keep in sync anymore.

## Safe Defaults

These are intentional product constraints. Do not casually remove them.

- default open behavior should be idle, not auto-start
- preview paths should prefer `DryRun` when possible
- force shutdown should be explicit and discoverable, not hidden behind the normal launcher
- "Run at login" wording must stay aligned with actual behavior: minimized and idle
- the app must never change the user's desktop theme
- all wind-down system actions (Night Light, media pause, lockout) default OFF
- remote/companion control may never force a shutdown, log out, or hibernate

## Files To Treat Carefully

- `dist\`
  Electron build output. Do not hand-edit files here.

- `LightsOut.exe` (root)
  **Does not exist.** The only valid portable build is `dist\LightsOut.exe`.

- `archive\`, `system-tune-backup-*`
  Historical backups / reference material. Do not edit unless the user explicitly asks.

## Known Architecture Notes

- `main.js` owns timer state, tray behavior, login-item behavior, and final Windows power actions
- `renderer.js` owns view state, browser-preview fallback behavior, and UI interactions
- `preload.js` is the IPC bridge (contextIsolation on, nodeIntegration off)
- the companion phone PWA and family LAN control bind over plaintext LAN behind a
  pairing token — this is accepted-by-design for a personal LAN tool
- static preview in a browser is useful for layout smoke tests, but it is not the
  authoritative runtime; browser preview uses a fallback API because there is no
  Electron preload bridge in plain browser mode

## Verification Checklist

1. Lint (ESLint flat config; errors fail, legacy warnings are tolerated):
   `cd electron && npm run lint`
2. Syntax-check (CI globs every `electron/*.js`; locally the entry points are enough):
   `node --check electron\main.js`
   `node --check electron\renderer.js`
   `node --check electron\preload.js`
3. Unit tests:
   `cd electron && npm test`
4. Smoke:
   `cd electron && npm run smoke`
5. Run:
   `cd electron && npm start`
6. Package when the change is meaningful:
   `cd electron && npm run build`

Note: there is no `test:e2e` lane yet — do not reference one until an Electron
integration harness actually exists (Proof Foundry standard: no fake claims).

Current smoke/test expectations include:
- startup wording and login flags
- tray menu/show-hide protections
- timer control IPC wiring
- mini mode and keyboard shortcut guards
- preview/fallback safe defaults
- network-boundary validation (remote commands, WS frames, discovery beacons, sanitizers)
- companion Easy Connect: off/local/wifi mode contract, QR gating, token-protected remote actions, and real-time connection status

### Static browser preview of the Electron UI

Use this only for layout and interaction smoke tests. It is not a substitute for
running Electron itself.

1. `python -m http.server 58731 --bind 127.0.0.1 --directory electron`
2. Open `http://localhost:58731/index.html`
3. Expect the renderer fallback path, not the Electron preload path.

## Definition Of Done

A task is not done until:

- the change landed in `electron\`
- the safest default behavior still makes sense
- verification was actually run for the surface you changed
- the smoke/unit suites were updated if the changed behavior should be regression-guarded
- docs or launcher text were updated if user-facing behavior changed

## Do Not Reintroduce

Avoid these regressions unless the user explicitly asks for them.

- the standalone PowerShell / WinForms app (`source\`, `modules\`, `SleepTimer.exe`)
- a default launcher that starts with force shutdown
- login startup that begins an active countdown without user intent
- docs claiming a flow is "idle" when the code actually auto-starts
- editing backup files instead of current source files
