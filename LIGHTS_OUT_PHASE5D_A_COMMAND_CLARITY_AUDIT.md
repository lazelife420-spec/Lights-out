# Lights Out — Phase 5D-A: Menu + Command Clarity Audit

Read-only audit. No code changed. Checkpoint: `4682519`, working tree clean.
Every claim below is grep/read-verified against `electron/index.html`,
`electron/renderer.js`, `electron/renderer-profiles.js`,
`electron/renderer-ritual-focus.js`, and `electron/styles.css` directly.

---

## 1. Exact redundancy list

Three things claim to be "where commands live" at once, and some individual
concerns are triplicated:

| Concern | Lives in (all at once) |
|---|---|
| Phone Companion setup | Devices card CTA (`btn-dev-companion`) **+** Settings → Phone Companion **+** a third footer shortcut, `#btn-companion` (`🔥📱 Open companion setup`, footer-right) — **three separate entry points to the same destination** |
| Power actions | Top menu → Power dropdown (Shutdown/Restart/Sleep/Hibernate) **+** Settings → Power & Safety (Action Type select, same four options plus Log Out) — two places to set "what happens," not obviously connected |
| Dry Run toggle | Top menu → Quick Toggles dropdown (`toggle-dryrun`) **+** Settings → Power & Safety (`chk-dryrun` checkbox) — same setting, two controls, neither references the other |
| "Start something on Tonight" | Duration chips (instant-start) **+** Quick Plans/profile cards (load-only, confirmed in Phase 5B-A) **+** Start Custom Timer **+** Begin Ritual — four visually-similar entry points with different real behavior, only the chips and Quick Plans are actually disambiguated by copy today (Phase 5B-A) |
| Profile creation vs. profile management vs. data import/export | All three live in one modal body (`#profiles-modal`): a save form (name/type/avatar/accent/notes), a searchable/filterable list of existing profiles, **and** 4 import/export buttons (Export Profiles / Import Profiles / Export All Data / Import All Data), stacked top to bottom with no visual separation beyond section headers |
| "Where is the app's real safety state" | Footer status pill (`#status-text`, bottom-left, shows "Dry Run" only when dry-run is on, otherwise just "Idle" — never a positive "Live") **+** Quick Toggles dropdown (same `state.dryRun`, different label: "Dry Run Mode ON/OFF") **+** nowhere on Home/Tonight's primary summary — confirmed no single element says "LIVE" or "DRY RUN" with equal visual weight in both directions |

## 2. Proposed new top-menu / command model

Current: `Power | Quick Toggles | Info`, three flat dropdowns, real
functionality in each (verified — this isn't decorative chrome), but no
visual hierarchy and the single most important fact (dry-run vs. live) is
one small word in one of three dropdowns.

Proposed replacement — three items, same interaction pattern
(click-to-open dropdown, already accessible via existing `wireTopMenus()`
keyboard support), different content:

```
[● DRY RUN]  Commands  Help
```
or, when live:
```
[● LIVE]  Commands  Help
```

- **Status** (leftmost, replaces nothing — new): a single always-visible
  pill showing DRY RUN or LIVE, colored distinctly (e.g. neutral for dry
  run, a clear accent for live). Clicking it opens the same Quick
  Toggles-style dropdown (Dry Run Mode / Sound Effects / Graceful Close),
  so no functionality is removed, just given a visible home and a name
  that says what it actually is instead of "Quick Toggles."
- **Commands** (replaces Power): Shutdown/Restart/Sleep/Hibernate stay
  here — but only as a manual override rail, not the primary way to start
  a session (that's Tonight, as it already mostly is). Naming this
  "Commands" instead of "Power" acknowledges it's the one remaining
  legitimate global-menu concern once Status is split out.
- **Help** (replaces Info): unchanged destination (Documentation /
  Keyboard Shortcuts / Version & Updates), renamed to match what it is.

This does not remove the footer's `#status-pill` (session-state indicator:
Idle/Running/Paused/outcome) — that's a different, complementary concern
(what's happening right now) from the top-menu Status pill (what mode
you're in). Both stay, now with clearer, non-overlapping jobs.

## 3. Proposed Tonight command model

Current, in DOM order inside `#setup-controls` + `#profiles-section`:
duration stepper → **unlabeled** chips (5m/15m/30m/45m/1h/2h, instant-start)
→ Start Custom Timer → Begin Ritual → (below, in "Also tonight") Quick
Plans header → Save as Profile / gear → profile cards (load-only).

Proposed:

```
Instant Start
5m · 15m · 30m · 45m · 1h · 2h
(unchanged behavior — still starts immediately; renamed section only)

Start Custom Timer
Begin Ritual

── Also tonight ──

Saved Plans                              [Manage Plans ⚙]
Movie Night · Quick Nap · Work Focus · Hard Stop
(unchanged behavior — still loads, doesn't start)
```

Changes: rename "Quick Plans" → "Saved Plans" (frees up "Quick" to mean
one thing — the instant-start chips); add a section label "Instant Start"
above the chips row (today they're unlabeled, identified only by the
Phase 5B-A hint text below them); move "Save as Profile" off the primary
row and fold it into the same "Manage Plans" gear that already opens
`#profiles-modal` — one button instead of two doing overlapping jobs (save
+ manage were always the same modal, just two separate entry points into
it today).

No change to `startTimer`, `applyProfile`, `startTonightPlan`, or any
timer/power call — this is copy and layout only, per the existing
Phase 5B-A precedent of not touching the engine for a clarity pass.

## 4. Proposed Settings / Profile modal simplification

**`#profiles-modal`** (Save Profile modal): split into two states within
the same modal rather than three concerns stacked in one scroll:

```
Tab: Save Current Plan          Tab: Manage Saved Plans
- Name                          - search / filter
- Type                          - list (reorder, load, delete)
- Notes                         - Import / Export (moved here,
- Save                            out of the primary save flow)
```

Drop the Avatar field's emoji example (`placeholder="e.g., A or 🌙"`) and
the 📌 emoji on the "Pinned" filter chip — both are new-copy-adjacent
enough to fix in the same pass as the rest of this audit's emoji findings,
consistent with the no-emoji direction already established for
Home/Library/Tonight.

**Settings modal**: not a full rewrite this pass (per your own scoping).
Short-term, bounded fix: General's category currently has exactly one
checkbox ("Run at login") in the same panel size as every other category
— either merge General into another category's rail entry, or accept it
stays sparse and add real content (a "what happens when Windows starts"
summary) so it doesn't read as broken/empty. Smart Lights' Discover →
Register → Load Groups → Test Connection sequencing gap is real (found in
the original wiring audit) but is explicitly Phase 5B-B's job, not this
pass's.

**Ritual overlay** (`#ritual-overlay`): all 5 step icons are raw emoji
(`💨` breathe, `🚫` block, `🌙` dim, `⏰` timer, `💡` lights) at 32px —
this is very likely the "giant hand/emoji-style icon" the video is
reacting to (💨 renders as a gust/swoosh shape in several fonts, which at
that size can read as an odd hand-like blob). Proposed: swap to the same
SVG stroke-icon family already used in the sidebar/`NS_MODE_ICONS`, sized
consistently with the rest of the app. Button labels are already dynamic
(`Skip` / `Next` or `Done` on the last auto step / `Cancel Ritual`) — the
video's read of them as "unclear together" is a visual-weight problem
(three buttons of different importance styled similarly), not a wording
problem; proposed fix is hierarchy (Next/Done primary, Skip secondary,
Cancel Ritual small/muted, already closest to this today) not a rename.

## 5. Files expected to change for implementation (Phase 5D proper, not this audit)

- `electron/index.html` — top menu markup, Tonight section labels/layout,
  `#profiles-modal` tab split, ritual overlay icon markup
- `electron/renderer.js` — top menu status-pill wiring, footer `#btn-companion` removal/redirect (collapse the third companion entry point into the existing Devices/Settings ones)
- `electron/renderer-profiles.js` — profiles-modal tab switching logic
- `electron/renderer-ritual-focus.js` — icon lookup swapped from `RITUAL_ICONS` emoji map to SVG
- `electron/styles.css` — new top-menu Status pill styling, profiles-modal tabs, ritual icon sizing
- `electron/scripts/smoke.js` — assertions updated for renamed sections/removed redundant entry point
- new QA capture script, same pattern as prior passes

No `main.js`, IPC, timer/power/schedule-execution, or Phone Companion
runtime files anticipated.

## 6. Risks / non-goals

**Risks if implemented carelessly:**
- Renaming "Quick Plans" → "Saved Plans" touches copy that smoke.js may assert on by exact string — needs a deliberate find-and-update pass, not a silent rename.
- Collapsing the footer `#btn-companion` shortcut removes a working entry point — confirm the other two (Devices, Settings) are equally reachable before deleting it, don't just hide it.
- The profiles-modal tab split changes modal structure/height — needs real-runtime capture of both tab states, not just the default one.
- Swapping ritual icons from emoji to SVG touches `RITUAL_ICONS`, which is read by `updateRitualOverlay()` on every step transition — needs the exact same smoke-style "syntax then behavior" verification already used for Phase 5A/5B/5C icon-adjacent changes.

**Explicit non-goals for the implementation pass(es) that would follow:**
- No Schedule tab restructuring (separate, already-scoped Phase 6A)
- No Smart Lights sequencing fix (separate, already-scoped Phase 5B-B)
- No dry-run/live schedule execution changes (separate, safety-sensitive Phase 5C-B — this audit only surfaces that the *visibility* of dry-run/live is weak, it does not touch how dry-run is *stored or enforced*)
- No timer engine, power engine, Phone Companion runtime, IPC, or scheduled-execution changes
- No new providers, no packaging changes, no PR

---

**This is a proposal, not a decision.** Nothing above has been implemented.
Recommend splitting execution into the three bounded passes you already
outlined (Menu + Command Cleanup / Tonight Simplification / Schedule
Live-Dry-Run Clarity) rather than one combined commit, matching every
prior pass's size discipline in this chain.
