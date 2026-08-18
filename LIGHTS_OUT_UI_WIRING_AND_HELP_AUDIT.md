# Lights Out — UI Wiring & Guided Help Audit

Phase 5B / 6A, Step 1. Read-only inventory of every visible interactive
surface, built from `electron/index.html`, `electron/renderer.js`,
`electron/renderer-night-modes.js`, and `electron/renderer-settings.js`
directly — every claim below is grep/read-verified against source, not
inferred from the video. No code changed in this step.

Baseline: commit `6e06532`, working tree clean.

Legend:
- **Wired** — has a real handler that does something real (IPC call, state
  change, navigation).
- **Routes** — navigates to another panel/category, verified in source.
- **Disabled+reason** — inert control that explains why.
- **Disabled, no reason** — inert or sequence-dependent control with no
  explanation visible to the user.
- **No-op risk** — clickable, wired, but nothing tells the user what
  happens or whether prerequisites are met first.
- **Needs help** — functionally fine, just unexplained.

---

## 1. Top menu (Power / Quick Toggles / Info)

Better than the video reads at a glance — these are real dropdowns with
real wiring, not decoration.

| Control | Status |
|---|---|
| Power → Shutdown/Restart/Sleep/Hibernate (`data-action`) | **Wired** — real power actions |
| Quick Toggles → Dry Run / Sound Effects / Graceful Close | **Wired** — `renderer.js:3454-3459`, toggles real state, indicator text updates live |
| Quick Toggles → Open full Settings | **Routes** to Settings |
| Info → Documentation, Keyboard Shortcuts | Have `data-help` text already (`renderer.js` handles it) — the **only** two `data-help` uses in the entire app |
| Info → Version & Updates | **Routes** to About |

**Gap:** Power's items have no safety copy in the dropdown itself (dry-run/final-confirm state is explained elsewhere, not here). Quick Toggles' three toggles have no explanation of what Graceful Close *does* differently from a normal close. Otherwise this surface is in better shape than its "Info" label suggests — the label mismatch (Info vs. Help/About) is real but cosmetic.

## 2. Home

Confirmed well-wired, contradicts part of the "exposed machinery" read for
this specific page:

| Control | Status |
|---|---|
| Hero CTA (`ns-home-cta`) | **Wired** — `handleHomeCta()`, state-aware |
| "Open Tonight" | **Routes** to Tonight |
| "Browse Library" | **Routes** to Library |
| Glance tile: First Light | **Routes** to Settings → Automations (`openDeviceSettings('automations')`) |
| Glance tile: Companion | **Routes** to Devices |
| Glance tile: Smart Lights | **Routes** to Settings → Wind-Down |
| Glance tile: Wi-Fi Guard | **Routes** to Settings → Protection |
| "View Ledger" (Last Night) | **Wired** — opens receipts modal |

**Gap:** every glance tile *routes correctly on click* but the status text alone ("Not configured", "Off") doesn't say what happens **tonight** if left that way, and there's no hover/focus explanation before the click — a user has to click through to find out "nothing will happen." This is exactly the "Tonight will control: …" framing from the brief — the routing exists, the **predictive** copy doesn't.

## 3. Tonight

| Control | Status |
|---|---|
| Current-plan banner, participating chips, PREVIEW badge | Added in Phase 5A, all **wired**, no help yet |
| Start Custom Timer / Begin Ritual | **Wired**, unchanged engine |
| Quick Plans chips (`.chip`, duration presets) | **Wired** — instant-start on click, confirmed via `renderer.js` |
| Pause / Snooze / Cancel | **Wired** |
| Analog/digital clock vs. ring | Semantics correct, **never explained in-UI** |

**Gap exactly as reported:** Quick Plans chips instant-start with zero
warning. A user cannot tell, before clicking, whether a chip arms vs.
replaces vs. starts. This is the single highest-value fix in Tonight —
it's a real behavior surprise, not just missing polish.

## 4. Library

The **featured/detail panel** (shown after selecting a tile) is much
richer than the video conveys:

| Element | Status |
|---|---|
| Featured panel: "What Happens" timeline | **Real**, built from `buildTimeline(mode)` |
| Featured panel: Duration / Action / Ritual meta rows | **Real** |
| Featured panel: status line for unavailable modes | **Real reason string** from `mode.availability.reason`, not a generic label |
| Featured panel: participating-device chips | **Real**, `buildFeatureChips()` |
| "Use Tonight" button | **Wired**, disabled with `mode.status !== 'ready'`, label changes to "Not Available" |

**Confirmed gap:** the small grid **tiles** (`nm-ready-grid`/`nm-unready-grid`, via `buildTile()`) show only title + duration + action + a bare status tag (`NEEDS SETUP` / `COMING SOON`) — none of the recipe detail above. A user has to click a tile to learn anything beyond duration/action, which is exactly the "timer preset" drift the brief describes. The richer content already exists one click away — this is a surfacing gap, not a missing-data gap.

## 5. Schedule

Confirmed the biggest coherence problem, exactly as described. 7 tabs
(Schedule / Automations / Clock / Quick Setup / Focus / Countdown) mixed
with raw forms:

| Control | Status |
|---|---|
| `chk-schedule` + `schedule-time` (specific date/time) | **Wired**, zero explanatory copy |
| Calendar provider select (builtin/iCal/Google/Outlook/Calendly) | **Wired** (fetch buttons call real handlers), but iCal/Google/Outlook/Calendly panels expose raw API-key/token/URL fields with placeholder text only — no "why would I need this" framing, no safety note that these are stored locally |
| Schedule rule form (label/time/duration/days/action) | **Wired**, functional, no help text on any field |
| Automations tab: First Light, Autopilot, Content Blocker | Already has real state text (`Off`/status) + "Edit" buttons that **route** correctly to Settings |
| Clock / Quick Setup / Focus / Countdown tabs | **Wired**, self-explanatory by content (presets), lowest-risk tabs here |

**Gap:** this page's problem isn't broken wiring — everything here works. It's that 7 tabs of forms with no hierarchy read as "raw controls," exactly as the brief says. This one is flagged as a **later dedicated pass** per the brief's own scope limit, not fixed in this pass beyond helper text.

## 6. Devices

Better-explained than the video suggests — every card already has a
`dev-note` paragraph and a direct CTA:

| Control | Status |
|---|---|
| This PC card | Status-only, no CTA needed |
| Phone Companion card | Explanatory note + **routes** to Settings → Phone via `btn-dev-companion` |
| Family LAN card | Explanatory note + "Scan for Peers" **wired** |
| Smart Lights card | Explanatory note + **routes** to Settings → Wind-Down |
| Wi-Fi Guard card | Explanatory note ("Windows Firewall cannot block a different device on the LAN" — an honest limitation, already disclosed) + **routes** to Settings → Protection |

**Gap:** small — mostly just needs a one-line "what happens tonight" status per card, matching the same pattern the brief wants everywhere else. Structurally, this page already follows the standard being asked for elsewhere.

## 7. Proof

| Control | Status |
|---|---|
| Empty states (Last Run / History / Activity) | Already have real explanatory copy + "Go to Tonight" CTA, not bare zeros |
| View Full Ledger | **Wired** |
| Copy Report / Export Ledger | **Wired** |

**Gap:** exactly as reported — nowhere does it explain what "Dry Run" *means* for the receipt, what a receipt legally/practically "proves," or that it's local-only. The data presentation is solid; the concept is unexplained.

## 8. Settings — the real gap concentration

9 categories via `settings-rail`. Verified per-category:

| Category | Explained? | Notable issues |
|---|---|---|
| General | One intro paragraph | fine |
| Power & Safety | **Zero explanatory text** on Action Type / Grace Period / Force Shutdown / Mute / Dry Run | every checkbox is a bare label |
| Wind-Down (Smart Lights) | One-line note + `REQUIRES SETUP` pill | **Confirmed exactly as reported**: Discover/Register/Load Groups/Test are all **wired but never disabled** — a user can click Register before Discover, Load Groups before Register succeeds. No sequencing, no prerequisite text. |
| Phone Companion | Actually the best-explained section already: mode buttons have real (if native-tooltip-only) explanations, an inline "Having trouble?" tip box, and firewall/unreachable states have their own explanatory error boxes | Gap is narrower than the brief implies: mainly needs the flow **restructured into numbered steps** and the port field moved under "Advanced" — the guidance content mostly already exists, just not laid out as steps |
| Protection (Wi-Fi Guard, Content Blocker) | Not yet read in full this pass — flagged for Step 3 | |
| Accountability | Not yet read in full this pass — flagged for Step 3 | |
| Automations (First Light, Autopilot) | First Light has a real explanatory paragraph already | Autopilot not yet confirmed |
| Appearance & Sound | Not yet read in full this pass | |
| Advanced | Not yet read in full this pass | |

**Confirmed no-op-risk pattern:** Smart Lights' Discover/Register/Load
Groups/Test Connection is the single clearest case in the whole app of
"wired but no sequencing help" — matches the brief's #8 exactly, backed
by source (`renderer.js:3923-3964`, no `disabled` gating found anywhere
in that flow).

---

## Cross-cutting findings

1. **No shared help/tooltip component exists.** The entire app has exactly
   two uses of `data-help` (both in the Info menu). Native `title`
   attributes appear in a few places (Phone Companion mode buttons) but
   aren't a designed pattern — no consistent hover/focus treatment, no
   keyboard-accessible equivalent beyond the browser default.
2. **Routing is better than the video suggests.** Home, Devices, and most
   of Schedule's "Edit" buttons already route to the correct real Settings
   category. The wiring problem is concentrated in Settings' Smart Lights
   flow and Schedule's raw forms, not spread evenly across the app.
3. **The richest explanatory content that exists (Library's featured
   panel, Devices' dev-notes, Phone Companion's tips) is inconsistently
   applied** — it exists in three places and is completely absent in
   others (Power & Safety, most of Schedule's calendar provider configs).
4. **Emoji/glyph inconsistency confirmed** in Schedule (🌙🌅🤖📅🚫🎯💸) and
   Settings section headers (💡📱👨‍👩‍👧‍👦), consistent with finding #10 — flagged,
   not fixed in this pass per the brief's explicit ordering (wiring/help
   before icon pass).

## What Step 1 did not cover

Protection, Accountability, Appearance & Sound, and Advanced settings
categories were not read in full this pass (time-bounded to keep Step 1 a
checkpoint, not the whole audit). Step 3 work on those categories will
read them in full before writing any help copy — no guidance will be
invented for sections not yet verified against source.
