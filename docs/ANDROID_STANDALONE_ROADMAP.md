# Lights Out Android Standalone — Roadmap

Forward plan for the phone-owned product. The phone must work with the PC off,
no account, no cloud. Classification vocabulary is defined at the bottom — no
claim may exceed its evidence class.

## Now on `main` (LOCAL_COMMITTED, previously AUTOMATED_TESTED on candidate tree)

- Native countdown: start/pause/resume/extend/cancel, foreground service,
  AlarmManager finish delivery, visible finish notification, durable store.
- Native calendar: weekly/monthly/date rules, selected months, last-day and
  leap-day scheduling, DST handling, duplicate-occurrence protection, reboot
  and timezone restoration, editable actions.
- Native routines: saved durations, optional lighting behavior, snapshot of
  active-run config, routine survives lighting failure.
- Direct WiZ lighting: UDP 38899 phone→bulb, local only, bounded ACKs.
- Local light experiences: Hourglass / Orbit / Ember timer animations,
  screen-only preview, selected-app notification beacons (opt-in listener).
- Routine interchange (LO-RIE-1): versioned schema, offline file exchange,
  preview-before-import, explicit inactive adoption — an imported routine is
  data, not authorization.
- Secure handoff foundations (LO-SDH-0/1): pinned-TLS transfer primitives,
  protected identities, pairing inbox with consent gates. Source-present on
  Android and Desktop, **release-gated OFF** (`ReleaseGates.HANDOFF_PAIRING = false`
  and `electron/releaseGates.js`) until cross-device TLS qualification passes
  (pairing UI hidden, Android `lightsout-handoff://` deep link omitted, native
  bridge and desktop IPC refuse handoff calls).
- Studio phone UI + Tonight open-horizon presentation.
- Optional PC Controls: isolated pairing + WebView control of a paired PC.

## Milestones

### M1 — Re-qualify on `main` — **DONE 2026-10-29** (AUTOMATED_TESTED)

`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` green at `62edc05`
in an isolated provisioned SDK (see `ANDROID_STANDALONE_QUALIFICATION.md`).
100/100 JUnit, 0 lint errors, debug APK produced.

### M1.5 — Play-target modernization — **SOURCE-MODERNIZED 2026-11-22**

The current checkout uses Gradle 8.14.6, AGP 8.13.2, Kotlin 2.3.21,
`compileSdk`/`targetSdk` 36, and CameraX 1.6.2. A 2026-11-22 isolated
API 36 build is green: 107 unit tests, lint and debug APK packaging pass.
This does not replace emulator, physical-device, Play signing, or distribution
qualification. Historical API 34 evidence remains useful provenance, but it
is not the only current toolchain claim.

CameraX 1.6.2 is the source-mitigated 16 KB native-library configuration.
The packaged `.so` set still requires an APK/page-size inspection and emulator
or physical validation before a strict 16 KB compatibility claim.

### M2.5 — Expanded emulator-only qualification — **DONE 2026-10-29** (EMULATOR_MAXIMIZED)

Second emulator `LightsOut_QA_API36` provisioned in the isolated SDK; both
lifecycle+calendar lanes rerun green on API 35 **and** API 36 with the same
`9c6dcb1`-bound debug APK (targetSdk 34 compat on the newer platform — not
Play-readiness). Deep lanes on API 35: isolated WiZ UDP simulation 13/13
(success/failure/timeout/discovery/mixed-targets/public-IP fail-closed),
routine-interchange security 15/15 (malformed/oversized/dup/future-version/
conflict policies/inert-import gating), UI audit with a verified 44px
touch-target fix (`9c6dcb1`), and advanced lifecycle evidence (cold boot,
Doze, app standby, force-stop, exact-alarm revocation). Full evidence in
`ANDROID_STANDALONE_QUALIFICATION.md` §M3.

### M2 — Emulator lifecycle — **DONE 2026-10-29** (EMULATOR_TESTED)

Both `android-standalone-lifecycle-proof.js` lanes green on owned
`LightsOut_QA_API35` (API 35): lifecycle 6/6, calendar 6/6, source inputs
re-verified, emulator state restored. Evidence and limits in
`ANDROID_STANDALONE_QUALIFICATION.md` (incl. byte-level APK reproducibility
finding: not bitwise reproducible; D8 ordering variance only).

### M3 — Handoff client completion (gated OFF until qualified)

`HandoffConnection.kt` and `HandoffCertificate.kt` are source-present in the
checkout, and the entire LO-SDH-1 pairing surface is release-gated OFF via
`ReleaseGates.HANDOFF_PAIRING = false` (pairing UI hidden and unmounted,
`lightsout-handoff://` deep link omitted from `AndroidManifest.xml`, and
`HomeActivity` refusing every `handoff` bridge call). Flip the gate only after:
(a) cross-device Android-to-Electron TLS qualification passes, (b) its own
qualification tranche is recorded, and (c) explicit consent/inactivity defaults
are verified — received routines activate nothing silently. Keep every handoff
feature inert unless the user explicitly pairs.

### M4 — Physical-device qualification (owner phone, e.g. S23-class)

`docs/ANDROID_FIELD_QA.md` checklist on real hardware: Doze/battery
restrictions, exact-alarm revocation, notification denial, reboot restore,
timezone/DST, Wi-Fi loss mid-routine, real WiZ bulb behavior, app-update
data retention, force-stop honesty. Debug package only — production app and
keystore are never touched. Target: PHYSICAL_DEVICE_PROVEN per item.

### M5 — PC-side handoff integration (gated OFF, owner-gated)

Desktop `electron/handoff*` modules are source-present in the checkout and
mirrored behind `electron/releaseGates.js` (`HANDOFF_PAIRING = false` — pairing
UI hidden and unmounted, `handoffService`/`handoffConnection` TLS listener never
initialized, and `handoff-action` IPC refusing every call). Enabling it in a
shipping build requires LO-SDH-1 qualification and owner approval.

### M6 — Phone-owned First Light — **EMULATOR_TESTED 2026-11-25**

Native phone-owned morning wake reminder + optional direct local WiZ sunrise
ramp (`PhoneFirstLightModel.kt`, `PhoneFirstLight.kt`, wired into
`PhoneHomeStore.kt`, `PhoneTimerService.kt`, `PhoneTimerStore.kt`,
`HomeActivity.kt`, and the Schedule tab of `assets/phone/*`). Defaults OFF,
works with the PC off, requires Alarms & reminders access and the phone powered
on (never claims powered-off wake or medical benefits), enforces private-LAN
WiZ IPv4 guardrails, yields cleanly on manual off / Stop sunrise, and preserves
`ReleaseGates.HANDOFF_PAIRING = false`. Isolated API-36 QA build (117/117 JUnit,
lint pass, debug APK) and headless API-36 emulator verification (lifecycle 6/6,
calendar 6/6, live WebView CDP First Light + 320px/200% 0-overflow check, native
`lightsout://phone-first-light` PendingIntent, live AlarmManager firing into a
loopback WiZ UDP fixture with single ongoing notification ID 41 and immediate
Stop sunrise teardown) passed. Physical phone, OEM battery manager, and physical
WiZ bulb sunrise reliability remain `ANDROID_FIELD_QA.md` items.

### M7 — Release engineering (owner-gated throughout)

Production signing with the existing release keystore, update-continuity
testing, distribution decision (store vs direct), release receipts.
Publication is never agent-performed.

## Dependencies and risks

- **Android SDK provisioned at `F:\LightsOutQA\M1-Integrated-20261029\sdk`**
  (isolated; M1 green). Emulator lanes (M2) additionally need a system image +
  owned AVD. The registered checkout's ~868 untracked historical evidence
  files are preserved — no cleanup.
- **Remote CI cannot qualify local commits** — it checks out what is on
  `origin`. Local SDK lanes or a separately authorized candidate-branch push
  are the only paths; not an unrestricted production push.
- **Worktree B dirty state** — Oct 18–20 desktop tranche is uncommitted and
  unqualified; it must not be cleaned or silently promoted.
- **Toolchain regression risk** — the current checkout was modernized to Gradle
  8.14.6 / AGP 8.13.2 / Kotlin 2.3.21 / compileSdk & targetSdk 36 / CameraX 1.6.2
  (from the historical Gradle 8.7 / AGP 8.5.2 / compileSdk 34 candidate); any
  further toolchain bump re-opens the verification matrix.
- **Android OS limits** — force-stop cannot be overridden; OEM battery
  managers vary; document, don't promise.
- **WiZ is best-effort LAN UDP** — never claim fixture results are physical
  bulb proof.

## Acceptance classification vocabulary

`DESIGN_ONLY` < `SOURCE_PRESENT` < `LOCAL_COMMITTED` < `PUBLIC_COMMITTED` <
`AUTOMATED_TESTED` < `PACKAGED_TESTED` < `EMULATOR_TESTED` <
`PHYSICAL_DEVICE_PROVEN` < `PUBLIC_RELEASED`; `DEFERRED`/`BLOCKED` orthogonal.
Claims: PROVEN / SUPPORTED / INFERENCE / UNKNOWN.
