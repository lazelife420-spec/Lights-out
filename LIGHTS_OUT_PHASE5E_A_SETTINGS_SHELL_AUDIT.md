# Lights Out — Phase 5E-A: Settings Shell + Connected Menus Audit

Read-only audit. No code changed. Checkpoint: `fbd84c6`, working tree clean.
Every claim below is grep/read-verified against `electron/index.html` and
`electron/renderer.js` directly.

---

## 1. Settings hierarchy

9 flat categories via `.settings-rail`, no grouping, all equal visual
weight: General, Power & Safety, Wind-Down, Phone Companion, Protection,
Accountability, Automations, Appearance & Sound, Advanced.

**Correction to the video's overall impression**: the "huge and mostly
empty" problem is real, but it's concentrated in 2 of the 9 categories,
not systemic:

| Category | Content density (verified) |
|---|---|
| **General** | **Sparse** — one checkbox ("Run at login") + one intro paragraph |
| Power & Safety | Dense — Action Type, Grace Period, Force Shutdown, Mute, Dry Run |
| Wind-Down | Dense — Smart Lights (provider/mode/bridge setup), Wind-down system actions (Night Light/pause media/lockout), First Light |
| Phone Companion | Dense — mode selector, QR pairing, port config, Family Mode |
| Protection | Dense — Wi-Fi Guard, Content Blocker |
| Accountability | Dense — Accountability Partner (webhook notifications, real intro copy), Override Tax (4 configurable fields, real intro copy) |
| Automations | Dense — First Light, Autopilot Bedtime (learned/override bedtime) |
| Appearance & Sound | Dense — Accent color + swatches, Theme, Ring Style, Opacity, Volume, Warm Shift, plus clock customization (style/dial/format/scale/hands/date/seconds/sweep) |
| **Advanced** | **Sparse** — one text field (Focus Mode blocklist) with a one-line caption |

**Proposed grouping** (visual only, category count doesn't have to change):

```
Basics          General · Appearance & Sound
Safety          Power & Safety · Protection
Night Automation Wind-Down · Automations
Connected Devices Phone Companion
Accountability  Accountability (kept standalone — distinct enough concept)
Advanced        Advanced
```

Merging General's one checkbox into Basics alongside Appearance would also
directly fix General's "huge and empty" problem without inventing new
content — it currently has a whole category-sized panel for one setting.

## 2. Settings connectedness

**Confirmed: zero context is preserved on the way in.** `openSettingsPanel()`
always calls `switchSettingsCategory('general')` first; `openDeviceSettings(category)`
wraps it and immediately re-switches to the target category — so by the
time the user sees anything, there's no trace of why they're there or
what sent them.

**Verified entry points, all landing in the same undifferentiated modal:**

| Entry point | Target category |
|---|---|
| Sidebar → Settings | `general` (default) |
| Top menu → Status & Safety → Open full Settings | `general` (default) |
| Devices → Phone Companion card | `phone` |
| Devices → Smart Lights card | `wind-down` |
| Devices → Wi-Fi Guard card | `protection` |
| Home glance tiles (First Light/Companion/Lights/Wi-Fi) | `automations`/`dev` tab/`wind-down`/`protection` |
| Tonight's "Also Scheduled" Edit + Schedule's Automations Edit (`.ta-edit-btn`, shared handler) | `automations`/`protection` |
| Footer Companion shortcut | opens pairing page directly, or `phone` if not ready |

**One real, working, good mechanism already exists** and should be kept
exactly as-is: `settingsReturnTab` remembers which primary tab (Home/
Tonight/Library/Schedule/Devices/Proof) was active before Settings opened,
so Close returns you there — correct on the way *out*. The gap is
entirely on the way *in*: nothing tells the user "you're here because of
X."

**Proposed fix**: `openDeviceSettings(category, sourceLabel)` — thread one
extra string through the same existing call sites (all already pass a
category; adding a second literal argument at each of the ~8 call sites
is small and mechanical) to render a one-line "Opened from Devices ·
Smart Lights setup" breadcrumb above the category content. No new state
machine, reuses the return-tab pattern's spirit.

## 3. Settings panel Save/Cancel model

**Confirmed exactly as suspected, plus a nuance:**

- `btn-save-opt` → `saveSettingsPanel()`, which writes **every** category's
  fields at once (Action, Grace, Force Shutdown, Mute, Run at Login, Smart
  Lights config, and more below what was read) — regardless of which
  category is currently visible. Save is global, not per-category.
- `btn-cancel-opt` → `discardSettingsPanelChanges()` — this is real, not a
  no-op; Cancel does actually revert.
- **Real inconsistency found**: Dry Run is deliberately *not* part of the
  batched save — it's documented in-source as "always-live,
  immediately-committed" the moment its checkbox changes, same as the
  top-menu quick toggle. So some settings save the instant you touch
  them, others wait in a pending state until you click the global Save —
  with no visual distinction anywhere telling the user which kind of
  field they're looking at. This is the concrete mechanism behind "did I
  change anything?"

**Proposed fix** (copy/UI only, per the stated non-goal of no behavior
changes): label live-committing fields (Dry Run today, potentially other
toggles) with a small "saves instantly" indicator, and change the footer
button logic to show "Save Changes" only when a batched field is actually
dirty, otherwise "Close" — matching your proposal exactly. This requires
tracking dirty state, which doesn't currently exist as a concept in
`saveSettingsPanel()`/the form fields — a real but bounded addition.

## 4. Top menu / status belt

Current state after Phase 5D-B: `Power | Status & Safety | Help` in the
top menu, plus the footer `#status-pill` (now: Dry Run / Live Ready /
Paused / running-phase text, all named explicitly).

This already covers "is the app in dry-run or live" truthfully — the gap
the video is naming now is different: it's asking for that same
information to be visible **without** opening a menu or looking at the
small footer-left pill, i.e. a persistent status summary near the top of
the app (Home/Tonight), not replacing the footer pill or the menu, but
adding a third, more prominent surface.

**A real building block already exists for this**: Tonight's current-plan
banner (Phase 5A) already computes and displays "Custom Timer · 28 min ·
Shutdown" or "Night Mode · 90 min · Sleep", and the idle-clock label
(Phase 5B-A) already computes "Next action: HH:MM" / "No time scheduled"
from the same real `calNextEvent` data. A status belt combining
Dry-Run-or-Live + that existing next-action computation + Companion
status (already synced to Home's glance tiles) would be assembling
**already-computed real values**, not fabricating new state — this is
the same "no new fetch, reuse existing synced data" pattern every prior
pass in this chain has followed.

**Recommendation**: this belongs on Home (the orientation surface) more
than as a literal top-menu replacement — the menu itself is fine as
navigation chrome now that Phase 5D-B named its contents correctly; what's
missing is a glanceable summary, which is a Home content addition, not a
menu-model change.

## 5. Proof/data connection

Confirmed thin. `renderLastRunSummary()` produces exactly 3 plain
`status-row` lines — When / Result / Action, no explanation of what a
receipt is or proves, matching the video's read precisely.

**Bug found while investigating (unrelated to this audit's scope, not
fixed here)**: `renderer.js`'s `renderLastRunSummary()` has a malformed
closing tag — `<span class="status-pill status-local">Dry Run<\span>`
(backslash, not a real closing `</span>`) on the Last Run Dry Run badge.
Browsers silently ignore the invalid tag rather than breaking the page,
so this hasn't been visibly broken, but it's real markup damage worth a
one-line fix whenever Proof is next touched.

Advanced/Data settings (import/export, Focus blocklist) live in the
`advanced` Settings category, disconnected from Proof entirely — the
video's "Data" grouping idea (Proof + Import/Export + Advanced together)
would require moving the Settings modal's import/export controls (found
in Phase 5D-A's audit, they currently live inside `#profiles-modal`, not
Settings) to actually converge with Proof, which is a bigger structural
move than this pass should take on. Flagging as a later idea, not part of
the proposed Commit A/B/C split below.

## 6. Implementation split (proposed, not started)

**Commit A — Settings hierarchy + summary cards, no behavior changes**
- Group the 9 categories under the visual headers above (Basics/Safety/
  Night Automation/Connected Devices/Accountability/Advanced)
- Merge General's one checkbox into Basics alongside Appearance
- Add a one-line purpose + status summary at the top of each category
  (reusing already-known real state — e.g. Wind-Down already knows
  whether Smart Lights is configured, Phone already knows Companion
  status)
- Files: `electron/index.html` (rail buttons, category grouping markup),
  `electron/styles.css` (rail group headers)

**Commit B — Connected settings context**
- Thread a `sourceLabel` through `openDeviceSettings()`'s existing ~8 call
  sites, render an "Opened from X" breadcrumb
- Files: `electron/renderer.js` (`openDeviceSettings` signature + call
  sites), `electron/index.html` (breadcrumb element), `electron/styles.css`

**Commit C — Save/Close dirty-state clarity**
- Track whether any batched (non-live) field actually changed; swap
  "Save Changes"/"Close" based on that, add a small "saves instantly"
  label on live-committing fields (Dry Run today)
- Files: `electron/renderer.js` (dirty tracking, footer button logic),
  `electron/index.html` (live-field labels)

Each commit independently gated (lint/smoke/unit/build/real-runtime
capture), same discipline as every prior pass in this chain. Recommend
**Option A** from your own proposal (better modal, not a full-page route)
for all three — matches the existing routing model, lower risk, and
nothing found in this audit suggests Settings needs to become a sibling
route to justify the fixes above.

---

## Risks / non-goals

- Commit A's category regrouping touches `switchSettingsCategory()`'s
  rail-button matching logic — needs verification that grouping headers
  don't break the existing show/hide-by-category mechanism.
- Commit B threading a second argument through 8 call sites is mechanical
  but needs every site updated together, or some entries will show no
  breadcrumb while others do (inconsistent, worse than none).
- Commit C's dirty-state tracking is the largest of the three — it's the
  first time this modal would need to distinguish "field changed" from
  "field has its default value," which doesn't exist as a concept
  anywhere in the current code.
- None of this touches `saveSettingsPanel()`'s actual field-writing logic,
  `state.dryRun`'s live-commit behavior, or any IPC/main-process code —
  confirmed by file list above.

**Explicit non-goals:**
- No timer engine, power execution, dry-run/live execution, or schedule
  execution changes
- No Phone Companion runtime changes
- No IPC changes
- No packaging changes
- No Settings-as-full-page-route (Option B) — not pursued unless later
  explicitly requested
- No Proof/Data convergence (moving import/export into Proof) — flagged
  as a later idea only
- No PR

---

**This is a proposal, not a decision.** Nothing above has been implemented.
