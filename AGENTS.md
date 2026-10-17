# Lights Out Agent Master Plan

This file is the handoff document for any code agent working in this repo.
The product has a Windows Electron app under `electron/` and a standalone native
Android app under `companion-android/`, with independent execution and release
trains. (A legacy PowerShell /
WinForms "classic" app — `source\SleepTimer-Tonight.ps1`, `modules\*.psm1`, and
its `SleepTimer.exe` launchers — was removed on 2026-06-29; do not reintroduce
it. PowerShell is now used only as `child_process` calls from the Electron main
process for Windows system actions, never as a separate app surface.)

## Mission

Lights Out is a local-first night timer and routine product for Windows and
standalone Android. Each device owns its timer and settings; phone-to-PC control
is a separate optional feature. The Windows app provides the shutdown ritual.
The core product idea is:

- open safely by default
- make shutdown intent clear
- allow stronger actions only when the user chooses them explicitly
- support a "lobby first" flow instead of surprising the user with an immediate countdown

## Product Surface

There is one *desktop* app surface: `electron\`.
It is the primary shipping UI, with a real build and packaging flow.
The old WinForms UI has been deprecated and removed in favor of this cockpit dashboard.

There is also a standalone native Android app, `companion-android\`. Its bundled
offline home (`HomeActivity`, `assets/phone`) controls a persistent native phone
reminder timer (`PhoneTimer`, foreground service + AlarmManager). The separate
phone Lighting/Routines/Calendar tabs use direct native WiZ UDP and native
calendar alarms (`PhoneLights`, `PhoneCalendar`, `PhoneHomeStore`). They work
independently of the PC; their settings are not synchronized with desktop ones.
Calendar auto-start requires Alarms & reminders access. Never claim emulator
UDP tests establish real phone/router background reliability. The separate
`MainActivity` WebView controls a paired PC via `electron\companion.html`, with its own QR
pairing scanner (CameraX + on-device ML Kit), documented in
`companion-android\README.md`. It is not part of the desktop build/release
train; CI now qualifies its isolated debug tests/lint/build, while physical-device
QA and production APK signing remain separate. Treat source changes as a separate
workflow. Its release keystore
(`~/.android/lightsout-companion-release.jks`, gitignored
`companion-android\keystore.properties` alongside it) is the one and only
signing identity for this app going forward — it has no recovery path if
lost, so if you (the agent) ever generate or touch it, flag that loudly to
the user rather than treating it as disposable. (`companion-mobile\`, an
earlier, unfinished Capacitor-based duplicate of this same idea, was removed
2026-07-09 — if you see references to it in old history, that's why.)

For Android QA, copy only source and Gradle wrapper files into a temporary
project, excluding signing properties. Use an isolated `ANDROID_USER_HOME` and
clear release-signing environment variables. The app Gradle file reads signing
properties even for debug tasks, so do not build QA in the real checkout.
Run `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` and test the debug
package on the emulator. Never replace or uninstall the production package for QA.

## Current State

The important behavior is:

- force shutdown is never the default launcher behavior; it must be chosen explicitly
- "Run at login" means "start minimized and idle" — login startup never silently
  implies a force shutdown or an active countdown
- the current release version is `v11.2.0`; verify GitHub Releases before claiming
  publication. `docs/RELEASE_QUALIFICATION_11.2.0.md` records the qualified scope
  and evidence. Windows installer/portable publication and Android debug-source
  qualification remain separate from Android production signing and physical QA
- `npm run build` produces a native Windows installer, portable ZIP, checksums
  and source/runtime manifest; installer QA uses isolated paths and registration
- Electron smoke coverage guards startup wording/flags, tray menu wiring, timer
  control IPC, mini mode wiring, keyboard shortcuts, and browser-preview safe defaults
- unit tests cover the network trust boundaries: remote-command validation, the
  companion WebSocket handshake + frame codec, the family LAN discovery parser,
  and the wifiGuard input sanitizers
- Electron has a `^43.5.0` minimum and is locked/provisioned at `43.7.11`;
  `sharp` has a `^0.35.5` minimum. The October 14 qualification also updates
  vulnerable transitive brace-expansion and undici resolutions. Native Windows
  packaging uses the provisioned Electron runtime and rcedit, rather than
  electron-builder. The Sharp N-API binary needs no Electron ABI rebuild.
- `main.js` installs `process.on('uncaughtException'/'unhandledRejection', ...)`
  handlers that log to `userData/startup.log` and keep the app alive rather than
  letting an unrelated bug silently kill the user's active timer

## Source Of Truth

Windows app work happens in `electron\`:

- timer state, tray behavior, login-item behavior, and final Windows power actions:
  `electron\main.js`
- view state, browser-preview fallback behavior, and UI interactions: `electron\renderer.js`
- the IPC bridge: `electron\preload.js`
- markup and styles: `electron\index.html`, `electron\styles.css`
- feature modules (calendar, profiles, smart lights, companion, family, wifi guard,
  content blocker, etc.): the per-feature files in `electron\`

Native Android home/timer/service/alarms, phone WiZ and calendar work happens in
`companion-android\app\src\main`. Its optional PC-controls WebView is separate
from the bundled native bridge. See `docs/ANDROID_FIELD_QA.md` for hardware HOLDs.
The local v1 routine contract is in `electron/routineModel.js`, bundled with
identical bytes as Android's `assets/phone/routine-model.js`. Native Android
validates the same plan at its bridge. Keep the parity test, explicit local
ownership, claim-before-dispatch and truthful action outcomes. See
`docs/CALENDAR_ROUTINE_V1.md`. Offline interchange is implemented; secured
handoff protocol components are isolated-test qualified in
`docs/SECURED_DEVICE_HANDOFF_FOUNDATION.md`. No production handoff listener,
transfer UI, persistent trust/key storage or new remote execution is enabled.
The invisible Windows Host, unified routine model and phone-owned First Light
remain separate scoped tranches in `docs/ROADMAP.md`; source stubs or a published
Windows release do not establish completion of those architectural goals.

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
  Historical electron-builder output and proof/review staging. Do not hand-edit it.

- `dist-native\`
  Current Windows build output from `electron\scripts\package-native-windows.ps1`.
  The launcher is `dist-native\win-unpacked\Lights Out.exe`; the portable ZIP is
  alongside `win-unpacked`. Do not hand-edit it. Isolated build candidates use
  `dist-native-*\` and can be selected with `LIGHTS_OUT_PACKAGED_EXE`.

- `LightsOut.exe` (root)
  **Does not exist.** Use the native launcher or versioned portable ZIP above.

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
7. End-to-end (real Electron + packaged artifact):
   - `npm run test:e2e:ci` — Unattended CI lane (`packaged-truth-smoke` required)
   - `npm run test:e2e:desktop` — Interactive Windows desktop lane (`desktop-ux-functional-gate` required; requires unlocked desktop, foreground custody, hands-off mouse/keyboard)
   - `npm run test:e2e` — Full release qualification umbrella runner requiring both CI and Interactive Desktop passes for Full E2E GREEN.
   - `night-modes-electron-proof` is required: it advances its proof-process clock
     and polling cadence together, leaving the system clock and shipped app alone.
   - `npm run test:packaged-local` — Packaged IPC, navigation, timer controls,
     occupied-port recovery and cleanup on loopback, with existing firewall rules
     preserved. It can run alongside an existing app instance. This is not the
     full Wi-Fi/firewall or interactive desktop release gate.

Current smoke/test expectations include:
- `npm run test:e2e` as the consolidated real Electron/packaged integration lane
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

- desktop changes landed in `electron\`, Android changes in `companion-android\`
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
