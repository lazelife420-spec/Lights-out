# v11.3.0 release qualification

v11.3.0 is a production-audit release. This record states what was checked,
how, and what remains outside automated qualification. It does not claim the
release is published: that happens only when CI publishes the `v11.3.0` GitHub
release after its own gates pass.

## How the audit was run

1. Eight independent review areas over the uncommitted release candidate:
   power actions and safe defaults; network trust boundaries; renderer, preload
   and IPC; Android; packaging, installer and CI; desktop feature logic;
   credentials and persistence; user-facing documentation.
2. Every finding was handed to one or two skeptics instructed to refute it from
   the code (a code-trace lens and a shipped-configuration lens). Findings that
   survived were fixed with a regression test that fails without the fix.
3. Each area's fixes were reviewed again by a fresh reviewer, and that review's
   findings were fixed in a second (and, where needed, third) round until each
   area was marked ship-ready.

## Automated gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors, 0 warnings.
- `node --check` on every `electron/*.js` and `electron/scripts/*.js` file.
- Unit tests: 1,581 passed, 0 failed (`npm test`).
- Smoke checks: 359 passed, 0 failed (`npm run smoke`).
- The unit suite also passed on a CRLF checkout of the tree, matching the Windows
  CI runner's `core.autocrlf=true` (two asset-copy differences aside).
- `npm audit`: 0 vulnerabilities.
- Android (isolated per AGENTS.md: source copied to a temporary project, isolated
  Android/Gradle homes, no signing material): 138 JUnit tests passed, lint passed,
  debug APK built. No emulator or physical device was used.

## Packaged Windows qualification

Recorded after the local build from the release commit; CI repeats the
unattended packaged lane, installer and portable verification, and clean
provenance on the tagged commit before it publishes anything.

## Not established by automated tests

- Physical sleep, hibernate, shutdown and resume. Every receipt states the
  Windows outcome as unverified; the native Sleep/Hibernate helper is exercised
  only through fakes and intercepted requests.
- Real router and Wi-Fi adapter behaviour, including the new Wi-Fi Guard
  recovery record (unit-tested only). Wi-Fi Guard stays opt-in and experimental.
- Real Philips Hue bridges and HTTP light webhooks, more than one WiZ bulb, a
  bulb going offline mid-run, phones, OEM battery management and overnight
  unattended runs. (One real WiZ bulb is covered below.)
- Android on a real phone: First Light wake under Doze, reboot before first
  unlock, edge-to-edge layout on API 35/36 devices, and 16 KB page-size
  compliance. No production-signed APK ships with this release.
- The interactive Windows desktop gate (`npm run test:e2e:desktop`) needs an
  unlocked, hands-off desktop session and is run by the owner.

## Real WiZ bulb on the owner's network (2026-11-26)

With the owner's approval, one WiZ full-colour bulb (module ESP01_SHRGB1C_31,
firmware 1.35.0) was driven through the packaged build, whose lights code
(`smartLights.js`, `wizLights.js`, `lightExperience.js`, `main.js`) is
byte-identical to the release commit. Each run used a throwaway profile with
the QA power lock on. The bulb's state was read independently after every step
and restored to its original setting at the end.

Passed on the real bulb:

- Discovery, Verify (no change to the bulb) and the test button (exact colour
  and brightness).
- Gradual dim, warm dim, and the white, scene and colour starting looks.
- Hourglass, Orbit and Ember.
- Off at end, and the finish beacon (pulses in the last 6 s), then off.
- Cancel restores the light. A light switched off mid-run, as a phone app
  would, stays off, and cancel never turns it back on.
- Test Mode leaves the lights alone (by design; the Devices card says so).
- The guided ritual's night scene (19%, 2200K). Cancelling the ritual's
  countdown leaves that scene in place.
- First Light: a sunrise from 10% at 2200K to 100% at 4000K over 60 s.

Runs that had to finish used the Lock action. The QA power lock blocked each
one and recorded it as `blocked`.

Found and fixed during this test: First Light never started when the wake task
launched Lights Out. It played only if the app was already running. Electron
43 still reports the page as loading inside `did-finish-load`, so the request
made at launch was never delivered. This came from this release's
claim-before-sunrise change and never shipped. Requests are now delivered at
`did-stop-loading`, covered by `test/first-light-cold-launch.test.js`, and the
fix was re-verified on the bulb from source with the wake task's exact
arguments.

`npm run test:wiz-runtime` (packaged build, simulated loopback bulbs) now
checks both halves: Test Mode leaves the lights alone, and a real run dims
them.

## Owner host acceptance (interactive desktop gate)

Status: **HOLD** until the owner runs the gate below on this PC. This is not a
failure: the gate needs an unlocked desktop and the real mouse and keyboard,
which no unattended lane can use.

### What each lane proves

| Lane | Proves | Does not prove |
| --- | --- | --- |
| Installer QA (`verify-windows-release.ps1`, `LIGHTS_OUT_INSTALLER_QA=1`) | Install into an isolated folder, file layout, per-user uninstall entry, clean uninstall, no watchdog task or login item created | Upgrading the owner's installed copy or real profile |
| `npm run test:packaged-local` | Packaged IPC, navigation, Test Mode timer controls, occupied-port recovery on loopback, existing firewall rules unchanged | Same-Wi-Fi mode and firewall rule creation (the full lane, run in CI) |
| `node scripts/night-modes-electron-proof.js` | Night Modes run to a Dry Run receipt in an in-process isolated profile, with an accelerated proof clock | Real-time or overnight behaviour |
| `packaged-truth-smoke` (full, CI on the tag) | Same-Wi-Fi endpoint, owned firewall rules created and removed, other rules unchanged | Real desktop input |
| `npm run test:e2e:desktop` (owner) | Real foreground custody, native input reaching the real window, top menus, shared Start, two Night Modes with restart, active-run focus, Test Mode visible, zero real power requests | Physical power, real lights or router, overnight runs |

### Safety barrier during the gate

`--desktop-ux-proof` turns on the QA power lock: every power request is
recorded and blocked with a `blocked` receipt, and the watchdog task and
login item are never created or deleted. It also suppresses the tray. The gate
fails if any real power request is recorded.

The lock is inside the app, not an OS-level barrier, and it covers power, the
watchdog task and the login item only. Night Light, media pause, focus mode,
Wi-Fi Guard, the content blocker, smart lights and the phone connection are
inert because the gate starts from a fresh profile that contains only
`app: { dryRun: true, onboarded: true }`, and all of those default to off.

### Owner checklist

Before:

1. Use the build being released: its ZIP and installer hashes match
   `SHA256SUMS.txt`, and `BUILD-MANIFEST.json` names the release commit with a
   clean tree.
2. No real run is armed on the installed copy, and no autopilot fire is due
   within the next hour. The installed copy may stay open: the gate uses its own
   profile and its own single-instance lock.
3. The desktop is unlocked and awake, with no full-screen app or remote session,
   and nobody touches the mouse or keyboard for the whole run.
4. Record file metadata (not contents) of the real profile:

   ```powershell
   Get-ChildItem "$env:APPDATA\lights-out-electron" -File | Select-Object Name, Length, LastWriteTimeUtc
   ```

Run, from `electron\`:

5. Source runtime: `npm run test:e2e:desktop`
6. Packaged build:

   ```powershell
   $env:LIGHTS_OUT_DESKTOP_EXE = (Resolve-Path '..\dist-native\win-unpacked\Lights Out.exe').Path; npm run test:e2e:desktop
   ```

After:

7. Each run exits 0 and prints its root folder
   (`%TEMP%\lightsout-desktop-ux-gate-*`). Keep its `report.json`,
   `screenshot-manifest.json` and screenshots as the receipt.
8. In `report.json`: no real power requests, every receipt has `dryRun: true`
   and `powerActionAttempted: false`, and owned cleanup is verified.
9. The profile metadata from step 4 is unchanged, the
   `LightsOut-AutopilotWatchdog` task (`schtasks /Query /TN LightsOut-AutopilotWatchdog`)
   and the Run-at-login value are as they were, and no gate process is left.

Stop and record `HOLD` if: a real run is armed, the hashes or commit do not
match, the gate reports `INTERACTIVE_DESKTOP_REQUIRED`, any real power request
or real-profile change appears, or cleanup is not verified. A green gate does
not qualify physical power actions, real lights or routers, overnight
reliability, signing or publication.

## Upgrade custody: installed v11.2.0 to v11.3.0

Status: **STAGE_ONLY** until the final build passes the gates above; then ready
for a separate owner decision to upgrade the installed copy. Established from
the code only: no installed copy or real profile was opened or launched.

What v11.3.0 rewrites in `%APPDATA%\lights-out-electron` on first launch:

- `settings.json`: 11 credential fields that v11.2.0 stored as plain text are
  saved as Windows-protected (`enc:v1:`) values: the Wi-Fi Guard router user,
  webhook URL and headers; the calendar iCal URL; the smart-lights HTTP URL,
  body and headers; and accountability partner URLs, webhooks, tokens and
  headers. Retired smart-light provider keys are dropped, a legacy single
  schedule is migrated, and old profile ids are normalized with their
  references updated.
- `settings.json.bak` is rebuilt from the previous file with the same
  protection, so after the first save neither file is readable by v11.2.0 for
  those fields. When an old smart-lights verification key held the Hue key or
  webhook in plain text, the backup is replaced outright so that text leaves
  the disk.
- `run-receipts.json`: receipts left in flight by a crash are closed as
  `interrupted` or `outcome_unverified`; new receipts can be `missed` or
  `blocked`. The 100-receipt limit is unchanged.

Rolling back to v11.2.0 keeps timers, schedules, profiles and receipts (new
result names show as raw text), but v11.2.0 decrypts only its original 7
fields: the 11 fields above read as `enc:v1:` text, so iCal sync, HTTP
lights, Wi-Fi Guard router login and partner webhooks fail until re-entered.
No pre-upgrade copy survives on disk, so take one first. Run these yourself,
with Lights Out quit from the tray and no run armed:

```powershell
$dest = Join-Path $env:LOCALAPPDATA "LightsOut-backups\v11.2.0-$(Get-Date -Format yyyyMMdd-HHmm)"; Copy-Item "$env:APPDATA\lights-out-electron" $dest -Recurse; Get-ChildItem $dest -File | Get-FileHash | Select-Object Hash, Path
```

The copy restores only on this Windows account (protected values are bound to
it) and may hold legacy plain-text credentials, so keep it out of synced
folders and delete it once v11.3.0 has run well. To roll back: quit Lights
Out, install v11.2.0, replace the profile folder with the copy, then start it.
The portable ZIP is unaffected: each extracted version keeps its own
`user-data` folder and never reads another's.

## Known limits carried into this release

- Moving back to v11.2.0 cannot decrypt the newly protected integration
  credentials; re-enter them there.
- The suspend helper is compiled at build time without a deterministic
  compiler, so two builds of the same commit have different installer and ZIP
  hashes. Each build's own BUILD-MANIFEST.json and SHA256SUMS.txt are exact; the
  Proof Foundry kit must be built from the published release's files.
- Secure device pairing (handoff) ships in source and is gated off.
- The live Proof Foundry release record links GitHub Releases; installed v11.3
  apps download in-app updates only from `downloads.theprooffoundry.com`. See
  `electron/scripts/build-proof-foundry-kit.js` and the kit's `UPLOAD.md`.
