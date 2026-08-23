# Lights Out POST-v11.1.2 Gate 1 / Phase A Field Verification Report

Date: 2026-08-23  
Mode: observational/evidence-only; no remediation authorized or performed  
Starting and final repository HEAD: `64c3042096d86d98c8f9a78c5723da607c4ff059` (local receipt-only evidence head)  
Published product tag/candidate: `v11.1.2` / `9c791cf8e6f26dd145b6e29e4886d7f210b49377`  
Frozen product tree: `b52800e78c3764fc4c766377d085cffdbc9339c8`  

## Executive disposition

Phase A completed every executable lane, including the physical Samsung S23 lane after the device became available. The frozen ZIP and packaged application remain bit-identical to the release receipts, launch correctly from a fresh profile, persist onboarding, survive relaunch, pass the packaged runtime gate, and execute Dry Run and physical companion controls with zero real power actions.

Phase A also reproduced four material current problems:

1. Anonymous users receive HTTP 404 for the release page, release API, and actual ZIP asset even though authenticated GitHub control-plane metadata describes the repository as public and the release as published/latest.
2. The updater in both v11.1.0 and v11.1.2 reports HTTP 404; even when supplied the authenticated release JSON, its installer-oriented fallback selects a nonexistent `.exe` instead of the sole portable ZIP.
3. The live Proof Foundry pages still describe Lights Out as unreleased/in testing and provide no public release/download CTA.
4. An authenticated phone client can send a duplicate generic start while a timer is active; the published desktop accepts it, creates a new receipt, and resets the active countdown to 60 seconds.

These findings were observed and classified only. Nothing was repaired.

## Environments and evidence boundary

- Desktop: `VIP-SHADOW-NODE`, Microsoft Windows 10 Pro 10.0.19045, PowerShell 7.6.4, Node v22.23.1.
- Public packaged runtime: the extracted frozen v11.1.2 ZIP, never the repository build.
- First-launch and updater runs: unique temporary `--user-data-dir` profiles; all removed after capture.
- Website: live `https://theprooffoundry.com/`, `https://theprooffoundry.com/lights-out/`, and `https://theprooffoundry.com/proof/` in the signed-out in-app browser.
- GitHub anonymous checks: signed-out browser plus unauthenticated HTTP requests.
- GitHub control-plane comparison: authenticated `gh` metadata, used only to establish the release that the owner sees.
- Physical device: Samsung Galaxy S23 `SM-S911W`, Android 16, build fingerprint `samsung/dm1qcsx/dm1q:16/BP4A.251205.006/S911WVLS8FZG1:user/release-keys`, Android System WebView 151.0.7922.169.
- Android package: `com.lightsout.companion`, versionName 11.1.1, versionCode 2, targetSdk 34, APK signature scheme v2.
- No v11.1.2 rebuild, repack, source substitution, installer, signing change, tag, release, push, or publication occurred.

## 1. Public artifact provenance and identity

Authenticated release metadata identifies the sole v11.1.2 asset as `Lights-Out-Portable-v11.1.2-win-x64.zip`. This was necessary because the same asset is anonymous-HTTP 404; therefore the acquisition was not a successful stranger/public download and is not represented as one.

| Identity | Observed value | Frozen receipt | Result |
|---|---:|---:|---|
| ZIP filename | `Lights-Out-Portable-v11.1.2-win-x64.zip` | same | exact |
| ZIP bytes | 153,940,180 | 153,940,180 | exact |
| ZIP SHA-256 | `525FF7A28CAF7EB590F5504ABFFB8B5B49E864DED2A5A5482D8D3A7367755B28` | same | exact |
| Extracted launcher SHA-256 | `2A630319C42CC33074B10EEBADBCDFEECCA13FA1EEFCAE746442ED52693E5E87` | same | exact |
| Packaged app-content SHA-256 | `73B11804C54F101781D48B2BFC1516187DF6164242D45844CA874A60D9FD894F` | same | exact |
| Extracted packaged-app files | 498 | Gate 7 receipt | exact |
| Total extracted files | 573 | observation | complete extraction |
| Authenticode | `NotSigned` | accepted Gate 8B state | unchanged |

The ZIP extracts and launches without missing-module, `undefined`, or `null` error surfaces. It expands directly into 573 runtime files rather than a containing product folder and includes no README, quick-start, install, shortcut, or update guidance; only license files accompany the runtime at the root.

Because the ZIP was acquired through authenticated GitHub CLI, it had no browser-origin `Zone.Identifier`. No SmartScreen or Unknown Publisher prompt appeared. The browser-acquisition path could not be observed because the anonymous asset URL returned 404. The unsigned state is proven; browser-delivered SmartScreen behavior is not fabricated.

## 2. Fresh-profile external-user walkthrough

The exact extracted public launcher was started with a genuinely fresh isolated profile.

- First window ready: 443 ms.
- Genuine first surface: onboarding, heading `When do you go to bed?`, version `v11.1.2`.
- Onboarding completed with 10 PM, no focus-block apps, Classic Fade, sound off.
- Post-onboarding surface: Home, idle, no automatic timer, no real power action.
- Navigation exercised: Home, Tonight, Library, Schedule, Devices, Proof, Settings, Help; every Settings category; First Light; proof history/activity; constrained layouts; Help/About; armed and running Dry Run.
- Relaunch ready: 429 ms.
- Onboarding remained dismissed and chosen settings persisted.
- `runAtLogin` remained false; displayed startup behavior remained `Starts minimized and idle`.
- Console errors: 0. Page errors: 0. Runtime observer errors/events: 0.
- Public packaged runtime regression: 12/12 passed, including production default companion port 58732, occupied-port failure/retry, exact private firewall-rule lifecycle, native menus, routes/settings, six Night Modes, widget behavior, notifications, and complete owned-process/port/firewall/profile cleanup.
- Timer starts during packaged regression: 0. Real power actions: 0.

Primary evidence:

- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-first-launch-final/first-launch-report.json`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-first-launch-final/01-genuine-first-launch.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-first-launch-final/04-first-home.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-first-launch-final/05-relaunch-persisted.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-walkthrough/manifest.json`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-walkthrough/03-tonight-running-dry-run.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-walkthrough/07-help-menu.png`

## 3. Older-build updater compatibility

### Exact older build

- Version: v11.1.0.
- Tag target: `bb8bc2eed2e2ec31de5f463b8b668aa9f926027f`.
- Public historical asset: `LightsOut.exe`, 96,361,574 bytes.
- Asset SHA-256: `12DEB2B8A99B72E4B3D913D453AB3CF3A915E10A133E1AF6EDFBB7DFCCCABFC5` (exact GitHub digest match).
- Authenticode: `NotSigned`.
- Published: 2026-07-16.

The v11.1.0 updater module is byte/line-identical to the v11.1.2 candidate updater module. Running the actual v11.1.0 executable in isolation and invoking Check for updates produced:

- runtime version 11.1.0;
- startup 5,407 ms;
- result `{ available: false, error: "HTTP 404" }`;
- UI `Couldn't check for updates`;
- no Download action;
- zero runtime errors and zero real power actions.

The current public v11.1.2 executable reproduces the same HTTP 404 and UI failure (startup 469 ms), proving this is not limited to the historical build.

The updater requests `https://api.github.com/repos/lazelife420-spec/Lights-out/releases/latest`. Unauthenticated access returns 404. Separately, executing the unchanged updater resolver against the authenticated current release JSON proves a second compatibility failure: because the sole release asset is the portable ZIP and does not match `Lights.Out.Setup.X.Y.Z.exe`, the resolver fabricates `https://github.com/lazelife420-spec/Lights-out/releases/download/v11.1.2/Lights.Out.Setup.11.1.2.exe`, leaves the checksum URL empty, and selects a URL that returns 404. This is deterministic current release/source evidence, not a claim that the runtime reached that fallback after its earlier API 404.

Evidence:

- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/updater-v11.1.0/updater-report.json`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/updater-v11.1.0/v11.1.0-updater-result.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/updater-v11.1.2-current/updater-report.json`

## 4. Live Proof Foundry and public-truth audit

### Anonymous GitHub truth

On 2026-08-23 all three outside-user URLs returned HTTP 404:

- `https://github.com/lazelife420-spec/Lights-out/releases/tag/v11.1.2`
- `https://api.github.com/repos/lazelife420-spec/Lights-out/releases/latest`
- `https://github.com/lazelife420-spec/Lights-out/releases/download/v11.1.2/Lights-Out-Portable-v11.1.2-win-x64.zip`

The signed-out browser showed `Page not found · GitHub · GitHub`. In contrast, authenticated GitHub metadata reports repository visibility `PUBLIC`, `isPrivate: false`, and an ordinary latest published v11.1.2 release with the frozen ZIP asset. Phase A establishes the discrepancy and outside-user impact, but does not speculate about or repair its cause.

Evidence: `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-github-release-anonymous-404.png`.

### Live product page

`https://theprooffoundry.com/lights-out/` is reachable and currently states:

- `Status: In testing`;
- `Version: —`;
- `Platform: Windows + Android`;
- `Tests: 313/313`;
- `Proof: no release artifact`;
- `Verified: 2026-08-17`;
- `Coming soon`, `No GitHub release is live at this time`, `Not available yet`;
- Electron v11.1.2 / Android 11.1.1 in its internal-build evidence section;
- `Smoke suite 313/313`, although the closed v11.1.2 smoke receipt is 318/318 (313/313 is the unit total);
- no public download or release CTA.

The page does not promise an installer, does not contain historical PowerShell product language, and contains no `87 passed/87`, stale hash, portable, or ZIP wording. All 16 inspected Lights Out image URLs returned HTTP 200, the page emitted no console errors, and its fragment/internal links were not placeholders.

Most feature claims align with current evidence: Windows + Android, LAN companion, canonical receipts/Proof, smart-light verification gating, and experimentally scoped Wi-Fi Guard providers. Two claims are stronger than current product truth:

- `six preset endings` does not disclose that only four are ready; Quiet House is `coming_soon` and School Night is `needs_router_setup` and non-interactive.
- the First Light text says the one-shot wake task removes itself after firing, while the current implementation creates a once-triggered `LightsOut_FirstLight` scheduled task and contains no post-fire unregister path. Phase A did not schedule a real wake task, so this is classified as a public-claim/source contradiction, not as a runtime wake failure.

Evidence: `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-site-lights-out.png`.

### Live homepage and Proof page

- `https://theprooffoundry.com/` labels the Lights Out PC card `In testing` and Windows + Android.
- `https://theprooffoundry.com/proof/` says `no release artifact`, `Latest Version: Unreleased`, `SHA: Unreleased`, `Download: coming soon`, and links an older 2026-06-30 proof note.
- These pages are inconsistent with the authenticated published-release control plane and the intended Gate 8B release state, while their lack of a working download happens to match the anonymous 404 user experience.

Evidence:

- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-site-home.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/public-site-proof-page.png`

## 5. Android 11.1.1 physical compatibility

The S23 became available during Phase A, so the physical lane was executed rather than left pending.

### Installed identity

- Package: `com.lightsout.companion`.
- Version: 11.1.1 (versionCode 2).
- Installed APK SHA-256: `1DEF26B9CA46C6DD1A7E17322BAAADB8763C24BD296302438A82F7641C64170E`.
- Signing certificate DN: `CN=Lights Out Companion, OU=Bedside Security, O=Lights Out, L=Bedside, ST=Bedside, C=US`.
- Signing certificate SHA-256: `B508EA976AED50762F9BA3E928528F8EB860B758659690767E9F6B8B162C984B`.
- This was a read-only verification of the installed APK. The release keystore was not opened, generated, altered, or otherwise touched.

### Published-desktop physical run

The exact frozen Windows launcher (`2A630319...`) was started with an isolated profile. Desktop Dry Run was made authoritative before pairing. The phone and PC used `BMW ONLY! 5G`; the desktop listener selected an isolated free port while preserving the product default 58732 in settings.

Observed passes:

- manual entry of the freshly generated pairing URL over ADB and authenticated HTTP/WebSocket connection;
- physical connection status `Connected` and live countdown updates;
- all six canonical Night Modes received and rendered in exact order;
- Quick Sleep, Lights Down, Movie Wind-Down, and Full Shutdown each started and produced a matching desktop receipt with `dryRun: true`;
- Quiet House rendered disabled with `coming_soon`; School Night rendered disabled with `needs_router_setup`; both had `tabindex=-1`;
- Pause once, Resume once, +5 once, and Cancel once;
- Wi-Fi disable/enable and same-network recovery;
- force-stop/relaunch of the Android wrapper and authenticated reconnect;
- receipt count unchanged across wrapper restart, phone idle, `pendingOperation: null`: no command replay;
- exact pairing token absent from the bounded Android logcat and desktop log/JSON scan;
- after the desktop listener stopped, the saved URL timed out and the app returned to the branded Connect to your PC setup surface; the log redacted the query;
- no crash or fatal Android exception;
- real power actions: 0.

An actual camera scan of a monitor-displayed QR was not practical in the autonomous bench arrangement and is not claimed. The native Scan QR control was present and camera permission already granted; authenticated pairing was completed through the product's documented manual fallback.

### Duplicate-start observation

While a published-artifact Dry Run had approximately 597 seconds remaining, the already authenticated physical phone WebView sent one additional valid generic start command for 60 seconds. The published desktop accepted it:

- receipt count changed by +1;
- active remaining time reset from approximately 597 to 60 seconds;
- the prior run was superseded rather than preserved/rejected.

The ordinary phone UI hides start controls during an active run, but the accepted protocol command is current runtime behavior. It is not a source-only suspicion. The subsequent timer remained Dry Run and was cancelled, so no real action occurred.

Evidence:

- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/physical-run.log`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/physical-phone-connected.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/physical-phone-reconnected.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/04-offline-relaunch-after-timeout.png`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/04-offline-relaunch.log`
- `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/installed-11.1.1.apk`
- Evidence-only observer: `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/android-physical/run-published-physical-observer.js`

## Complete classified findings ledger

Every Phase A observation below has exactly one classification.

| ID | Lane | Observation and reproduction | Expected / observed | Current impact | Class | Confidence | Published artifact? | Historical only? |
|---|---|---|---|---|---|---|---|---|
| F-01 | Public release | Signed-out browser and anonymous HTTP opened the release page, latest-release API, and exact ZIP URL. | Expected public release/download; all returned 404 while authenticated metadata says public/published. | Outside users cannot discover or download the intended release. | `P0` | High impact/reproduction; cause unknown | Yes, distribution endpoint | No |
| F-02 | Updater | Actual v11.1.0 and v11.1.2 Check for updates. | Expected discovery of v11.1.2; both show HTTP 404 and `Couldn't check for updates`. | Existing and current users cannot use in-app update discovery. | `P1` | High | Yes; reproduced on both binaries | No |
| F-03 | Updater asset selection | Ran unchanged resolver against authenticated current release JSON. | Expected sole ZIP or explicit unsupported result; fabricated nonexistent setup EXE, no checksum, URL 404. | ZIP-only release is incompatible with the installer-oriented resolver even if API visibility is restored. | `P1` | High | Current candidate source + exact release metadata | No |
| F-04 | Public truth | Inspected live product/home/Proof pages and CTAs. | Expected v11.1.2 published truth and working release link; pages say in testing/unreleased/coming soon and provide none. | Users receive stale release state and no distribution path. | `P1` | High | Public web state | No |
| F-05 | Android/companion | Sent a second valid generic start over the authenticated physical connection during an active Dry Run. | Expected duplicate rejection/preservation; new receipt created and timer reset to 60 seconds. | Authenticated clients can supersede an active run through the accepted protocol. | `P1` | High | Yes | No |
| F-06 | Portable UX | Extracted ZIP into a fresh directory and inspected root. | Expected clear portable startup guidance; 573 files spill at root, with no README/quick-start/shortcut/update guidance. | Real extraction/startup friction for nontechnical users. | `P2` | High | Yes | No |
| F-07 | Public claim | Compared `six preset endings` to the physical/current catalogue. | Expected availability qualification; only four ready, two disabled. | Marketing copy overstates immediate mode availability. | `P2` | High | Current public + runtime | No |
| F-08 | Public claim | Compared First Light self-removal statement to current implementation. | Expected explicit post-fire task removal; no such path exists. | Public lifecycle claim is stronger than current source evidence. | `P2` | Medium-high; wake not executed | Current source/public claim | No |
| F-09 | Android recovery UX | Relaunched with a saved but offline pairing endpoint; captured at ~3 s and after timeout. | Expected visible recovery feedback; WebView is blank/black during the bounded retry, then correctly falls back to setup by 18 s. | Temporary opaque recovery state can look hung. | `P2` | High | Android 11.1.1 + published desktop pairing | No |
| F-10 | Artifact integrity | Hashed ZIP, launcher, packaged app content and extracted all files. | Expected frozen identity; every frozen hash/size matched. | Release payload is unmodified. | `KEEP` | High | Yes | No |
| F-11 | Fresh launch | Fresh profile, onboarding, all routes, settings, Help/About, Dry Run, relaunch. | Expected coherent idle-safe product; passed with correct version/persistence and no errors. | Core first-use/runtime behavior is healthy. | `KEEP` | High | Yes | No |
| F-12 | Packaged regression | Ran packaged smoke/truth against extracted public EXE. | Expected safe packaged runtime; 12/12, no leaks, timerStarts 0, realPowerActions 0. | Packaging/runtime safety remains proven. | `KEEP` | High | Yes | No |
| F-13 | Android identity | Pulled installed APK and verified package/version/signature. | Expected release-signed 11.1.1; identity and certificate verified. | Physical companion identity is credible. | `KEEP` | High | Physical Android lane | No |
| F-14 | Android controls | Paired physical S23; tested six-mode catalogue, four ready starts/receipts, Pause/Resume/+5/Cancel, recovery/restart. | Expected authenticated Dry Run behavior; all passed except F-05. | Cross-device core lane is compatible. | `KEEP` | High | Yes | No |
| F-15 | Android replay/secrets | Restarted wrapper and scanned bounded phone/desktop logs for exact token. | Expected no replay/leak; receipt count unchanged, idle/pending null, token absent, query redacted. | Reliability and credential hygiene preserved. | `KEEP` | High | Yes | No |
| F-16 | Website assets/claims | Checked 16 Lights Out image URLs, page errors, scoped integration language, Android version. | Expected current assets and honest scope; images 200, no console errors, Android 11.1.1 and experimental/config gating accurate. | Preserve these truthful public elements. | `KEEP` | High | Public web | No |
| F-17 | Website history | Searched current live page for PowerShell/classic-app language, installer promise, `87 passed/87`, stale hashes. | Historical concerns expected absent; absent. | Old audit concerns should not be reopened. | `HISTORICAL` | High | Public web | Yes |
| F-18 | Android debug warning | Historical README notes Android 15 debug compatibility warning. Physical installed release-signed app on Android 16 showed none. | Expected release build not to show debug warning; none appeared. | Historical debug-build caveat is not a current release defect. | `HISTORICAL` | High | Physical release install | Yes |
| F-19 | SmartScreen | CLI-acquired unsigned ZIP had no MOTW; anonymous browser asset was inaccessible. | Expected observation only if browser download possible; no prompt appeared and browser path could not run. | Valid future observation after F-01 is resolved, not a reproduced defect here. | `DEFERRED` | High boundary | Not reproducible on public path | No |
| F-20 | Physical QR camera | Confirmed native QR control/permission; used documented manual URL fallback for autonomous physical pairing. | Camera scan desirable where practical; not performed/claimed. | Manual fallback and full authenticated lane prove compatibility; camera ergonomics remain a future observation. | `DEFERRED` | High boundary | Android lane | No |

## Phase B eligibility

Only reproduced/current findings are eligible:

1. `F-01` — restore or otherwise establish genuinely anonymous release-page/API/asset access and re-prove it signed out.
2. `F-02` and `F-03` — define and implement updater behavior compatible with the chosen portable ZIP distribution, including honest failures and integrity handling.
3. `F-04` — reconcile live Proof Foundry product/home/Proof truth, version/test counts, artifact identity, and CTAs with the actual distribution state after F-01.
4. `F-05` — reject or safely define duplicate remote start semantics without weakening local safety invariants.
5. `F-06` — decide portable extraction/startup/shortcut/update guidance without changing the frozen v11.1.2 artifact.
6. `F-07` — qualify four ready/two unavailable Night Modes in public copy.
7. `F-08` — reconcile First Light task-lifecycle copy and implementation truth; runtime wake testing remains separately safety-bounded.
8. `F-09` — provide visible bounded reconnect feedback before Android fallback.

`F-19` and `F-20` are not remediation scope. They become observational follow-ups only when their prerequisites are available.

## Historical concerns rejected as non-current

- The classic PowerShell/WinForms product surface is not presented publicly and was not present in the packaged walkthrough.
- The live page does not promise an installer.
- Old `87 passed/87` copy and stale hashes are absent.
- Website Lights Out images are not broken or placeholders.
- Android hardware is no longer pending/manual for this Phase A; the S23 lane was completed.
- The historical Android 15 debug compatibility warning did not appear on the release-signed Android 16 install.
- Frozen ZIP, launcher, and application-content mutation did not reproduce.
- Packaged missing-file, console-error, persistence, login-auto-start, and real-power-action concerns did not reproduce.
- The updater concern is **not** rejected as historical: it is current because both runtime and exact current metadata resolution reproduced it.

## Safety and cleanup receipt

- Real Windows power actions across all Phase A lanes: **0**.
- Android Night Mode and control executions were desktop-authoritative Dry Run.
- No Windows wake task was created or changed.
- Companion firewall rules after tests: 0.
- Phase-owned listening ports after tests: 0.
- Phase-owned Windows processes after tests: 0.
- Phase-owned Android process after tests: force-stopped.
- Phase-owned ADB forwarding and temporary device XML files: removed.
- Download/extraction root and all isolated desktop profiles: removed.
- Only report, screenshots, reports/logs, the pulled installed APK, and evidence-only observer scripts remain under `electron/docs/proof/v11.1.2/post-release-gate1-phase-a/`.
- Pre-existing unrelated untracked files `GOVERNING_DIRECTIVE_EVIDENCE.md` and `NEURAL_EMPIRE_PROOF_FOUNDRY_GOVERNING_FUTURE_AGENT_DIRECTIVE.md` were not touched.
- No remediation commit was created.

**POST-v11.1.2 GATE 1 / PHASE A — PASS / CLOSED — FIELD EVIDENCE CLASSIFIED, READY FOR PHASE B SCOPING**
