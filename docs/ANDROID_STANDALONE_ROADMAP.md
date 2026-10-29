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
  protected identities, pairing inbox with consent gates. Phone half only.
- Studio phone UI + Tonight open-horizon presentation.
- Optional PC Controls: isolated pairing + WebView control of a paired PC.

## Milestones

### M1 — Re-qualify on `main` — **DONE 2026-10-29** (AUTOMATED_TESTED)

`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` green at `62edc05`
in an isolated provisioned SDK (see `ANDROID_STANDALONE_QUALIFICATION.md`).
100/100 JUnit, 0 lint errors, debug APK produced.

### M1.5 — Play-target modernization (separate tranche — do NOT mix with baseline)

The recovered baseline (Gradle 8.7 / AGP 8.5.2 / Kotlin 1.9.24 / API 34) is the
qualified configuration but is **not Google Play release-ready**: Play requires
API 36+ for ordinary new apps and updates (extensions aside), and AGP 8.5
officially supports max API 34. Direct APK distribution has different rules.
A modernization tranche must re-verify independently: AGP + Gradle + Kotlin
upgrade, `compileSdk`/`targetSdk` 36, API 36 behavior changes (foreground
services, exact alarms, notification permissions), AndroidX/CameraX/ML Kit
compatibility, and **16 KB native-library page-size alignment** inside the
packaged APK (inspect the real `.so` set — ML Kit ships native code). Baseline
evidence remains the fallback reference. The M3-max audit now has a concrete
result for this item: `libimage_processing_util_jni.so` is 4096-aligned on
every ABI including arm64-v8a/x86_64 — dependency modernization required.

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

### M3 — Handoff client completion (candidate worktree B)

Promote `HandoffConnection.kt`/`HandoffCertificate.kt` + dirty handoff edits
only after: (a) file-level diff against the qualified base, (b) its own
qualification tranche, (c) explicit consent/inactivity defaults verified —
received routines activate nothing silently. Keep every handoff feature
inert unless the user explicitly pairs.

### M4 — Physical-device qualification (owner phone, e.g. S23-class)

`docs/ANDROID_FIELD_QA.md` checklist on real hardware: Doze/battery
restrictions, exact-alarm revocation, notification denial, reboot restore,
timezone/DST, Wi-Fi loss mid-routine, real WiZ bulb behavior, app-update
data retention, force-stop honesty. Debug package only — production app and
keystore are never touched. Target: PHYSICAL_DEVICE_PROVEN per item.

### M5 — PC-side handoff integration (Phase E, owner-gated)

Merge/reconcile `electron/handoff*`, `electron/routine*`, `lightExperience.js`,
Studio desktop surface against current `main` desktop, with merge-state
qualification. Requires owner approval — it changes the shipping desktop.

### M6 — Phone-owned First Light (scoped)

Native morning alarm/reminder + optional local WiZ sunrise. No Windows
dependency, no medical claims, no powered-off-wake claims. Design + authority
check before implementation.

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
- **Toolchain regression risk** — candidate built on Gradle 8.7/AGP 8.5.2/
  compileSdk 34; any bump re-opens the whole verification matrix.
- **Android OS limits** — force-stop cannot be overridden; OEM battery
  managers vary; document, don't promise.
- **WiZ is best-effort LAN UDP** — never claim fixture results are physical
  bulb proof.

## Acceptance classification vocabulary

`DESIGN_ONLY` < `SOURCE_PRESENT` < `LOCAL_COMMITTED` < `PUBLIC_COMMITTED` <
`AUTOMATED_TESTED` < `PACKAGED_TESTED` < `EMULATOR_TESTED` <
`PHYSICAL_DEVICE_PROVEN` < `PUBLIC_RELEASED`; `DEFERRED`/`BLOCKED` orthogonal.
Claims: PROVEN / SUPPORTED / INFERENCE / UNKNOWN.
