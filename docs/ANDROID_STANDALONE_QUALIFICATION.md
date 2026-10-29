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

## Integration-day verification on `main` (2026-10-29) — superseded by M1 above

| Check | Result |
| --- | --- |
| Subtree identity | 46 `companion-android/` files checked out verbatim from `0b0b698` |
| Electron unit suite | unchanged (integration touched zero `electron/` files) — last full run 1069/1069 green this session |
| Emulator / physical device | NOT RUN — emulator needs system-image provisioning; physical needs owner phone |

## Subsystem classifications (post-integration)

| Subsystem | Class | Confidence |
| --- | --- | --- |
| Phone timer/service | AUTOMATED_TESTED (M1, `62edc05`) | SUPPORTED |
| Phone calendar incl. leap-day | AUTOMATED_TESTED (M1) | SUPPORTED |
| Routines + interchange | AUTOMATED_TESTED (M1) | SUPPORTED |
| Handoff foundations (phone half) | AUTOMATED_TESTED (M1) | SUPPORTED |
| Light experiences + beacons | AUTOMATED_TESTED (M1) | SUPPORTED |
| WiZ direct control | AUTOMATED_TESTED (M1) | SUPPORTED (UDP fixture only — physical bulb UNKNOWN) |
| Studio phone UI | LOCAL_COMMITTED | SUPPORTED (screenshots exist for candidate; post-merge pixels not re-captured) |
| mTLS client (`HandoffConnection`/`Certificate`) | SOURCE_PRESENT in worktree B only — uncommitted, unqualified | PROVEN-ABSENT from main by design |
| PC-side handoff/Studio | candidate-side only | BLOCKED pending Phase E owner gate |
| First Light (phone-owned) | DESIGN_ONLY | PROVEN-ABSENT — not found on any line |
| Production signing/distribution | BLOCKED — owner-gated | — |
| Physical device reliability | UNKNOWN — field-QA hold | — |

## Honest limits

- Integration commits source verbatim; it does not re-create the candidate's
  test environment. Every qualification above predates the merge — treat
  classes as "source proven qualified", not "merged tree proven".
- The debug APK on F: predates integration; it is evidence for `0b0b698`,
  not for `main`.
- No real-bulb, physical-phone, Doze, OEM-battery or force-stop evidence
  exists anywhere on record.
