# Lights Out PC™ — A Proof Foundry Product

# Roadmap

## Current Truth

Lights Out PC™ ("Bedtime Mode for Windows") is live at **v10.4.0** — the
latest tagged/published release. Proof-first software forged for builders.

**Merged to `main`, not yet tagged/released:** [PR #19](https://github.com/lazelife420-spec/Lights-out/pull/19)
(`claude/roadmap-followthrough`) closed out every open item from the
Streaks/Profiles and Proof & Receipts pillars, verified the Reliable
Shutdown pillar with live runtime proof (not just code review), shipped
full-screen clock mode, clarified Remote Control's settings copy, and
opened the Backlog Parking Lot with recurring content-blocker schedules.
Full detail lives in the PR description and commit history; a summarized
version graduates into `CHANGELOG.md` when this is actually built, tagged,
and released.

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

**Status:** verified airtight 2026-07-09 with live runtime proof (forced
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

**Status:** fully satisfied. No open items.

Proof gates: create profile, load profile, auto-start profile if enabled,
export/import profiles, no layout break at normal window size.

### 3. Streaks And Accountability

The streak UI should make the habit visible without pretending to be
medical sleep tracking.

**Status:** fully satisfied. No open items.

Avoid (timeless guardrail, not a task list):

- Medical language.
- Sleep-quality diagnosis.
- Fake scores that are not backed by actual events.

Proof gates: seed streak data, display current/best streak, display total
nights, display average bedtime, verify all tabs switch.

### 4. Proof And Receipts

Lights Out should prove what happened.

**Status:** fully satisfied. No open items.

Proof gates: start timer, complete/cancel session, receipt exists, receipt
can be viewed, proof can be copied, receipt does not overclaim.

### 5. Safe Remote Control

Remote control should be useful only when safe.

**Status:** fully satisfied. No open items.

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

### v11.0.0 — Serious Night Mode (in progress)

Goal: a full night shutdown cockpit for Windows power users.

**Shipped:** full-screen clock mode — reuses the main window, hides all
chrome, scales the analog clock to read from across a room. Trusted LAN
mode — see Pillar 5 above.

**Descoped from v11.0.0, 2026-07-09:**

- **Smart light integration.** Code exists (`smartLights.js`: Hue +
  generic HTTP webhook) but has zero test coverage, and "runtime-proven"
  means proof against real hardware — which no agent working on this repo
  has access to. Rather than ship an unproven integration under a
  proof-first brand, it's parked until either a physical smart light is
  available to test against, or there's an explicit product call to ship
  it as an unverified/experimental feature (which would need its own
  honest labeling). Not deleted — just not claimed as done.

Ship only if: manual runtime proof exists, no fake integrations, no unsafe
remote defaults.

### v12.0.0 — Candidates (not yet prioritized)

The Backlog Parking Lot — good ideas, not yet scoped. **Not ordered** — this
is a menu, not a plan, until there's a product-priority call on which one
(if any) goes next. Each carries different risk. Reason all of these are
parked rather than started: they're feature-expansion lanes, and the
existing nightly workflow's reliability only just got affirmatively
verified (see Pillar 1) rather than assumed — these are genuine
scope-expansion decisions, not a continuation of already-declared work.

**Shipped 2026-07-09: Weekly reports.** A plain-text narrative summary (`streaks.js`'s
`buildWeeklyNarrative`, fed by the existing `getWeeklyReport()` data — no new
persistence layer) shown under a "This Week" section on the Streaks tab, with
a one-click "Copy Report" to clipboard. Every sentence is a direct readout of
an already-computed field (nights logged, streak, consistency, snooze rate,
action breakdown, achievement count) — no scoring or diagnosis layered on
top, consistent with the Streaks pillar's no-fake-scores guardrail.

| Candidate | Why it's not started |
|---|---|
| Family profiles | Vague as written ("Family profiles.") — could mean syncing saved profiles across paired Family Mode peers, or something else entirely. Needs product intent before scoping. |
| Focus scoring | Would need a new persistence layer (Focus Sessions currently has no historical event log, unlike Streaks). Also carries messaging risk against the "no guaranteed productivity" brand promise — needs the same care Sleep Score got to avoid gamification/fake-score framing. |
| Screen-time limits | `screenTime.js` today is read-only/advisory (a "reality check" message), not enforcement. Actual *limits* imply a new blocking mechanism — real system-modification risk, same category as content-blocker schedules but with a different (unbuilt) trigger. |
| Recurring alarms | Possible overlap with the Schedule tab's existing multi-rule recurring system — needs a check for what's actually missing before scoping, same lesson as the 2026-07-09 pass caught elsewhere. |

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
