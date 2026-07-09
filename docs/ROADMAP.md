# Lights Out PC™ — A Proof Foundry Product

# Roadmap

## Current Truth

Lights Out PC™ ("Bedtime Mode for Windows") is live at v10.4.0 — proof-first
software forged for builders.

Recent shipped milestones:

- v10.0.10 fixed a packaged-app startup crash (remoteControl.js was missing from the electron-builder file manifest) and corrected settings saves for WiFi Guard, Content Blocker, and Accountability.
- v10.1.0 shipped the northstar visual UI: cinematic Last Light "Exit the Grid" finale with UNPLUG confirm, Lobby "Tonight's Run" shell with icon sidebar, Morning Proof "Mission complete" hero with real stat pills, and settings persistence for all new UI state.
- v10.2.0 added Override Tax (escalating snooze cost) and Autopilot Bedtime.
- v10.3.0 added Ritual Mode and smarter wind-down intelligence, plus a hardened network layer (companion WebSocket frame codec, family LAN discovery parser, and wifiGuard input sanitizers all unit-tested).
- v10.4.0 shipped Phone Companion Easy Connect (QR pairing, token-gated remote
  actions, live connection status), profile search/filter/pin, and the 30-day
  sleep-history grid with streak-celebration modal.

Current strongest product promise:

```text
Lights Out helps Windows users stop drifting past bedtime by turning shutdown into a visible, repeatable routine with proof.
```

## The Proof Foundry Standard

> No fake claims. No missing receipts. Ship with proof.

## Product Pillars

### 1. Reliable Shutdown

The timer must always feel trustworthy.

Roadmap:

- Keep force shutdown explicit and never accidental.
- Improve cancellation, pause, snooze, and resume reliability.
- Keep tray behavior predictable.
- Keep updater links and release assets verified.

Proof gates:

- Start timer.
- Pause.
- Snooze.
- Cancel.
- Quit from tray.
- Relaunch.
- Build.
- Smoke tests.

### 2. Personal Wind-Down

Lights Out should feel like a nightly cockpit, not a generic timer.

Roadmap:

- Tonight's-mode cards for routines like Weeknight, Movie, Bedtime, Hard Stop, and Custom.
- ~~Better profile sorting and pinned favorites.~~ Shipped in v10.4.0 (search, category filters, pin-to-top).
- ~~Better visual state for active profile.~~ Shipped (`.profile-card.active` has dedicated styling, not just a bare class toggle).
- ~~Optional profile notes.~~ Shipped: a 280-char note per profile, editable inline in the Profiles modal or set at save time, shown as a 📝 badge + hover tooltip on the Library card.
- ~~Last-used routine memory.~~ Shipped: see the "Next" milestone below.

Proof gates:

- Create profile.
- Load profile.
- Auto-start profile if enabled.
- Export/import profiles.
- No layout break at normal window size.

### 3. Streaks And Accountability

The streak UI should make the habit visible without pretending to be medical sleep tracking.

Roadmap:

- Keep Streaks tab visible and clickable.
- ~~Add Home callout for current streak.~~ Shipped: `updateStreakCallout()` shows a 🔥-night-streak pill above Saved Profiles, hidden entirely at streak 0 (honest empty state), click-through to the Streaks tab.
- ~~Add timer-complete streak celebration.~~ Shipped in v10.4.0 (streak-celebration modal fires on milestone streaks; 30-day sleep-history grid with hover tooltips).
- ~~Add morning briefing streak summary.~~ Shipped: First Light sends `{events, sleepDebt, streaks}` from main, renderer shows a one-line "Good morning! N-night streak · next: X" toast and syncs the Home callout.
- Add a true weekly/monthly aggregate view (the 30-day grid + `getWeeklyReport()`'s on-time % cover part of this, but there's no dedicated trend view beyond 30 days).
- ~~Multiple recurring schedule rules ("set timers for certain things at certain times").~~ Shipped: the Schedule tab's built-in calendar now holds a list of independent rules (own label, time, active days, action, duration), not one global bedtime. Each rule synthesizes its own recurring calendar events (`calendarProviders.getDefaultCalendarEvents`); auto-start skips the bedtime-keyword filter for these since they're explicit user config, not ambient imported-calendar noise. Settings persisted before this shipped migrate automatically (single implicit rule from the old bedtime/days/action fields).

Avoid:

- Medical language.
- Sleep-quality diagnosis.
- Fake scores that are not backed by actual events.

Proof gates:

- Seed streak data.
- Display current streak.
- Display best streak.
- Display total nights.
- Display average bedtime.
- Verify all tabs switch.

### 4. Proof And Receipts

Lights Out should prove what happened.

Roadmap:

- ~~Improve receipt viewer.~~ Shipped 2026-07-09: rows were built from raw inline styles with no hover state and always-shown zero-value fields ("0p 0s" on every row). Rebuilt with real CSS classes per result type (icon + color-coded left border, mirroring the Morning Proof hero's icon vocabulary), a hover state, and meta chips that only show fields with real values (a 0-pause, 0-snooze run shows no clutter).
- ~~Add clearer proof copy.~~ Shipped 2026-07-09: both "Copy Proof" (single latest receipt) and the new "Export Ledger" were dumping the raw internal result code (`dry_run_completed`) and raw ISO timestamps (`2026-07-08T21:30:00.000Z`) straight into the clipboard text. Added a shared `humanizeReceiptResult()` ("Dry Run Completed") and proper `toLocaleString()` timestamp formatting, used by both.
- ~~Make copy-proof action more visible after completion.~~ Already shipped: "Copy Proof" is one of the labeled action buttons directly on the Morning Proof hero card, which is what greets the user right after a session completes -- as visible as it gets without being intrusive.
- ~~Export session proof.~~ Shipped 2026-07-09: the Receipts modal previously had no bulk export (only per-session "Copy Proof" for the latest run). Added `runReceipts.getAllReceiptsForExport()` (full stored ledger, not the display-limited `listReceipts()`) plus an "Export Ledger" button that copies a readable text summary of every stored receipt to the clipboard, mirroring the Streaks tab's existing export pattern.
- ~~Include release checksum verification instructions on landing page.~~ Shipped 2026-07-09: the landing page FAQ previously just pointed at `SHA256SUMS.txt` with no actual steps. Added the real `Get-FileHash` PowerShell command and how to compare it against the published checksum file.

This pillar's roadmap list is now fully shipped.

Proof gates:

- Start timer.
- Complete/cancel session.
- Receipt exists.
- Receipt can be viewed.
- Proof can be copied.
- Receipt does not overclaim.

### 5. Safe Remote Control

Remote control should be useful only when safe.

Roadmap:

- Keep remote control off by default.
- Keep pairing token required.
- Keep companion bound to `127.0.0.1` by default.
- Add clearer Remote Control settings copy.
- Later: trusted LAN mode with explicit warning and proof.

Proof gates:

- Default no listener.
- Enable generates token.
- Bad token rejected.
- Good token works.
- Regenerate revokes old token.
- Disable stops listener.

## Release Sequence

This section is a forward plan, not a version-number guarantee — actual shipped
versions have not matched the originally planned v10.2.0/v10.3.0 slots (those
shipped Override Tax/Autopilot and Ritual Mode instead). Treat item names as the
source of truth, not the version numbers attached to them.

### Shipped

- **v10.1.0 — Runtime Trust Polish**: northstar visual UI, cinematic Last Light "Exit the Grid" finale with UNPLUG confirm, Lobby "Tonight's Run" shell, Morning Proof "Mission complete" hero.
- **v10.2.0 — Override Tax + Autopilot**: escalating snooze cost, Autopilot Bedtime, settings UI, tray snooze cost label.
- **v10.3.0 — Ritual Mode + Intelligence**: guided ritual flow, Stats Dashboard, Smart Suggestions, Notification Center, plus a hardened network layer (companion WebSocket frame codec, family LAN discovery parser, wifiGuard input sanitizers, all unit-tested).
- **v10.4.0 — Phone Companion + Profiles + Streaks**: Phone Companion Easy Connect (QR pairing, token-gated remote actions, live connection status), profile search/filter/pin, 30-day sleep-history grid, streak-celebration modal, companion auto-firewall + system status.

### Next — Streaks & Profiles Follow-Through

Goal: finish what v10.4.0 started without fake wellness claims.

Most of this list turned out to already be shipped (verified 2026-07-09 by
reading + browser-preview-testing each item rather than trusting the stale
checklist below): tray regression tests exist in `scripts/smoke-test.js`,
updater status has a real `renderUpdaterStatus()` panel, session outcomes
already have distinct completed/dryrun/cancelled labels, the 30-day grid
already renders a `neutral` state for missed nights, the export-streaks
button and `streaks.exportData()` already exist, the Home streak callout and
morning-briefing summary are both shipped (see above), and the active-profile
card already has dedicated CSS. Keep this list current going forward instead
of letting it drift again.

~~Last-used routine memory (remember + surface the last-loaded profile distinctly from "currently active").~~ Shipped 2026-07-09: `profiles.apply()` stays pure, but the `profiles-apply` IPC handler stamps + persists `lastUsedAt` via `profiles.markUsed()`. The Profiles grid shows a "· last used" badge on the most-recently-applied profile, distinct from the in-session "active" highlight, so it's visible even right after an app restart.

~~A true weekly/monthly aggregate streak view beyond the 30-day grid.~~ Shipped 2026-07-09: `streaks.getTrend(granularity)` buckets the full stored event history (up to 365 days) by ISO week or calendar month. The Streaks tab has a new "Trends" section (Weekly/Monthly toggle) between the 30-day grid and Achievements.

~~Optional profile notes.~~ Shipped: see the Personal Wind-Down pillar above.

This milestone is now fully shipped -- nothing genuinely open remains here.
Next up is either the Proof And Receipts pillar's open items (below) or
v11.0.0.

Ship only if:

- Data is real event data.
- Empty state is honest.
- Seeded-data screenshots pass.

### v11.0.0 - Serious Night Mode ⟶ next

Goal: a full night shutdown cockpit for Windows power users.

Candidate work, surveyed 2026-07-09 against actual code/tests before touching
anything (most of this list turned out to already be satisfied, same lesson
as the "Next" milestone above -- keep re-checking before assuming a roadmap
line is still open):

- ~~Full-screen clock mode polish.~~ Shipped 2026-07-09: this genuinely did not
  exist (not "polish" of anything -- net-new). Reuses the existing main window
  (`mainWindow.setFullScreen()`, no second `BrowserWindow`, no multi-monitor
  picker): the CSS hides everything except the ring/analog clock and scales
  it up; exit via Esc or a corner button. Two real bugs only surfaced by
  actually running it (not by the wiring checks alone): the enter button's
  CSS class defaulted to `display:none`, so toggling the inline style to `''`
  silently fell back to hidden instead of showing it; and the exit button
  lived inside the transformed `.timer-section`, which turns a descendant's
  `position:fixed` into "fixed relative to that transformed ancestor" --
  the button was rendering scaled-up and mislocated instead of a normal
  36px icon in the screen corner. Both fixed; see `git log` for detail.
- Ambient visuals: already shipped pre-existing -- `ambientVisuals.js` is
  wired to a live Settings dropdown (`customization.ambientVisual`). No gap
  found.
- Calendar-based wind-down, "only if parser tests are strong": already
  satisfied -- 26 tests across `calendar-ics.test.js` + `calendarProviders.test.js`.
- Remote companion, "mature enough for real LAN use": already satisfied --
  reviewed and hardened in the Electron-hardening pass (Electron/electron-builder
  bump, LAN-facing surface audit: companion WebSocket server, family UDP
  discovery, wifiGuard) and separately in an earlier companion-remote
  security review. No further gaps found either time. The LAN phone PWA's
  plaintext-over-LAN / `0.0.0.0` bind / no-TLS posture is accepted-by-design
  for a same-network pairing flow, not an oversight.
- Smart light integration, "only if runtime-proven": **not shippable by an
  agent with no physical smart light to test against.** Code exists
  (`smartLights.js`: Hue + generic HTTP webhook) but has zero automated test
  coverage, and "runtime-proven" specifically means proof against real
  hardware -- claiming that without one would be exactly the kind of fake
  claim this app's own ethos forbids. Left alone; flagging honestly instead
  of faking it or quietly skipping it.

Ship only if:

- Manual runtime proof exists.
- No fake integrations.
- No unsafe remote defaults.

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

## Backlog Parking Lot

Good ideas, not immediate:

- Achievements.
- Weekly reports.
- Family profiles.
- Focus scoring.
- Screen-time limits.
- Recurring alarms.
- Content blocker schedules.

Reason to park: these are feature-expansion lanes. Do not start them until the existing nightly workflow feels airtight.
