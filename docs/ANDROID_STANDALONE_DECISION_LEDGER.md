# Android Standalone — Decision Ledger

Chronological reconstruction of owner decisions, implemented work and
supersessions affecting the standalone Android product. Entries cite the
strongest available source; "reported" marks claims not yet re-verified.

## 2026 — Product genesis and identity

| Date | Decision / event | Source | Disposition |
| --- | --- | --- | --- |
| Jul (earlier) | Standalone Android app established as its own surface: phone-owned timer, foreground service, AlarmManager, native WiZ UDP, native calendar alarms; PC companion WebView is a separate optional activity | `AGENTS.md`, `companion-android/` | CURRENT — confirmed by directive §1 |
| 2026-07-09 | `companion-mobile/` (unfinished Capacitor duplicate) removed | `AGENTS.md` | SUPERSEDED — native Kotlin app is the line |
| (earlier) | Release keystore `~/.android/lightsout-companion-release.jks` designated the one and only signing identity; no recovery path | `AGENTS.md` | CURRENT — production signing remains owner-gated |
| (earlier) | Debug builds keep `applicationIdSuffix '.debug'` so QA never replaces the production package | `app/build.gradle` | CURRENT |

## October 16–17 — Candidate engineering line (qualified)

All dates verified from commit metadata; qualification evidence verified from
`F:\LightsOutQA` and `review/LO-CANDIDATE-QUAL-0b0b698-20261017`.

| Date | Commit | What it established |
| --- | --- | --- |
| 10-16 | `4c52470` | Secondary-readiness startup guard; platform alignment qualified |
| 10-16 | `df83ec9` | Local routine contracts + durable execution outcomes (claim-before-dispatch, truthful outcomes) |
| 10-16 | `4ab736a` | Leap-day recurrence fix across long calendar gaps (selected-month/day enumeration over Gregorian-cycle bound) |
| 10-16 | `44c9cf3` | Calendar action editing + delayed-ritual receipt correlation |
| 10-16 | `79af767` | Offline routine file exchange with reviewed local adoption (LO-RIE-1) — imported routine is data, not authorization |
| 10-16 | `0ec94c9` | Pinned-TLS routine transfer foundations + consent gates (LO-SDH-0) |
| 10-16 | `bf36a62` | mTLS provider verification fix across Electron providers |
| 10-16 | `347dbe4` | Protected identities + explicit local pairing inbox (LO-SDH-1) |
| 10-16 | `400f8c2` | Local light experiences (Hourglass/Orbit/Ember timer animations) + selected-app notification beacons |
| 10-17 | `4e7ee41` | Settings, timer-control and phone-lighting layout refinement |
| 10-17 | `1f6b345` | Studio redesign — desktop and phone interfaces |
| 10-17 | `5df7d6a` | Active-timer presentation + runtime checks |
| 10-17 | `0b0b698` | Tonight open-horizon redesign — candidate HEAD |

**2026-10-17 — Candidate qualification PASS** (`QUALIFICATION.json`, `RESULTS.md`):
100/100 Android JUnit · 0 lint errors (26 warnings) · isolated debug build
`com.lightsout.companion.debug` · API-35 emulator smoke (start/pause/resume/
cancel, owned `emulator-5582`) · 1,125/1,125 Windows unit · 299/299 Windows
smoke · packaged Windows acceptance checks · zero real power actions.
Explicitly NOT covered: physical phone, real bulb, production signing.

## October 18–20 — Post-candidate desktop tranche (in-flight, uncommitted)

| Date | Evidence | Content |
| --- | --- | --- |
| 10-18/19 | `docs/LO_FINAL_CLOSEOUT_1.md` (integration worktree, untracked) | 11.2.1-rc.3 desktop release candidate — timer-safety boundaries, Wi-Fi block/restore transaction serialization, expanded credential encryption, RC versioning. READY_FOR_GUARDED_ACCEPTANCE / PUBLIC_RELEASE_HOLD |
| 10-18 | `docs/POWER_ACTION_TRUTH.md` | Power-action evidence predicates (`timer_elapsed`…`outcome_unverified`); no `system_outcome_observed` transition yet |
| 10-18 | `docs/RELIABILITY_REPAIR_20261018.md` | Bounded unsaved-work scan, durable snooze deadline persistence, First Light delivery queueing |
| 10-18/19 | `F:\LightsOutQA\LO-RC5-*`, `LO-RC4-*`, `LO-RC3-*`, `LO-POWER-*` | Progressive desktop RC evidence lanes |
| 10-18+ | untracked `HandoffConnection.kt`, `HandoffCertificate.kt`, `HandoffCertificateTest.kt` (+ dirty edits to handoff files) | Real mTLS client tranche — uncommitted, unqualified |
| 10-20 | `F:\LightsOutQA\LO-RC5-HOST-ACCEPTANCE-1-20261020` | Latest dated evidence session before this directive |

## 2026-10-29 — Desktop reliability + candidate recovery

| Item | Commit | Content |
| --- | --- | --- |
| Autopilot survival layer | `72e20bc`, `72375e3` | learned-bedtime precedence, nightly re-arm, persisted arm, honest `missed` receipts, `LightsOut-AutopilotWatchdog` task, quit logging |
| Security | `7a1bcc3` | DEF-002 closed — router credentials re-validated at request path |
| Deps | `c7d85f7` | Electron 43.8.4 |
| Toolchain bump | `351be94` | Gradle 9.8.2 / AGP 9.5.0 / SDK 36 — **SUPERSEDED** for the Android subtree by the qualified candidate toolchain; retained in history |
| Android candidate recovery | (this tranche) | `companion-android/` integrated from `0b0b698` |

## Superseded / rejected / unresolved

- **Superseded**: pre-candidate toolchain (`351be94`), pre-Studio phone UI, `0..740` day-scan calendar algorithm (→ `4ab736a`).
- **Deferred by directive**: phone-owned First Light (scoped tranche, no implementation found on either line — report only), Windows Host unification.
- **Unresolved owner gates**: push/publication, RC3-line promotion, production signing, physical-device QA, Phase E PC-side handoff integration.
- **Correction to directive text**: the October candidates were 13 commits on `335ba77`, not a divergent fork; the "111 changed paths" figure matches `git diff 335ba77..0b0b698` (111 files).
