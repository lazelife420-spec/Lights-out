# Lights Out POST-v11.1.2 Gate 1 / Phase B Remediation Report

Date: 2026-08-23  
Execution branch: `codex/post-v11.1.2-phase-b`  
Published product tag/candidate: `v11.1.2` / `9c791cf8e6f26dd145b6e29e4886d7f210b49377`  
Frozen public ZIP: `Lights-Out-Portable-v11.1.2-win-x64.zip`  
Frozen public ZIP SHA-256: `525FF7A28CAF7EB590F5504ABFFB8B5B49E864DED2A5A5482D8D3A7367755B28`

## Disposition

Phase B repaired every locally repairable reproduced defect in scope. One P0 distribution condition remains outside repository/release configuration: GitHub does not resolve the publisher account to anonymous users, so its public-looking repository, release, APIs, and frozen asset all remain anonymous HTTP 404. No destructive repository toggle or release recreation was attempted.

**POST-v11.1.2 GATE 1 / PHASE B — PARTIAL / EXTERNAL BLOCKER — GITHUB ACCOUNT-LEVEL VISIBILITY ENFORCEMENT KEEPS THE OWNER, REPOSITORY, RELEASE, AND FROZEN ZIP ANONYMOUS-404**

## Identity and immutable-release boundary

| Identity | Commit | Tree | Meaning |
|---|---|---|---|
| Frozen published candidate | `9c791cf8e6f26dd145b6e29e4886d7f210b49377` | `b52800e78c3764fc4c766377d085cffdbc9339c8` | Immutable v11.1.2 product/tag source |
| Phase B product/test head | `f9477f3069b79b52483c4b6f1f265e2e1e03b9fa` | `dbd607bb7e6a3ae0ca5f4f269e3f9b3f841c1471` | Post-release repair lineage; not tagged or published |
| Phase B evidence input head | `2bb999e34994241e56c2729304ac1bae47ee8112` | `c126c0f212d790d3c6fb5f7d79eb8895873f11b0` | Additive runtime evidence; not product/tag source |

The workspace was initially observed on receipt-only head `64c3042096d86d98c8f9a78c5723da607c4ff059`. The repair branch was intentionally created from frozen candidate `9c791cf8...`, not from later receipt-only release heads. Phase A evidence was then preserved unchanged in additive commit `3e09f92`.

The frozen asset was re-downloaded through the authenticated control plane before repair and re-hashed exactly as `525FF7A2...5B28`. It was not edited, replaced, re-uploaded, rebuilt as a release, or republished. The local regression build produced a clearly separate, unpublished repair-proof ZIP with SHA-256 `D49131E89C48675667BEAE53019DA3A7A7B51191F7F9564860783F76F94154AD`; it is not the frozen v11.1.2 artifact and must not be substituted for it.

The repair-proof package identity is recorded in `electron/docs/proof/v11.1.2/post-release-gate1-phase-b/phase-b-artifact-manifest.json`:

- launcher: `2A630319C42CC33074B10EEBADBCDFEECCA13FA1EEFCAE746442ED52693E5E87`;
- application content: `61C372909FAB198BA0C8D925027E9078C8A78D6F60EDDAF2CF12319643961B83` (499 files);
- Authenticode: `NotSigned`;
- prohibited package paths: 0;
- secret-pattern hits: 0;
- developer-home path hits: 0.

## Findings F-01 through F-09

### F-01 — public GitHub access

- **Original reproduction:** repository page/API, v11.1.2 release page, latest-release API, and exact frozen ZIP all returned anonymous HTTP 404 while authenticated metadata described a public, enabled, unarchived repository and a published, non-draft latest release.
- **Root cause:** the owner endpoint `/users/lazelife420-spec` returns 404 even to the authenticated owner token. Repository and release settings are healthy inside the owner control plane. The failure boundary is therefore the publisher account's public resolution—consistent with GitHub account/platform visibility enforcement—not a safe repository or release toggle.
- **Action/blocker:** no public/private toggle, release deletion/recreation, tag change, or artifact replacement was attempted. Exact escalation evidence is in `b1-f01-external-platform-blocker.md` and signed-out screenshots.
- **Files/settings:** evidence only; GitHub settings changed: none.
- **Commit:** `96f4ee1`.
- **Focused proof:** authenticated owner/repo/release/asset metadata versus genuinely signed-out browser and anonymous API/asset requests.
- **Regression proof:** frozen authenticated asset re-hashed exactly; owner-side release metadata and digest remained intact.
- **Current external result:** anonymous owner, repository, release, API, and asset remain 404.
- **Residual risk:** outside users cannot discover or download v11.1.2 until GitHub restores the account's public resolution. GitHub support/appeal is required.
- **Final classification:** `F-01 — EXTERNAL PLATFORM BLOCKER`.

### F-02 — updater discovery

- **Original reproduction:** actual v11.1.0 and v11.1.2 binaries reported GitHub HTTP 404 and could not discover the current release.
- **Root cause:** the updater's anonymous GitHub API dependency inherits F-01's account-level 404. The old published v11.1.0 binary also cannot receive the new resolver code retroactively.
- **Remediation/blocker:** the repair lineage now reports HTTP/API/malformed-metadata failures explicitly and does not conceal them behind a fabricated download. Actual anonymous discovery remains blocked by F-01.
- **Changed files:** `electron/updater.js`, `electron/updaterPolicy.js`, `electron/preload.js`, `electron/renderer-onboarding-updater.js`, `electron/renderer.js`, tests and smoke contracts.
- **Commit:** `74bd850`.
- **Focused proof:** 12/12 updater-policy tests cover API unavailability and malformed metadata as well as the portable contract.
- **Regression proof:** 325/325 unit; 320/320 smoke; packaged/runtime gates green.
- **Current external result:** published v11.1.0 → current still returns 404 because the external endpoint remains hidden. The repair lineage fails honestly but cannot make GitHub's anonymous API resolve.
- **Residual risk:** update discovery is unavailable until F-01 is lifted; existing published binaries remain unchanged.
- **Final classification:** `F-02 — EXTERNAL BLOCKER; CLIENT FAILURE REPORTING REMEDIATED FOR A FUTURE PATCH`.

### F-03 — updater asset selection and integrity

- **Original reproduction:** valid authenticated v11.1.2 release JSON caused the old resolver to invent `Lights.Out.Setup.11.1.2.exe`, a nonexistent installer with no integrity contract.
- **Root cause:** installer-oriented filename/fallback assumptions contradicted the authoritative portable-ZIP distribution model.
- **Remediation:** the resolver requires the exact `Lights-Out-Portable-vX.Y.Z-win-x64.zip` asset and a GitHub `sha256:<64hex>` digest. Downloaded bytes are hashed before a non-overwriting file is placed in Downloads. The app reveals the verified ZIP and gives manual close/extract/run guidance; it never executes the ZIP or overwrites the running installation.
- **Changed files:** `electron/updaterPolicy.js`, `electron/updater.js`, `electron/preload.js`, `electron/renderer-onboarding-updater.js`, `electron/renderer.js`, `electron/package.json`, `electron/test/updaterPolicy.test.js`, `electron/scripts/smoke.js`.
- **Commit:** `74bd850`.
- **Focused proof:** 12/12 cases: current/latest, older/latest, API unavailable, malformed JSON, missing ZIP, wrong name, missing/malformed integrity, digest mismatch, valid bytes, no installer fallback, and installer-only rejection.
- **Regression proof:** full unit/smoke/package matrix below.
- **Current external result:** correct behavior is ready in the post-release repair lineage; live discovery remains gated by F-01.
- **Residual risk:** automatic in-place replacement was deliberately not invented; update installation remains a manual portable workflow.
- **Final classification:** `F-03 — REMEDIATED`.

### F-04 — public product truth

- **Original reproduction:** live homepage/product/Proof pages described Lights Out as testing, unreleased, coming soon, versionless, and without an artifact.
- **Root cause:** site manifest and product copy predated the published v11.1.2 release and did not model a published artifact whose external access later became blocked.
- **Remediation:** local site source now records v11.1.2, Android companion 11.1.1, separate 313-unit/318-smoke counts, frozen filename/hash, unsigned portable distribution, and the exact anonymous-access blocker. It presents no working download CTA while access is 404.
- **Changed files/settings:** in separate site repository: `lights-out.html`, `site-manifest.json`, `scripts/build-site.ps1`; deployed settings: none.
- **Commit:** proof-foundry-site `ddb4ea4d480dafe11656ac8ba4ad5870f3b28ee2` on `codex/lights-out-phase-b-truth`.
- **Focused proof:** site build validated 6 products with 0 manifest errors; local `/`, `/lights-out/`, and `/proof/` output contains the corrected version/proof state. Screenshot: `b4-local-site-release-truth.png`.
- **Regression proof:** all 16 Lights Out page assets requested by the local browser returned 200; the existing missing favicon remains unrelated and was not reopened.
- **Current external result:** the live site remains unchanged because this tranche expressly prohibited deployment/publication. Corrected local source is ready for a separately authorized site deployment after review.
- **Residual risk:** public visitors continue to see stale copy until that deployment is authorized; even after deployment, download must remain disabled until F-01 clears.
- **Final classification:** `F-04 — REMEDIATED LOCALLY / DEPLOYMENT INTENTIONALLY NOT AUTHORIZED`.

### F-05 — duplicate authenticated remote start

- **Original reproduction:** with about 597 seconds left, a second authenticated generic `start` for 60 seconds created another receipt and reset the published desktop countdown to 60.
- **Root cause:** the authoritative main-process generic remote-start handler delegated directly into start semantics without first rejecting running, paused, or ritual-active state.
- **Remediation:** the desktop rejects ordinary duplicate remote starts with structured `commandResult { action: "start", success: false, code: "RUN_ACTIVE" }`, includes the current state, preserves the run/countdown/receipt, and surfaces truthful phone UI feedback. No replacement semantic was added.
- **Changed files:** `electron/main.js`, `electron/companion.html`, `electron/scripts/companion-v2-electron-proof.js`, `electron/scripts/smoke.js`, `electron/scripts/packaged-phone-smoke.js`.
- **Commits:** `92dba1f`, `77f5f86`, `f9477f3`.
- **Focused proof:** direct authenticated raw-WebSocket runtime proof bypassed hidden UI; physical S23 proof also attempted the duplicate while a run was active. Both received `RUN_ACTIVE`; remaining time stayed above 500 seconds and receipt count did not change.
- **Regression proof:** companion runtime 89/89; physical Pause/Resume/+5/Cancel, Wi-Fi recovery, wrapper restart, and no-replay lanes passed; real power actions 0.
- **Current external result:** fixed in the post-release repair lineage; immutable published v11.1.2 remains unchanged.
- **Residual risk:** the old public artifact retains the reproduced behavior until a separately authorized patch release is built and published.
- **Final classification:** `F-05 — REMEDIATED`.

### F-06 — portable extraction/startup guidance

- **Original reproduction:** the frozen ZIP extracts 573 files at its root and contains no quick-start/shortcut/update guidance.
- **Root cause:** the published portable package relied on implicit Windows ZIP behavior and offered no public operating instructions.
- **Remediation:** without changing the frozen ZIP, local website source now instructs users to verify the frozen hash, extract the ZIP into its own folder, launch `Lights Out.exe` from that extracted folder, never run inside the ZIP, expect possible SmartScreen/Unknown Publisher warnings, and use the repaired updater's verified/manual ZIP workflow in a future patch.
- **Changed files:** proof-foundry-site `lights-out.html`, `site-manifest.json`.
- **Commit:** proof-foundry-site `ddb4ea4`.
- **Focused proof:** local built Download section visibly contains each required instruction and no enabled download link.
- **Regression proof:** site manifest/build pass.
- **Current external result:** guidance is locally ready but not deployed; frozen v11.1.2 package unchanged.
- **Residual risk:** root-folder packaging ergonomics can only change in a future artifact and were not smuggled into this release.
- **Final classification:** `F-06 — REMEDIATED LOCALLY WITH NON-ARTIFACT GUIDANCE`.

### F-07 — Night Modes availability claim

- **Original reproduction:** public copy said “six preset endings” although only four modes execute; Quiet House and School Night are disabled.
- **Root cause:** catalogue size was presented as executable availability.
- **Remediation:** copy now describes a six-mode catalogue with four executable endings, Quiet House coming soon, and School Night setup-dependent/unavailable.
- **Changed file:** proof-foundry-site `lights-out.html`.
- **Commit:** proof-foundry-site `ddb4ea4`.
- **Focused proof:** local DOM/browser proof contains the exact qualified caption.
- **Regression proof:** Night Modes Electron runtime 8/8 preserves four ready/two unavailable semantics.
- **Current external result:** corrected locally, not deployed under this tranche.
- **Residual risk:** stale live text persists until site deployment authorization.
- **Final classification:** `F-07 — REMEDIATED LOCALLY / DEPLOYMENT INTENTIONALLY NOT AUTHORIZED`.

### F-08 — First Light task-lifecycle claim

- **Original reproduction:** site claimed the one-shot wake task removes itself after firing; source provided no such post-fire deletion proof.
- **Root cause:** marketing copy exceeded implementation evidence.
- **Remediation:** the claim now states only source-backed lifecycle behavior: setting First Light replaces the previous one-time wake task; choosing Remove deletes it. No wake task was created or executed to make copy true.
- **Changed file:** proof-foundry-site `lights-out.html`.
- **Commit:** proof-foundry-site `ddb4ea4`.
- **Focused proof:** local DOM/browser proof contains the corrected statement.
- **Regression proof:** site build passes; existing app First Light contracts remain untouched.
- **Current external result:** corrected locally, not deployed under this tranche.
- **Residual risk:** stale live text persists until site deployment authorization.
- **Final classification:** `F-08 — REMEDIATED LOCALLY / DEPLOYMENT INTENTIONALLY NOT AUTHORIZED`.

### F-09 — Android reconnect blank state

- **Original reproduction:** relaunching Android 11.1.1 with an offline saved endpoint showed a blank/black WebView during bounded retry, then correctly fell back to setup.
- **Root cause:** `showWeb()` made the WebView visible before main-frame success and had no native loading surface.
- **Remediation:** a native Lights Out reconnect surface is visible throughout initial load and subnet recovery, with truthful status, progress, and a “Use another link” escape. The WebView appears only after successful main-frame completion. The existing eight-second main-frame timeout, bounded subnet recovery, eventual setup fallback, saved pairing, authentication, redaction, and no-replay semantics remain intact.
- **Changed files:** `companion-android/app/src/main/java/com/lightsout/companion/MainActivity.kt`, `res/layout/activity_main.xml`, `res/values/strings.xml`, and a debug-only application ID suffix in `app/build.gradle` for safe side-by-side device proof.
- **Commit:** `2848a87`.
- **Focused proof:** Android `testDebugUnitTest` and `assembleDebug` passed. Connected S23 captured the reconnect surface, timed out to setup, then completed authenticated packaged-desktop connection, Wi-Fi recovery, and wrapper restart recovery.
- **Regression proof:** production companion signing identity/data were not touched; the debug proof package was removed afterward; release keystore touched: no.
- **Current external result:** fixed in the post-release repair lineage; published Android 11.1.1 remains unchanged.
- **Residual risk:** actual camera QR ergonomics remain F-20/deferred and were not claimed.
- **Final classification:** `F-09 — REMEDIATED`.

## Final regression and safety matrix

| Lane | Result |
|---|---|
| Syntax (changed entry points/modules/proof scripts) | PASS |
| ESLint | PASS: 0 errors, 1 pre-existing warning (`performance-resize-gate.js` unused `routeNames`) |
| Unit | 325/325 |
| Static smoke | 320/320 |
| Updater focused policy | 12/12 (included in unit total) |
| Android unit + debug assembly | BUILD SUCCESSFUL |
| Packaged smoke | 12/12 |
| Packaged truth | PASS; menu contract, firewall ownership/cleanup, routes, zero starts/power actions |
| Native packaged truth | 5/5 |
| Packaged network | PASS; connected/disconnected adapter truth, local/Wi-Fi/off modes, listener/firewall cleanup |
| Companion V2 Electron | 89/89; 27 commands; real power actions 0 |
| Physical S23 packaged companion | PASS; authenticated connection, `RUN_ACTIVE`, Pause/Resume/+5/Cancel, Wi-Fi/restart recovery |
| Receipt recovery | 13/13; real power actions 0 |
| Night Modes runtime | 8/8; Dry Run completion; real power actions 0 |
| Reliability/crash policy | PASS; renderer reload, timer persistence, main-exception survival |
| Window geometry | PASS |
| Performance/resize | six routes at 0% jank; max delta 10.3 ms; heap growth 0; DOM growth 0 |
| Package content/security audit | PASS; no prohibited paths, secret patterns, or developer-home paths |
| Local Proof Foundry build | PASS; 6 products, 0 manifest errors; no deployment |

Real shutdown, restart, sleep, hibernate, and logout actions executed: **0**.

## F-19 and F-20 boundaries

- **F-19 SmartScreen:** no follow-up was possible because F-01 did not enable a genuinely anonymous browser asset download. It remains observational/deferred; no defect status was invented.
- **F-20 camera QR:** remains deferred. The physical lane used the documented manual URL fallback and does not claim a camera scan.

## Cleanup and mutation receipt

- phase-owned Lights Out/Electron processes: 0;
- phase-owned listeners on 58731/58732/58733/58741: 0;
- app-owned companion firewall rules: 0;
- ADB forwards: 0;
- debug S23 proof package: removed from Android user 0;
- phase-owned device screenshots/XML: removed after local evidence capture;
- identified Phase B temp extraction/proof/profile roots: removed;
- production Android companion, pairing data, and release keystore: untouched;
- unrelated pre-existing untracked root files: untouched;
- website's unrelated pre-existing dirty files/hunks: preserved and unstaged;
- push: **NO**;
- merge: **NO**;
- new tag: **NO**;
- new release: **NO**;
- version bump: **NO**;
- signing change: **NO**;
- website deploy: **NO**;
- v11.1.2 tag/public artifact mutation: **NO**.

## Bounded commit ledger

Main Lights Out repository:

1. `3e09f92` — preserve Phase A field evidence on the candidate-based repair branch.
2. `96f4ee1` — classify F-01 GitHub visibility blocker.
3. `92dba1f` — reject duplicate remote starts.
4. `74bd850` — support verified portable-ZIP releases.
5. `2848a87` — show bounded Android reconnect state.
6. `77f5f86` — prove physical duplicate-start rejection.
7. `f9477f3` — make physical proof LAN-address-agnostic.
8. `2bb999e` — record Phase B runtime/package/site evidence.

Separate Proof Foundry site repository:

1. `ddb4ea4` — publish accurate Lights Out release status in local site source (not deployed).

## Required next boundary

Do not publish the repair-proof ZIP or mutate v11.1.2. The next legitimate actions are external GitHub account visibility escalation and, separately, review/authorization for deploying the already-committed website truth. A patch-release decision can be made only after assigning a new version/artifact identity and re-running the release gate from the repaired product head.
