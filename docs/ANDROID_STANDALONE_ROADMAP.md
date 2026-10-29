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

### M1 — Re-qualify on `main` (next tranche, blocked on Android SDK)

The local Android SDK was removed; all Gradle execution is deferred to CI or
an SDK-equipped lane. Acceptance gate: `:app:testDebugUnitTest :app:lintDebug
:app:assembleDebug` green on the integrated tree, plus CI artifact upload.
Classification target: AUTOMATED_TESTED on the merge state.

### M2 — Emulator lifecycle re-run (needs SDK + owned AVD)

Re-run `android-standalone-lifecycle-proof.js` lanes (notification/exact-access
denial+grant, offline controls, monotonic countdown across timezone change,
stale service commands, process restart, screen-off completion, calendar
lane). Target: EMULATOR_TESTED on the integrated tree.

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

- **Android SDK absent locally** — the single largest qualification blocker;
  CI lane exists but cannot cover emulator/physical runs.
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
