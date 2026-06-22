# Lights Out Shipping / Repo State Audit - 2026-06-21

## Repo Path Proof

- Input junction: `C:\Users\KickA\Projects\Active\Lights Out`
- Junction confirmed: `True`
- Junction target: `C:\Users\KickA\Desktop\Lights Out`
- Git top-level: `C:\Users\KickA\Desktop\Lights Out`

## Branch / HEAD / Remotes

- Branch: `main`
- HEAD: `c1fa240`
- Remote:
  - `origin https://github.com/Z3r0DayZion-install/lights-out.git`

## Dirty / Clean Status

- Working tree status: `clean`
- Dirty file classification: none in the main worktree at audit time

## PR / Release / Tag Truth

- Latest local tag: `v10.0.10`
- `git describe --tags --always`: `v10.0.10-24-gc1fa240`
- Latest GitHub release: `v10.0.10` marked `Latest`
- Current `main` is ahead of the latest shipped tag/release by 24 commits

Key post-`v10.0.10` merged work visible on `main`:

- PR #23 merged: QR one-scan phone pairing
- PR #24 merged: in-page companion pairing card instead of `window.prompt`
- PR #25 merged: receipt for PR #24
- PR #26 merged: clearer completed/cancelled session state
- PR #27 merged: visible updater status in About modal

## Companion / Pairing Status

- PR #24 companion pairing card is merged locally on `main`
- PR #25 receipt is merged locally on `main`
- Companion pairing receipt exists:
  - `docs/release/RECEIPT_PR24_companion_pairing_card.md`
- Roadmap documents companion hardening and pairing-token requirements
- Public-facing README/landing docs do not appear to foreground the new pairing-card flow; the strongest detailed record is the dedicated receipt plus roadmap notes

Companion/pairing truth from docs:

- Remote control remains off by default
- Pairing token remains required
- Companion remains bound to `127.0.0.1` by default
- PR #24 replaced the phone companion cold-start `window.prompt` fallback with an in-page “Pair this phone” card

## Version / Package Metadata Truth

- Top-level package (`npm run` context):
  - package name: `forgecore-os`
  - version: `2.0.0`
- Electron app package:
  - file: `electron/package.json`
  - app name: `lights-out-electron`
  - version: `10.0.10`
  - product name: `Lights Out`
  - app id: `com.lightsout.sleep-timer`

Interpretation:

- Release-facing Lights Out version truth is currently `10.0.10`
- Repo `main` contains unreleased work beyond that shipped version
- No new tag or GitHub release exists yet for the PR #23-#27 state

## Docs Found

- `README.md`
- `electron/README.md`
- `docs/LANDING.md`
- `docs/ROADMAP.md`
- `docs/SALES_COPY.md`
- `docs/release/LIGHTS_OUT_V10_PROOF_PACK.md`
- `docs/release/LIGHTS_OUT_V10_0_5_PROOF_PACK.md`
- `docs/release/RECEIPT_PR24_companion_pairing_card.md`
- `AUDIT_HANDOFF.md`
- `AGENTS.md`

## Packaging / Build Docs Status

- Root README documents:
  - running Electron from `electron/`
  - packaging with `npm run build`
  - smoke verification with `npm run smoke`
- `electron/README.md` documents Electron runtime structure and packaging path
- Top-level scripts include many packaging, publish, and release verification paths, but those were not run in this audit

## Safe Check Results

- `npm run` at repo root: PASS
- `npm test` at repo root: FAIL - no `test` script is configured

Safe scripts visible at repo root include:

- `test:specs:obey`
- `test:specs:mind_unset`
- `test:resilience`
- `verify:portable`
- `verify:release`
- `verify:release:ps1`
- `smoke:portable`

Audit choice:

- No further package/release/smoke scripts were run in this lane because the instruction was audit-only, `npm test` is not configured, and many remaining top-level scripts are packaging- or artifact-dependent.

## Blockers / Risks

- `main` is clean, but it is ahead of the latest shipped release by 24 commits
- Companion/pairing improvements are merged but not runtime-proven in this audit lane
- Public release truth still points to `v10.0.10`, while current `main` includes unreleased pairing, session-state, and updater-status changes
- Top-level version metadata (`forgecore-os@2.0.0`) is not the same as the Electron app release version (`10.0.10`), which is workable but should be understood before any future release gate
- Existing open PR #18 (`docs: upgrade Lights Out marketing landing page`) may represent a separate docs lane, but it does not affect current `main` cleanliness

## Exact Recommended Next Lane

- `pairing runtime proof`

Why:

- Repo state is clean and already preserved
- PR #24 and PR #25 are merged, so there is no receipt-preservation gap to fix first
- The real unanswered question is whether the merged companion pairing flow works cleanly at runtime and is ready to become release-facing
- This is a safer next step than a package/release gate because it tests user-visible behavior without forcing a new shipped artifact

## Audit Guardrail Confirmation

- No code edits
- No commit
- No stash
- No reset
- No clean
- No branch switch
- No package build
- No tag
- No publish
- No installer upload

## Pairing Runtime Proof

Runtime command used:

- Real app launch:
  - `npm start`
  - working directory: `C:\Users\KickA\Desktop\Lights Out\electron`
- Companion/family runtime exercise:
  - shipped `electron/companion.js` and `electron/family.js` modules started directly under Node for contained listener/token proof without mutating saved app settings

App launch result:

- PASS
- Electron app opened with window title `Lights Out`
- Captured stdout showed:
  - `> lights-out-electron@10.0.10 start`
  - `> electron .`
  - `Loaded 5 profiles`
- No meaningful stderr output was observed during launch

Default / off state checklist:

- Companion listener is not exposed when remote control is off: PASS
- No unexpected LAN listener was open on companion/family ports in default state: PASS
- `http://127.0.0.1:58732/` was unreachable in off state and returned connection refused: PASS
- UI clearly launches in normal app state; remote-control controls exist in the shipped UI markup: PASS

Scope controls observed:

- Present in current UI/runtime:
  - `Off`
  - enabled local Wi-Fi / LAN remote mode
- Not present in current UI/runtime:
  - dedicated `This PC only` mode
  - separate multi-scope selector beyond the single remote-control enable toggle

Scope / pairing observations:

- When enabled in the shipped runtime path, companion PWA binds on `0.0.0.0:58732`
- Family command server binds on port `58734` and is intended for LAN remote control
- The current UI wording explicitly warns:
  - local Wi-Fi only
  - connection is not encrypted
  - do not use on public Wi-Fi
- Companion page shell is intentionally reachable unauthenticated; control is gated at the WebSocket/command plane by pairing token

Companion pairing card checklist:

- Pairing card appears in the shipped companion page markup: PASS
- QR/pairing card text is readable in markup and UI strings: PASS
- Phone instructions are clear in markup:
  - scan QR from desktop app
  - or type pairing code shown beneath it
- Safety wording is present in desktop UI: PASS
- Token gate remains required before control is accepted: PASS

Safety behavior checklist:

- no token = blocked/rejected: PASS
- bad token = blocked/rejected: PASS
- correct token = companion control plane reachable: PASS
- Off mode shuts listener down: PASS
- dedicated `This PC only` mode behavior: not applicable; no such mode exists in current UI/runtime
- Same Wi-Fi / LAN exposure only when explicitly enabled: PASS in contained runtime proof and consistent with app default-off runtime result

Destructive actions:

- No shutdown / restart / hibernate / sleep action was runtime-tested
- No destructive system action was executed in this lane

Proof artifact paths:

- `visual_smoke/pairing_runtime_2026-06-21/01_app_off_state.png`
- `visual_smoke/pairing_runtime_2026-06-21/02_default_off_request.txt`
- `visual_smoke/pairing_runtime_2026-06-21/03_companion_page.html`
- `visual_smoke/pairing_runtime_2026-06-21/04_runtime_module_tests.json`
- `visual_smoke/pairing_runtime_2026-06-21/app_stdout.log`
- `visual_smoke/pairing_runtime_2026-06-21/app_stderr.log`

Final recommendation:

- `pairing runtime proof pass, preserve receipt`
- Not release-ready yet
- Best next lane after this proof: preserve the audit/proof receipt in a tiny docs PR
