# Android Standalone — Qualification Record

## Verified historical evidence (candidate `0b0b698`, 2026-10-17)

Source: `review/LO-CANDIDATE-QUAL-0b0b698-20261017/` +
`F:\LightsOutQA\` — inspected directly, not via summaries.

| Gate | Result | Evidence |
| --- | --- | --- |
| Android JUnit | 100 passed / 0 failed / 0 skipped | `android-full/junit/TEST-*.xml` (9 classes: CompanionUrlNormalizer, HandoffClock, LightExperience, PhoneCalendarRule, PhoneTimer, PortableRoutineChecks, RoutineHandoff, RoutinePlan, WizAddress) |
| Leap-day targeted | PASS (`leapDayRepeatsAfterFourYears`, `leapDaySkipsNonLeapCentury`) | `android-targeted/junit/`, `recurrence-fix.patch` |
| Android lint | 0 errors, 26 warnings (LockedOrientationActivity×3, DiscouragedApi×3, SetJavaScriptEnabled, InsecureBaseConfiguration, ObsoleteSdkInt, StaticFieldLeak, Overdraw, UnusedResources×4, MonochromeLauncherIcon×2, SmallSp×2, SetTextI18n×4, HardcodedText×3) | `lint-results-debug.xml` |
| Debug build | PASS — `com.lightsout.companion.debug`, v11.2.0-debug, 79 source inputs blob-verified, 12 APK assets verified | `gradle.log`, `output-metadata.json` |
| Debug APK | `Lights-Out-v11.2.0-candidate-0b0b698-debug.apk` (26,734,254 B) | `SHA256SUMS.txt`, `ARTIFACT_SHA256SUMS.txt` |
| Emulator smoke | PASS — owned API-35 `emulator-5582`, actual UI start/pause/resume/cancel | `emulator-r2/`, screenshots |
| Windows unit | 1,125/1,125 | `windows-unit.log` |
| Windows smoke | 299/299 | `windows-smoke.log` |
| Packaged Windows | Test Mode + occupied-port/recovery checks | `windows-packaged-report.json` |
| Power actions | ZERO real power actions; firewall unchanged | packaged report |
| Signing | QA debug key only; production signing NOT used | `QUALIFICATION.json` |

## M1 — merged-tree qualification EXECUTED (2026-10-29)

Tested commit: **`62edc05d132f45ed6ebcf69a6cdcfd70fb75a073`** (git archive of HEAD → isolated project; no untracked checkout files).

Environment: provisioned Android cmdline-tools + `platform-tools`, `platforms;android-34`, `build-tools;34.0.0` in `F:\LightsOutQA\M1-Integrated-20261029\sdk`; JDK 17 (Adoptium `jdk-17.0.19.10`); isolated `ANDROID_USER_HOME`/`GRADLE_USER_HOME`; release-signing env cleared; production keystore never touched. `local.properties` points at the QA SDK only.

Command: `gradlew --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` — **BUILD SUCCESSFUL** in 1m44s.

| Gate | Result | Same as candidate? |
| --- | --- | --- |
| JUnit | **100 passed / 0 failed / 0 errors / 0 skipped** (9 classes, identical list) | YES |
| Lint | **0 errors / 26 warnings** | YES — identical count |
| Debug build | PASS — `com.lightsout.companion.debug`, v11.2.0-debug, versionCode 4, compileSdk 34 | YES |
| APK | `app-debug.apk` 26,734,254 B, SHA-256 `D4C738C3B18E48F580B0BDE417D57D3137861A9364D745788286C074CE0AE479` | identical byte size; SHA differs from candidate `838AE66D…` only by build timestamping — not bitwise reproducible |
| New defects | None — 1 Kotlin warning (`Name shadowed: a`, RoutineInterchange.kt:77) | pre-existing in candidate |

**Verdict: M1 PASS — the integrated tree at `62edc05` is AUTOMATED_TESTED.** Evidence at `F:\LightsOutQA\M1-Integrated-20261029\` (project copy, reports, APK, SDK).

## M2 — emulator lifecycle qualification EXECUTED (2026-10-29)

Environment: owned AVD `LightsOut_QA_API35` (API 35, `system-images;android-35;default;x86_64`, `emulator-5582`, swiftshader) in the provisioned isolated SDK; isolated `ANDROID_AVD_HOME`/`ANDROID_USER_HOME`. APK: source-bound QA build `Lights-Out-Android-v11.2.0-debug.apk`, SHA-256 `c7e8f59f…` bound by `android-qualification.json` (79 source inputs re-verified byte-for-byte against the checkout by the proof script itself).

Command: `node electron/scripts/android-standalone-lifecycle-proof.js` (standard + `--calendar-only --allow-emulator-clock-change` modes).

| Lane | Result |
| --- | --- |
| Lifecycle | **6/6 PASS** — offline controls under denied permissions, granted-permission notification registration, timezone preserves monotonic countdown, stale service command rejected, process restart restores one timer, screen-off completion posts finish notification |
| Calendar | **6/6 PASS** — denial preserves rule unarmed, grant restores PendingIntent, early delivery doesn't start/consume, timezone recompute, real+duplicate delivery = one occurrence, late delivery skipped without consuming a running timer |
| Emission | `android-lifecycle-report.json` ×2, `emulator-final.png`, state restored (wifi on, timezone `America/Los_Angeles`) |

**Verdict: M2 PASS — EMULATOR_TESTED on `62edc05`/`d0a74cc`-era source.** Still not physical-device proof: OEM battery managers, real broadcast/WiZ UDP and force-stop remain `ANDROID_FIELD_QA.md` items.

## M3 — expanded emulator-only qualification EXECUTED (2026-10-29)

Environment: owned AVDs in the isolated SDK — `LightsOut_QA_API35` (API 35, `emulator-5582`) plus newly provisioned `LightsOut_QA_API36` (API 36, `system-images;android-36;default;x86_64`, `emulator-5592`). APK `Lights-Out-Android-v11.2.0-debug.apk` SHA-256 `8478e949…` rebuilt from canonical `9c6dcb1` (adds the 44px touch-target fix), bound by `android-qualification.json` (79/79 sources re-verified; unit tests and lint green; no production signing). Evidence root: `F:\LightsOutQA\M3-EmulatorMax-20261029\`.

| Lane | API 35 | API 36 |
| --- | --- | --- |
| Lifecycle | **6/6 PASS** | **6/6 PASS** |
| Calendar | **6/6 PASS** | **6/6 PASS** |

Deep lanes (driven on API 35):

- **WiZ UDP simulation — 13/13 PASS** (`wiz-sim.js`, `wiz-sim-report.json`): good bulb status/on/warm with real `setPilot` params (`state`, `dimming`, `temp` 2700K); malformed, error, wrong-method, silent-drop and >1200ms-delayed replies all produce honest failures, never fake success; stale IP fails honestly; mixed targets return per-target results; a public IP is rejected before any packet leaves (fail closed); **discovery broadcast via emulator NAT reached the fixture — end-to-end `getPilot` + MAC validation proven** (physical broadcast reachability still unproven). Rapid manual taps are legitimately swallowed by the app's `active ≥ 2` anti-hammer guard — correct behavior, surfaced by harness pacing.
- **Routine interchange security — 15/15 PASS** (`import-security.js`, `import-security-report.json`): garbage, wrong format, schemaVersion 99, JSON depth >16, duplicate keys, >256KiB, >32 routines, unknown fields and out-of-range timer seconds are all refused; Windows `endAction` imports only as an inert draft and preview flags the phone-reminder adaptation (consent-gated by design); a valid file imports and persists; `reject` policy refuses conflicts without clobbering; `copy` policy lands a renamed copy; preview annotates conflicts without committing.
- **UI audit** (`ui-audit.js`, 8 screenshots): timer idle/running/paused/finished, lighting, routines, calendar, PC-controls entry. Accessibility findings adjudicated live: several controls measured under the 44px tap minimum → narrow CSS floor committed as `9c6dcb1` and re-measured on-device (days 45×44, month nav 44×44, clock/countdown 44px, PC entry 177×44).
- **Advanced lifecycle** (manual/stepped, evidence partial): cold-boot restores the running monotonic timer; `dumpsys deviceidle force-idle` Doze preserves it; app-standby bucket preserves it; force-stop + relaunch restores the same runId/deadline; exact-alarm revocation shows the permission disclosure path.

## Findings queued for M1.5 modernization

- **16KB page-size audit — REAL compatibility risk**: `libimage_processing_util_jni.so` (from `androidx.camera:camera-core:1.3.4` — verified by transform-cache provenance) has LOAD segments at 4096-byte alignment on **every ABI including arm64-v8a and x86_64**. Android's 16KB compatibility mode still installs and runs it: verified on a dedicated `google_apis_ps16k` API-36 emulator (`PAGE_SIZE=16384`) — the APK installs, HomeActivity launches, and the camera-path MainActivity becomes top-resumed without `UnsatisfiedLinkError`. The residual risk is OEM/kernel-level strict 16KB enforcement when the ML Kit analyzer actually binds (not reachable without a live QR frame loop). **Verified fix path**: `camera-core` ≥1.4.2 ships the same library at 16384 alignment on arm64-v8a AND x86_64 (checked artifacts 1.4.2/1.5.3/1.6.2); the other camera modules ship no natives. `libbarhopper_v3.so` (ML Kit barcode-scanning) is already 16384-aligned on both 64-bit ABIs. Belongs to the M1.5 tranche, not this baseline.
- APK is not bitwise reproducible (dex serialization ordering only — see below).
- targetSdk remains 34; API-36 lanes above are compat evidence on the newer platform, not Play-readiness.

**Verdict: M3 PASS — EMULATOR-MAXIMIZED on `9c6dcb1`.** Still no physical-device, OEM-battery, real-router or real-WiZ claims; those remain `ANDROID_FIELD_QA.md` items.

## APK byte-level reproducibility investigation (audit requirement)

Fresh merged-tree build vs candidate `0b0b698` artifact:

- 533/533 zip members present both sides; **zero added, zero missing**
- All non-dex members **byte-identical** (manifest, `resources.arsc`, res/, assets/, every `.so` native library)
- `classes.dex` / `classes3.dex`: ~11% scattered byte variance, **identical sizes** (11,250,364 / 376,200 B) — same content, different serialization order
- Controlled line-ending test (CRLF checkout build vs LF git-archive build) reproduced the scatter → **D8 output ordering nondeterminism**, not a timestamp field and not a source difference
- Semantic equivalence SUPPORTED: identical source (79/79 blob-verified), identical tests (100/100), identical lint (0/26)

The APKs are **not bitwise reproducible**; the variance is confined to dex serialization ordering. Byte-reproducible builds would need deterministic-dex post-processing — a release-engineering tranche item, not a correctness defect.

## Integration-day verification on `main` (2026-10-29) — superseded by M1 above

| Check | Result |
| --- | --- |
| Subtree identity | 46 `companion-android/` files checked out verbatim from `0b0b698` |
| Electron unit suite | unchanged (integration touched zero `electron/` files) — last full run 1069/1069 green this session |
| Emulator / physical device | NOT RUN — emulator needs system-image provisioning; physical needs owner phone |

## Subsystem classifications (post-integration)

| Subsystem | Class | Confidence |
| --- | --- | --- |
| Phone timer/service | EMULATOR_TESTED (M1 merged-tree unit tests; M2 lifecycle 6/6; M3 lifecycle 6/6 on API 35 **and** API 36) | SUPPORTED |
| Phone calendar incl. leap-day | EMULATOR_TESTED (M1+M2; M3 calendar 6/6 on API 35 **and** API 36) | SUPPORTED |
| Routines + interchange | EMULATOR_TESTED (M3 interchange security 15/15 on-device via bridge) | SUPPORTED |
| Handoff foundations (phone half) | AUTOMATED_TESTED (M1) | SUPPORTED |
| Light experiences + beacons | AUTOMATED_TESTED (M1) | SUPPORTED |
| WiZ direct control | EMULATOR_TESTED (M3 isolated UDP simulation 13/13 incl. discovery) | SUPPORTED (simulated fixture only — physical bulb UNKNOWN) |
| Studio phone UI | EMULATOR_TESTED (M3 audit: 8 screenshots, 48dp-effective bounds inventoried) | SUPPORTED |
| 16KB page-size compatibility | COMPAT_MODE (install+launch verified on `PAGE_SIZE=16384`; one latent native risk) | KNOWN RISK — `libimage_processing_util_jni.so` 4KB-aligned until CameraX ≥1.4.2 |
| mTLS client (`HandoffConnection`/`Certificate`) | SOURCE_PRESENT in worktree B only — uncommitted, unqualified | PROVEN-ABSENT from main by design |
| PC-side handoff/Studio | candidate-side only | BLOCKED pending Phase E owner gate |
| First Light (phone-owned) | DESIGN_ONLY | PROVEN-ABSENT — not found on any line |
| Production signing/distribution | BLOCKED — owner-gated | — |
| Physical device reliability | UNKNOWN — field-QA hold | — |

## Honest limits

- All M1/M2/M3 qualification is against the merged `main` tree (source
  hashed into every lane's inventory); the historical `0b0b698` candidate
  records remain as provenance, not the current claim.
- Emulator evidence is not physical-device proof: OEM battery managers,
  real broadcast/WiZ UDP, real-camera QR scanning and physical-phone
  behavior remain `ANDROID_FIELD_QA.md` items.
- Doze/force-stop evidence exists only at emulator fidelity
  (`deviceidle force-idle`, app-standby buckets, force-stop/reopen);
  OEM-specific behaviors are not covered.
- On 16KB pages the app runs under Android's compatibility mode today;
  strict-enforcement environments remain a known risk until the CameraX
  bump lands (M1.5).
