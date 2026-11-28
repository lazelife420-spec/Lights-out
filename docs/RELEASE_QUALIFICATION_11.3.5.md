# v11.3.5 release qualification

v11.3.5 is a safety and reliability release on v11.3.4. It does not claim
publication: CI publishes the `v11.3.5` GitHub release only after its own
gates pass.

## Scope

From the 2026-11-27 engineering audit (`review/ENGINEERING-AUDIT-20261127.md`,
local) and the v11.3.4 qualification:

- `electron/styles.css`: a "· tomorrow" end time stays on one line at 1000px
  and narrower, in every theme (`1664167`, `9709204`).
- `electron/family.js`, `renderer-family-remote.js`: outbound Family commands
  never carry this PC's pairing token and are refused locally with
  `PAIRING_REQUIRED` (`cb5316b`).
- `electron/main.js`, `renderer.js`: no start of any origin replaces a run
  that is completing; Emergency Override uses `hasCancellableRun()`; the stale
  check runs again right before dispatch; the window keeps Cancel while a real
  run is finishing (`cb5316b`).
- `electron/main.js`: every PowerShell call is bounded (hidden window,
  timeout with kill, output cap); system info refreshes once, only with a
  phone connected; quit waits (bounded) for the firewall-pair removal
  (`16ad6b0`).
- `electron/settings.js`: a backup import can only make force shutdown,
  Autopilot, quick-start shortcuts, Test Mode and calendar auto-start safer
  (`74c92d2`).
- `electron/scripts/packaged-truth-smoke.js`, `e2e-runner.js`: the packaged
  layout gate covers every theme and an after-midnight end time, and CI runs
  it (`162283a`).

No change to which power actions exist, to the remote-control allow-list, to
networking ports or to the Android app.

## Gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors, 0 warnings. `node --check` on every `electron/*.js` and
  `electron/scripts/*.js`.
- Unit tests: 1,797 passed, 0 failed (`npm test`).
- Smoke: 365 passed, 0 failed (`npm run smoke`).
- Windows Sandbox (offline, read-only inputs, host unchanged before/after):
  - `cb5316b` package, VM clock 23:50, `packaged-truth-smoke --local-only
    --ui-layouts`: exit 0, 0 power actions.
  - `162283a` harness on a daytime clock: the `cb5316b` package passes 42
    layouts (6 themes, 6 after-midnight); published v11.3.4 fails "midnight
    900x640 after midnight: plan facts must fit their columns".
- The packaged run of this release commit is recorded below.

## Packaged candidate of this release

Built from a clean `--no-hardlinks` clone of the release commit `a895583`
(`npm ci --ignore-scripts`, `electron:provision`, `package-native-windows.ps1`).
The commit adding this section changes documentation only: `electron/` is
identical in both commits.

- `BUILD-MANIFEST.json`: version 11.3.5, `sourceCommit` `a895583`,
  `trackedSourceDirty` false, Electron 43.8.4, 1,421 runtime files.
- `Lights-Out-Setup-v11.3.5.exe`
  `dcd5de23fb99186842d13c03e88e63929a46ac819c67209cd83a5acf0bcf9cbf`
- `Lights-Out-Portable-v11.3.5-win-x64.zip`
  `0a8a40baa65da9acd0291aadac33a01a9859fcf068d38bb2bb995e1f20c4278b`
- `sha256sum -c SHA256SUMS.txt`: both OK.
- `release-artifacts.js verify ../dist-native --release`: passed (2 artifacts,
  1,421 runtime files, source pin `a895583`).
- Windows Sandbox (offline, read-only inputs), hashes re-checked inside:
  - `packaged-truth-smoke --local-only --ui-layouts` on the portable ZIP:
    exit 0 in 137 s: 42 layouts across all 6 themes, 6 after-midnight checks
    ("12:05 AM · tomorrow"), timer start/pause/+5 min/resume/cancel, 0 power
    actions, 0 console or page errors, clean teardown.
  - `verify-windows-release.ps1` from the clean clone, as CI runs it: passed
    in 63 s: installer files matched 1,421, portable entries 1,421, installed
    runtime passed 60 settings layout checks, QA install uninstalled,
    production registration not touched.
- Host unchanged before and after: Lights Out firewall rules 0, total
  firewall rules 1,865, watchdog task present, one uninstall entry, no app
  process.

These packaged builds are local qualification candidates. CI builds and
publishes its own assets from the tag; their hashes will differ only where
the build is not deterministic (`WindowsSuspend.exe`).

## Gates run by CI on the tag

Lint & Smoke and Android on Linux; the native Windows package with its
packaged-truth checks, now including `--ui-layouts`; and the publish job's
asset-hash and source-pin checks.

## Not covered

The interactive desktop gate, physical Wi-Fi/LAN and real phone behaviour,
Family PC-to-PC pairing (not built), signing, and Android release.
