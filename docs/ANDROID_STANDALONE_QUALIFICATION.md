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

## Integration-day verification on `main` (2026-10-29)

| Check | Result |
| --- | --- |
| Subtree identity | 46 `companion-android/` files checked out verbatim from `0b0b698` |
| Electron unit suite | unchanged (integration touched zero `electron/` files) — last full run 1069/1069 green this session |
| Android compile/test on merged tree | **NOT RUN — no local Android SDK on this machine.** Deferred to CI (`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`) with workflow updated to `android-34`/`build-tools;34` |
| Emulator / physical device | NOT RUN — requires SDK + hardware |

## Subsystem classifications (post-integration)

| Subsystem | Class | Confidence |
| --- | --- | --- |
| Phone timer/service | LOCAL_COMMITTED (source AUTOMATED_TESTED on candidate) | SUPPORTED |
| Phone calendar incl. leap-day | LOCAL_COMMITTED | SUPPORTED |
| Routines + interchange | LOCAL_COMMITTED | SUPPORTED |
| Handoff foundations (phone half) | LOCAL_COMMITTED | SUPPORTED |
| Light experiences + beacons | LOCAL_COMMITTED | SUPPORTED |
| WiZ direct control | LOCAL_COMMITTED | SUPPORTED (UDP fixture only — physical bulb UNKNOWN) |
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
