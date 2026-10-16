# Lights Out PC™ — A Proof Foundry Product

# Roadmap

## Current Truth

The **v11.2.0 release scope is qualified**. The five original product
pillars are implemented. This release closes the October desktop/settings/WiZ
work and reconciles the existing Android source; parked features remain outside
its scope. Published version and downloadable artifacts are authoritative on
[GitHub Releases](https://github.com/lazelife420-spec/Lights-out/releases/latest).

Source committed, automated tests passed, packaged runtime qualified, release
published and physical-device reliability proven are separate claims. The release
pipeline requires Linux and Windows tests, Android debug tests/lint/build,
packaged Windows runtime checks, installer/portable verification and checksums.
Android production APK signing is separate. WiZ remains opt-in/experimental;
emulator and UDP stand-ins do not establish physical phone/router/bulb reliability.
The [v11.2.0 qualification record](RELEASE_QUALIFICATION_11.2.0.md) links the
automated gates and describes the native desktop, Android and artifact evidence.
Current strongest product promise:

```text
Lights Out helps Windows users stop drifting past bedtime by turning shutdown into a visible, repeatable routine with proof.
```

## The Proof Foundry Standard

> No fake claims. No missing receipts. Ship with proof.

## Roadmap Hygiene

This document's only job is **what's next** — not an audit trail of
everything ever done. Keep it that way:

- When an item ships: **delete its line**, don't strike it through and
  leave a paragraph of detail behind. The detail belongs in the PR
  description now, and in `CHANGELOG.md` once a release is cut.
- Before starting work on any line here, verify it's still actually open —
  re-read the code, don't trust the checklist. This document drifted out of
  sync with reality multiple times before the 2026-07-09 pass caught it
  (see `docs/ROADMAP_ARCHIVE_2026-07.md` for exactly what that looked like
  and how it was found).
- If you're an agent picking up this file cold: the archive is provenance,
  not instructions. Don't re-verify things it already verified unless the
  code has changed since.

## Product Pillars

### 1. Reliable Shutdown

The timer must always feel trustworthy.

**Historical runtime proof:** verified 2026-07-09 (forced
dry-run throughout — never a real power action): start/pause/resume/
snooze/cancel, natural dry-run completion, and crash-recovery-on-relaunch
(kill the process mid-timer, relaunch, confirm the recovery banner reads
the persisted snapshot correctly) all confirmed working. No open items.

**Ongoing commitment**, not a task list:

- Force shutdown stays explicit and never accidental.
- Tray behavior stays predictable.
- Updater links and release assets stay verified.
- Any change that touches the timer/pause/snooze/cancel/recovery loop gets
  re-verified live before merge, not just unit-tested.

Proof gates: start timer, pause, snooze, cancel, quit from tray, relaunch,
build, smoke tests.

### 2. Personal Wind-Down

Lights Out should feel like a nightly cockpit, not a generic timer.

**Feature scope:** implemented; v11.2.0 qualification passed.

Proof gates: create profile, load profile, auto-start profile if enabled,
export/import profiles, no layout break at normal window size.

### 3. Streaks And Accountability

The streak UI should make the habit visible without pretending to be
medical sleep tracking.

**Feature scope:** implemented; v11.2.0 qualification passed.

Avoid (timeless guardrail, not a task list):

- Medical language.
- Sleep-quality diagnosis.
- Fake scores that are not backed by actual events.

Proof gates: seed streak data, display current/best streak, display total
nights, display average bedtime, verify all tabs switch.

### 4. Proof And Receipts

Lights Out should prove what happened.

**Feature scope:** implemented; v11.2.0 qualification passed.

Proof gates: start timer, complete/cancel session, receipt exists, receipt
can be viewed, proof can be copied, receipt does not overclaim.

### 5. Safe Remote Control

Remote control should be useful only when safe.

**Feature scope:** implemented; v11.2.0 qualification passed.

**Trusted LAN mode, decided and shipped 2026-07-09:** "trusted" means an
explicit, informed choice at the moment of exposure, not a new
device-identity system. Enabling "Connect Phone" (the `wifi` mode that
binds `0.0.0.0` and opens the firewall — see `startRemoteControl` in
`main.js`) now gates behind a warning modal
(`#lan-warning-modal`/`showLanWarningModal` in
`renderer-family-remote.js`) that states plainly what's exposed (any
device on the Wi-Fi network with the pairing code can start/pause/snooze/
cancel) and what stays off-limits (never a forced shutdown/logout/
hibernate, regenerating the code revokes access instantly). Per-device
allowlisting and longer-lived tokens were considered and explicitly
declined for v1 of this: the app is a single-user LAN control surface
already gated by network membership + a shared pairing token, and adding
per-device identity would be new security-model surface without a clear
user story yet. Revisit only if a concrete need shows up (e.g. multiple
household members each wanting independent revocation).

**Critical bug found + fixed 2026-07-09 via live device testing:** physically
paired an Android phone (the real `companion-android` release build, not a
simulation) against a running desktop instance over LAN, and the phone
never got past "Connecting…" — for any token, on any network. Root cause:
`electron/companion.html` had two unguarded dead DOM references
(`#pair-reset`, then `#disconnected`/`#disconnected-msg`) left behind by
separate past markup redesigns; each threw an uncaught TypeError that
silently aborted the page's top-level script, meaning `connect()` never
even ran. This made the entire phone companion feature non-functional for
every user, regardless of correct setup, for as long as those dead
references have been on `main`. Fixed by deleting the dead code (the
status pill and automatic `scheduleReconnect()` already cover what the
removed UI provided). Re-verified end-to-end after the fix: real phone,
real desktop, real WebSocket, "Connected to `<hostname>`" with live state.
No APK rebuild needed for already-installed phones — `companion-android`
loads `companion.html` live from the desktop on every connection.

**Ongoing commitment:** remote control stays off by default, pairing token
stays required, companion stays bound to `127.0.0.1` by default.

Proof gates: default no listener, enable generates token, bad token
rejected, good token works, regenerate revokes old token, disable stops
listener, enabling `wifi` mode is blocked until the warning is explicitly
confirmed (verified live in-browser: Cancel leaves the mode off and never
calls `setRemoteControlMode`; Confirm calls it with `'wifi'`).

## Release Sequence

Item names are the source of truth, not the version numbers attached to
them — actual shipped versions have repeatedly not matched what was
originally planned for that slot.

### Shipped

- **v10.1.0 — Runtime Trust Polish:** northstar visual UI, cinematic Last
  Light "Exit the Grid" finale, Lobby "Tonight's Run" shell, Morning Proof
  "Mission complete" hero.
- **v10.2.0 — Override Tax + Autopilot:** escalating snooze cost, Autopilot
  Bedtime.
- **v10.3.0 — Ritual Mode + Intelligence:** guided ritual flow, Stats
  Dashboard, Smart Suggestions, Notification Center, hardened network
  layer.
- **v10.4.0 — Phone Companion + Profiles + Streaks:** Phone Companion Easy
  Connect, profile search/filter/pin, 30-day sleep-history grid,
  streak-celebration modal.
- **v11.0.0 — Serious Night Mode:** full-screen clock mode, Trusted LAN
  mode's explicit warning gate (see Pillar 5), Weekly Reports, and a fix
  for a critical bug where the phone companion never actually connected
  for anyone (dead DOM references crashing `companion.html` on load —
  found via live device testing, not code review). Smart light integration
  was explicitly descoped from this release: code exists (`smartLights.js`:
  Hue + generic HTTP webhook) but has zero test coverage, and
  "runtime-proven" means proof against real hardware, which no agent
  working on this repo has access to. Not deleted — just not claimed done.
  Parked until either real hardware is available, or there's an explicit
  product call to ship it labeled experimental.
- **v11.0.1 — Windows Production Readiness:** window movement/geometry,
  companion recovery diagnostics, family identity attribution, profile
  accents, media-volume correction, and clean lint/runtime proof.
- **v11.1.0 — Night Modes Library:** six declarative cards, four ready modes,
  canonical main-process resolution, safe lobby arming, receipt attribution,
  static-preview support, and real Electron runtime proof.

### v12.0.0 — Candidates (not yet prioritized)

The Backlog Parking Lot — good ideas, not yet scoped. **Not ordered** — this
is a menu, not a plan, until there's a product-priority call on which one
(if any) goes next. Each carries different risk. Reason all of these are
parked rather than started: they're feature-expansion lanes, and the
existing nightly workflow's reliability only just got affirmatively
verified (see Pillar 1) rather than assumed — these are genuine
scope-expansion decisions, not a continuation of already-declared work.

| Candidate | Why it's not started |
|---|---|
| Family Profiles v1 | Scoped as a local-only household member directory, profile assignment/filtering, and canonical receipt attribution. LAN sync, authentication, and remote profile mutation are explicitly out of scope. See `docs/FAMILY_PROFILES_V1_SCOPE.md`. |
| Focus scoring | Would need a new persistence layer (Focus Sessions currently has no historical event log, unlike Streaks). Also carries messaging risk against the "no guaranteed productivity" brand promise — needs the same care Sleep Score got to avoid gamification/fake-score framing. |
| Screen-time limits | `screenTime.js` today is read-only/advisory (a "reality check" message), not enforcement. Actual *limits* imply a new blocking mechanism — real system-modification risk, same category as content-blocker schedules but with a different (unbuilt) trigger. |

**Checked and dropped, 2026-07-10: "Recurring alarms."** Confirmed fully
redundant with the Schedule tab's existing multi-rule builtin calendar
(`calendarProviders.js`'s `normalizeScheduleRules`/`getDefaultCalendarEvents`,
UI in `index.html`'s `#schedule-rule-form`): named rules, a time, a
per-weekday toggle grid, an action (shutdown/sleep/hibernate), and a
duration are all already there and already shipped. There was never a
distinct feature here to build — just a naming mismatch between the
backlog entry and what had already shipped under "Schedule." Not
re-scoping; removing it.

## Brand Promise

Proof-first software forged for builders.

- Direct
- Confident
- Evidence-backed
- Practical
- No hype
- No fake AI claims
- No medical sleep claims
- No guaranteed productivity/sleep claims
