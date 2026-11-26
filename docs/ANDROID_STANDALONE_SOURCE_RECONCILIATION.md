# Android Standalone — Source Reconciliation (2026-10-29)

Provenance-first reconciliation of the canonical `main` line against the
qualified October candidate, per the founder directive of 2026-10-29.

## Source custody map

| Authority | Commit / state | Status |
| --- | --- | --- |
| Canonical checkout | `<USERPROFILE>\Projects\Active\Lights-out` | `main` @ `6adb1cf` (7 unpublished commits on `335ba77`) |
| October candidate | `0b0b69826847b5d749db5858062ec82411bef8ef` | 13 commits on `335ba77`, **qualified PASS** 2026-10-17 |
| Candidate worktree A | `Lights-out-platform-alignment-20261016` | clean @ `0b0b698` (device-trust branch); hosts `review/` evidence |
| Candidate worktree B | `Lights-out-integration-0b0b698-20261017` | **dirty**: +1504/−757 across 57 tracked files + ~52 untracked — post-candidate desktop tranche (LO-FINAL-CLOSEOUT/RC3–RC5 lineage, `HandoffConnection.kt`, `HandoffCertificate.kt`, `firstLightDelivery.js`, `boundedProcess.js`, `electron/experimental/`, `electron/native/`) |
| Release-gate worktree | `Lights-out-release-gate` | detached `db27a99` |
| QA evidence | `F:\LightsOutQA\` | 22 dated evidence dirs, incl. `LO-CANDIDATE-QUAL-0b0b698-20261017` (APK + test XMLs + emulator screenshots) |

## Candidate ancestry

- Merge base with `main`: `335ba77` (v11.2.0 release) — linear extension, no fork.
- Candidate commits (13, top→base): `0b0b698` Studio Tonight redesign · `5df7d6a` active-timer presentation · `1f6b345` Studio desktop+phone redesign · `4e7ee41` settings/timer/lighting refinement · `400f8c2` light experiences + app beacons · `347dbe4` protected identities + pairing inbox · `bf36a62` mTLS provider verification fix · `0ec94c9` pinned-TLS routine transfer foundations · `79af767` offline routine file exchange + reviewed adoption · `44c9cf3` calendar action editing + ritual receipt correlation · `4ab736a` leap-day recurrence fix · `df83ec9` routine contracts + durable outcomes · `4c52470` secondary-readiness guard.
- `git diff 335ba77..0b0b698`: 111 files, +6785/−383.

## Qualification evidence (verified from `LO-CANDIDATE-QUAL-0b0b698-20261017`)

| Claim | Evidence | Verdict |
| --- | --- | --- |
| 1,125/1,125 Windows unit | `windows-unit.log` (254 KB) + `QUALIFICATION.json` | VERIFIED |
| 299/299 Windows smoke | `windows-smoke.log` | VERIFIED |
| 100/100 Android JUnit | `android-full/junit/TEST-*.xml` (9 classes) | VERIFIED |
| Leap-day recurrences | targeted `PhoneCalendarRuleTest` cases + `recurrence-fix.patch` | VERIFIED |
| 0 lint errors (26 warnings) | `android-full/lint-results-debug.xml` | VERIFIED |
| Debug build + APK | `Lights-Out-v11.2.0-candidate-0b0b698-debug.apk` (26.7 MB) + `SHA256SUMS.txt`, id `com.lightsout.companion.debug`, no production signing | VERIFIED |
| Emulator smoke (API 35) | `emulator-r2/` report + screenshots, `emulator-5582` | VERIFIED (emulator class only) |
| Physical device / real bulb | none | NOT QUALIFIED — field-QA hold |

## File-level integration decisions — `companion-android/`

**Integrated now** (checked out from `0b0b698` verbatim, 46 files):

| Group | Files | Disposition |
| --- | --- | --- |
| Routine interchange (LO-RIE-1) | `RoutineInterchange.kt`, `RoutinePlan.kt`, `PortableRoutineChecks.kt`, `PhoneImportCommit.kt`, `assets/phone/routine-model.js` + tests | INTEGRATED — qualified |
| Secure handoff foundations (LO-SDH-0/1) | `RoutineHandoff.kt`, `RoutineHandoffInbox.kt`, `HandoffController.kt`, `HandoffIdentity.kt`, `HandoffTrust.kt`, `handoff-ui.js`, `handoff.css`, `routine-transfer-ui.js` + tests | INTEGRATED — phone half; PC half remains Phase E |
| Light experiences (LO-LIGHT-1) | `LightExperienceModel.kt`, `PhoneLightExperience.kt`, `LightAlertPolicy.kt`, `LightNotificationService.kt`, `light-experience.*` + test | INTEGRATED — effects start off; notification listener needs user grant |
| Calendar/routines core | `PhoneCalendar.kt`, `PhoneCalendarRule.kt`, `PhoneHomeStore.kt`, `PhoneRoutineOutcomes.kt`, `PhoneTimerService.kt`, `PhoneTimerStore.kt`, `PhoneLights.kt`, `HomeActivity.kt`, `ScannerActivity.kt`, `activity_scanner.xml` | INTEGRATED — includes leap-day + routine-contract + action-editing fixes |
| Manifest | deeplink `lightsout-handoff://enroll/v1`, `LightNotificationService`, queries block | INTEGRATED |
| `studio.css`, `index.html`, `home.js`, `phone.css` | Studio phone UI | INTEGRATED |
| `README.md` | field-QA + lifecycle + calendar-lane + light-experiences docs | INTEGRATED (supersedes Gradle-9.8.2 wording) |

**Reverted — superseded by qualified candidate toolchain**:

| File | main had | Candidate has | Decision |
| --- | --- | --- | --- |
| `app/build.gradle` | AGP 9.5 (built-in Kotlin), compileSdk 36, newer AndroidX | AGP 8.5.2 + kotlin plugin 1.9.24, compileSdk 34, older pinned AndroidX | **Candidate wins** — the only compiled/tested/linted combination. The `351be94` toolchain bump is superseded for the Android subtree and remains in history for a future qualified bump tranche |
| `build.gradle` | AGP 9.5.0 | AGP 8.5.2 + Kotlin 1.9.24 | same |
| `gradle/wrapper/…` | Gradle 9.8.2 | Gradle 8.7 (pinned checksum) | same |
| `.github/workflows/ci.yml` | `android-36`/`build-tools;36` | — | CI changed to install `android-34`/`build-tools;34` so CI matches the qualified toolchain |

**Not promoted (in-flight, uncommitted in worktree B)**:

| Files | Why |
| --- | --- |
| `HandoffConnection.kt`, `HandoffCertificate.kt`, `HandoffCertificateTest.kt`, dirty edits to `HandoffController.kt`/`HandoffIdentity.kt`/handoff UIs | Uncommitted, unqualified Oct 18–20 tranche. Real mTLS client work — next Android tranche after its own qualification, not silently promoted |

**PC-side candidate surface — deferred to Phase E (owner-gated)**:

`electron/handoff*` (service/controller/trust/identity/protection), `electron/routine*` (handoff/inbox/interchangeStore/ledger/model/transfer-ui), `lightExperience.js`, `studio.css` + Tonight redesign + matching tests/proof scripts. Reason: the desktop surface is installed and shipping; landing a full redesign + network handoff stack onto `main` requires its own merge-quality qualification against the current desktop commits. The Android half is self-contained and runs without it.

## Known absent-on-main list (directive §3) — resolved

`RoutineInterchange.kt`, `routineHandoff.js`, `routine-transfer-ui.js` were absent because the candidate was never integrated; the Android-side files are now on `main`. `electron/routineHandoff.js` + `electron/routine-transfer-ui.js` remain candidate-side pending Phase E.
