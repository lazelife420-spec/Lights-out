# Lights Out — Phase 5F-A: Home + Timer Command Model Audit

Read-only audit. No code changed. Checkpoint: `786ae03`, pushed, working tree
clean. Every claim below is grep/read-verified against `electron/index.html`,
`electron/renderer.js`, `electron/renderer-night-modes.js`, and
`electron/styles.css` directly.

---

## 1. Hardest UI problems, ranked

1. **There is no command model, only pages.** Nothing in the UI currently
   tells the user which of 8 mental states they're in (choosing / editing /
   arming / testing / running live / reviewing / configuring). Each page is
   internally reasonable; nothing threads them together.
2. **A real "Armed" concept already exists, but only for Night Modes.**
   This is the single most important finding in this audit — see §3.
3. **Home's hero is a 2-item flex row, not a command card.** Confirmed via
   source (below) — this is fixable without new data, just layout.
4. **Settings' visual flatness is real but the audit already found why**:
   General has one control, and the rail leaves large blank space at
   dense/sparse category boundaries. The summary cards from Phase 5E-B use
   the same background as their container, so they don't visually pop.
5. **Schedule's tab row is still 7 concepts at one level** — confirmed
   unchanged since the last audit; not solved by the TOOLS-divider
   cosmetic fix.
6. Proof and Library are functionally fine and were correctly deprioritized
   by the user's own ordering — not in this pass's scope.

## 2. Proposed Home layout

**Confirmed via source**: `.ns-home-hero` is `display: flex; justify-content:
space-between` — brand block on the left, `.ns-home-cta` button on the
right, `gap: 24px`, `flex-wrap: wrap`. At normal window widths this reads
exactly as the video describes: two anchored elements with dead air
between them, no third element to give the eye a middle to land on.

Below the hero, Home currently has, all as **separate, equal-weight
cards**: Trust bar (4 static badges), Tonight card (plan/time/action +
"Open Tonight"), Night Modes teaser row, "Tonight at a glance" (4 glance
tiles), Last Night. That's 5 card-level sections for what the user is
asking to become one dominant card plus a secondary tier — which,
notably, is *already partially true*: Phase 6b52815 already demoted
glance+Last Night into `.ns-home-secondary` as a visually subdued group.
The remaining gap is that the **hero and the Tonight card are still two
separate elements** instead of one merged Tonight Command Card.

**Proposed** (layout only, zero new data — every value below is already
computed somewhere: Tonight card's plan/time/action, footer's Dry
Run/Live Ready text, Home's own Companion glance tile, First Light glance
tile):

```
LIGHTS OUT
Night control for Windows

┌─────────────────────────────────────────────┐
│ Custom Timer · 45 min · Sleep                │
│ Dry Run · Companion Ready · First Light 9:31A │
│                                                │
│ [Arm Tonight]  [Edit Tonight]  [Choose Mode]  │
└─────────────────────────────────────────────┘

Night Modes teaser row (unchanged)
Tonight at a glance / Last Night (unchanged, stays secondary tier)
```

This merges the hero's brand line with the existing Tonight card's
content into one card, and gives the CTA a real anchor instead of sitting
alone against the right edge. "Choose Mode" is the existing "Browse
Library" action relabeled to fit the 3-button row; "Edit Tonight" is the
existing "Open Tonight" action relabeled for the same reason.

## 3. Proposed timer clock state model — the most important finding

**Lights Out already has a real, working "Armed" state — just not for
custom timers.**

`useTonight()` (renderer-night-modes.js) → `armNightMode()` sets
`state.armedNightMode`, loads the mode's duration/action into Tonight's
setup fields, updates the current-plan banner (Phase 5A), and —
confirmed by an existing smoke check title, `'night-modes: Use Tonight
does not auto-start timer'` — **does not start anything**. This is
exactly the semantic the user is asking for, already built, already
tested, already safe. The gap is narrow: a plain custom timer (duration
stepper + chips) has no equivalent "commit to a plan without starting it"
step — chips instant-start, and Start Custom Timer starts immediately.

**Proposed state model**, reusing the existing armed concept rather than
inventing a second one:

```
Preview   -- idle, nothing armed. Ring/clock shows configured duration.
             Buttons: [Arm Tonight] [Start Now]
Armed     -- state.armedNightMode set (Night Mode) OR a new equivalent
             state.armedCustomTimer flag (custom timer) -- current-plan
             banner already renders this distinction today for Night
             Modes; a custom-timer arm would reuse the same banner logic.
             Buttons: [Start Now] [Change Plan]
Running   -- state.running. Unchanged: [Pause] [Snooze] [Cancel]
Paused    -- state.paused. Unchanged.
Completed/Cancelled -- state.lastOutcome. Unchanged (existing outcome pill).
```

**Critical safety framing, directly addressing the user's own stated
concern**: "Arm" must never silently change `state.dryRun`. The two
proposed variants:

- **`Arm Tonight`** — arms whatever the current Dry Run/Live setting
  already is (no change to it either way). This is the default, safe
  action.
- If a future pass wants an explicit live-arming affordance for scheduled
  rules (Phase 5G's actual subject), it must be its own visible choice —
  `Arm Live — will actually sleep/shutdown this PC` vs `Arm Dry Run` —
  never inferred from context. **Not proposed for implementation here** —
  this belongs to the Schedule Live/Dry-Run pass, which the user has
  already correctly fenced off as its own safety-sensitive investigation.

**Scope boundary for Phase 5F-B** (when it happens): a custom-timer arm
state is a UI/state addition (new flag, new button, new banner text
branch) — it does not need to touch `startTimer()`, IPC, or any power
path, since arming already means "don't call startTimer" by definition
(that's what Night Mode arming already proves). This keeps it inside the
"UI state, not engine" boundary the user has held for every pass in this
chain.

## 4. Proposed Settings polish

Confirmed causes of "flat":

- `.settings-category-summary` (Phase 5E-B) uses `background: var(--bg-card)`
  — the *same* card background as `.option-section` containers around it,
  so it doesn't read as a distinct "header" element, just another box.
- `.settings-context-breadcrumb` (Phase 5E-C) is a thin single-color strip
  with no icon or visual weight — reads as a debug/dev banner rather than
  a navigation aid, matching the user's exact complaint.
- `.settings-rail` items are flat `padding: 10px 12px` buttons with no
  visual distinction between "category with real content" and "category
  that's still sparse" — General shows exactly the same rail weight as
  Power & Safety despite one having 1 control and the other having 5+.

**Proposed** (visual only, no dirty-state/Save-Close logic — that stays
Phase 5E-D, explicitly deferred by the user):
- Give `.settings-category-summary` its own distinct surface (e.g. a
  subtle accent-tinted background, not the same flat card gray) so it
  reads as a header, not a stacked box.
- Restyle the breadcrumb with an icon/arrow and slightly stronger
  typography so it reads as "you are here," not a log line.
- No rail-density signal proposed for this pass — real content should
  fix General's specific sparseness (already flagged in 5E-B's own audit
  as a candidate for merging into Basics) rather than decorating the rail
  itself.

## 5. Proposed Schedule fix path (audit only, no implementation)

Confirmed unchanged since the Phase 5D-A audit: `Schedule / Automations /
Clock / Tools-divider / Quick Setup / Focus / Countdown`, 7 tab-level
concepts. The TOOLS divider fix (5D-B) made the *label* stop looking like
a fake tab, but did not change the underlying flat 7-item row — the
user's read that "the whole row is still conceptually wrong" is accurate;
that was always flagged as a separate, larger Phase 6A, not something the
divider fix was meant to solve.

Proposed grouping (unchanged from the original recommendation, now
reconfirmed): `Schedule` top-level → `Tonight / Rules / Automations /
Tools`, with `Tools` containing `Clock / Countdown / Focus / Quick Setup`.
**Not implemented here.** Calendar rows lacking Dry Run/Live status and
ambiguous `Start` labels are confirmed real (rows show `Bedtime · 10:30
PM · Sun-Sat · Shutdown` with a bare `Start` button, no safety-state
indication) — but fixing this requires knowing how `dryRun` actually
interacts with scheduled execution, which is Phase 5G's job, not this
one's. Flagging both problems here without touching either.

## 6. Files likely to change (future implementation passes, not this audit)

**Phase 5F-A' (Home dashboard, if approved)**: `electron/index.html`
(merge hero + Tonight card markup), `electron/renderer.js` (renderHome()
adjustments), `electron/styles.css`.

**Phase 5F-B (Tonight arm model, if approved)**: `electron/index.html`
(Arm Tonight button), `electron/renderer.js` (new `armCustomTimer()`
alongside existing `armNightMode()`, banner logic extension),
`electron/styles.css`, `electron/scripts/smoke.js`. Explicitly **not**
`main.js`, IPC, or any timer/power-execution file — arming is
definitionally a non-starting state.

**Settings polish**: `electron/styles.css` only, plausibly zero JS changes.

**Schedule**: not scheduled for implementation; flagged only.

## 7. Risks / non-goals

- Merging the hero and Tonight card touches `renderHome()`'s DOM
  assumptions — needs verification that Home's proactive status syncing
  (Companion/Lights/Wi-Fi/First Light) still targets the right elements
  after the markup merge.
- A custom-timer "Armed" state is new `state` surface — small, but it's
  the first genuinely new piece of session state added since Phase 5A;
  needs its own smoke coverage the way `armedNightMode` already has.
- Settings polish is the lowest-risk item in this whole list — CSS only.
- Schedule restructuring is explicitly **not** part of any near-term
  commit — the tab-hierarchy fix and the Dry Run/Live row labeling both
  wait for Phase 5G's source audit, which the user has already correctly
  sequenced last.

**Explicit non-goals for any pass that follows this audit:**
- No timer execution, power execution, dry-run/live execution, or
  schedule execution changes
- No Phone Companion runtime changes
- No IPC changes
- No packaging changes
- No Settings dirty-state Save/Close behavior (separate, already-deferred
  Phase 5E-D)
- No Schedule restructuring implementation (separate, already-deferred
  Phase 6A / Phase 5G)
- No PR

---

**This is a proposal, not a decision.** Nothing above has been implemented.
Recommend splitting any approved work into the commits the user already
outlined (Home dashboard → Tonight Arm model → Settings polish), each
independently gated and reviewed, matching every prior pass's discipline.
