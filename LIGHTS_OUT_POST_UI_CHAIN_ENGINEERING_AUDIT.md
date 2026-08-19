# Lights Out — Post-UI-Chain Engineering Audit (Phase 5X-A)

Read-only engineering audit. No code changed, no fixes applied.

**Branch:** `feat/steam-shell-phase1`
**HEAD:** `d2ccb0f` (docs commit only — the audited engineering state is
identical to `786ae03`, the last code commit)
**Working tree:** clean
**Commit range audited:** `1fc30a3` → `786ae03`
```
1fc30a3  reference rollback checkpoint
a741317  Steam Shell Phase 1: Home/Library structure
6b52815  Product Coherence: night-control framing + Home/Library hierarchy
6e06532  Phase 5A: Tonight current-plan clarity + Start Custom Timer
eca74b9  Wiring/help audit
9c9233e  Phase 5B-A: shared help + real schedule label
4682519  Phase 5C-A: navigation contract
8256769  Command clarity/menu redundancy audit
fbd84c6  Phase 5D-B: command clarity, no runtime changes
7034977  Settings shell/connected-menus audit
a0898c0  Phase 5E-B: settings hierarchy + summary cards
786ae03  Phase 5E-C: connected settings context
```
Every finding below is grep/read-verified directly against source in this
worktree, not inferred from commit messages.

---

## Architecture summary

The renderer is still a classic (non-module) multi-script architecture,
one shared global scope, loaded in this order:
```
lastLight.js, ambientVisuals.js, renderer-utils.js, renderer-help.js,
renderer-nav.js, renderer-profiles.js, renderer-calendar.js,
renderer-receipts.js, renderer-family-remote.js, renderer-ritual-focus.js,
renderer-settings.js, renderer-lastlight-alarm.js,
renderer-onboarding-updater.js, renderer-night-modes.js, renderer.js
```
Two new shard files were added during this chain: `renderer-help.js` (83
lines, shared hover/focus tooltip pattern) and `renderer-nav.js` (107
lines, back/forward history + delegated arrow-key navigation). Both
follow the exact same conventions the pre-existing shards already used
(top-level function declarations shared via global scope, a self-executing
`init...()` call at the bottom, an `/* exported ... */` comment for
eslint). Nothing architecturally new was introduced — the chain extended
an existing pattern rather than starting a second one.

`renderer.js` itself is 4515 lines, `styles.css` is 6202 lines,
`scripts/smoke.js` is 2344 lines with 235 top-level `check()` blocks. 9
QA capture scripts now exist (`qa-pass2` through `qa-pass5e-c`), all
following the same CDP-driven, dry-run-seeded, never-click-Start/Power
convention established from `qa-pass2` onward.

## Findings, severity-ranked

### No blockers found.

### Medium

**M1 — Duplicate `.status-pill` CSS class, two unrelated components share
one name.** Confirmed two separate rule blocks both define `.status-pill`:
one at `styles.css:1473` (the footer session-status pill — Idle/Running/
Dry Run/Live Ready, colored via `.dryrun`/`.live-ready`/etc. modifier
classes) and a completely different one at `styles.css:5395` (a generic
uppercase label pill used for "EXPERIMENTAL"/"REQUIRES SETUP"/companion
mode badges elsewhere in the app). This is **pre-existing** — it predates
this UI chain and was not introduced by any pass in it — but it's a real
risk: cascade order currently makes both "work" by accident, and any
future edit to either block risks silently changing the other's
appearance. Not urgent, but worth a rename (e.g. `.status-pill-label` for
the generic one) whenever CSS is next touched deliberately, not as a
drive-by fix.

### Low

**L1 — smoke.js brittleness signal, not yet a problem.** Twice in this
session alone, a real source change required a smoke regex fix afterward
(the Alt+Left/Right character-count window, and the footer Companion
button's `data-ns-help` text containing a literal `->` that broke a
`[^>]*` pattern). Both were caught immediately by the test itself and
fixed same-turn — the safety net is working exactly as intended. The
signal worth flagging: at 235 checks and growing, a meaningful fraction
now assert exact source text via regex rather than structural/behavioral
properties. This is a maintenance cost, not a correctness risk — nothing
found is currently broken or flaky.

**L2 — `renderer-nav.js`'s history stack has no size cap.**
`navBackStack`/`navForwardStack` grow by one entry per real tab change,
with no maximum. For any realistic single session this is inconsequential
(tens of entries at most), but it's an unbounded-growth pattern worth
noting if the app ever gains a much longer-lived session model.

**L3 — Broadened CSS/JS selectors trade specificity for extensibility.**
Phase 5E-B intentionally broadened `switchSettingsCategory()`'s selector
from `.option-section[data-settings-category]` to the more general
`.settings-categories [data-settings-category]` (and the matching CSS) so
the new summary cards would show/hide correctly. This was the right call
for that pass, but it means any future element added inside
`.settings-categories` that happens to carry a `data-settings-category`
attribute for an unrelated reason would automatically become subject to
the same show/hide toggle. Low risk today (only option-sections and
summary cards use this attribute, confirmed by exact count: 33 total
occurrences, all accounted for), worth a one-line comment reminder if
anyone touches this area again — which already exists in the code.

### Confirmed clean (verified directly, not assumed)

- **Runtime/safety path isolation**: grepped every guarded file (`main.js`,
  `startDecision.js`, `windowGeometry.js`, `calendar.js`,
  `calendarProviders.js`, `companionNetwork.js`, `companionFirewall.js`,
  `capabilityTruth.js`, `settings.js`, `smartLights.js`, `profiles.js`,
  `profileIdentity.js`, `profileRitualContext.js`) for every renderer-only
  identifier introduced across this whole chain (`navGoBack`,
  `navGoForward`, `pushNavRoute`, `openDeviceSettings`,
  `renderSettingsContext`, `initHelpTooltips`, `initNavigationContract`,
  `data-ns-help`, `data-ns-navgroup`). **Zero matches.** Nothing from this
  UI/navigation/help/settings chain leaked into any runtime or safety file.
- **Script load order**: `renderer-help.js`/`renderer-nav.js` load right
  after `renderer-utils.js`, before every file that could need them.
  `renderer-ritual-focus.js` loads *before* `renderer-night-modes.js` —
  confirmed its icon map deliberately uses locally-inlined SVG strings
  rather than `window.NS_MODE_ICONS`/`NS_GLANCE_ICONS`, specifically
  because those globals don't exist yet at that point in load order. This
  was a real hazard that was correctly avoided, not accidentally dodged.
- **`package.json` build.files / eslint config registration**: cross-checked
  directly (not via the smoke assertion) — all 15 local `<script src>`
  tags in `index.html` have a matching `build.files` entry. None missing.
- **Event listener duplication**: `wireEvents()` (the primary listener-attachment
  function) is called exactly once, at bootstrap. Dynamic re-render
  surfaces (`renderProfiles()`, Library's `buildTile()`) correctly replace
  `innerHTML` *before* re-attaching listeners each render, so old nodes
  (and their listeners) are garbage-collected, not duplicated. The
  delegated surfaces (`initHelpTooltips()`, `initNavigationContract()`)
  are each invoked exactly once at module load — confirmed both by direct
  grep and by an existing smoke assertion guarding against a second call.
- **History/navigation bootstrap**: exactly one `handleSidebarNavigation()`
  call happens at boot (`renderer-settings.js:138`, restoring the
  persisted tab), and `pushNavRoute()`'s null-guard means this first call
  correctly seeds `navCurrentTab` without polluting the back stack — Back
  immediately after launch correctly has nothing to go back to.
- **Packaged build correctness**: independently re-verified (not reused
  from a prior pass's result) — 15/15 scripts present in `build.files`,
  matches the smoke suite's own generalized check.
- **Home/Library/Tonight state duplication**: all three consistently read
  the *same* synced DOM elements (`ta-lights-status`, `ta-wifi-status`,
  `ta-companion-status`, etc.) rather than independently computing status
  — the "one source of truth, no new fetch" pattern established in Phase
  5B-A has held through every subsequent pass, not just the one that
  introduced it.
- **QA script safety convention**: all 9 scripts follow the same pattern —
  isolated `--user-data-dir`, `dryRun: true` seeded, and (spot-checked
  directly, not assumed) never dispatch a click/Enter on Start Custom
  Timer, Begin Ritual, a duration chip, or any Power/Play control. Several
  scripts explicitly verify `state.running === false` as their own final
  sanity check.

### Worth naming as a positive finding, not a risk

**A real "Armed" state machine already exists and is genuinely reusable.**
`state.armedNightMode`, set via `armNightMode()`/`useTonight()`, is a
working, tested (`'night-modes: Use Tonight does not auto-start timer'`),
production example of exactly the arm-without-starting semantic the
Phase 5F-A product audit is asking for. This isn't a risk finding, but it
directly de-risks the next proposed pass (Tonight Arm model) — the
pattern to extend already exists and already has smoke coverage to model
new coverage on.

## Immediate blockers

**None.** Nothing found in this audit requires a stabilization commit
before further UI work.

## Safe next implementation recommendation

**Yes, it is safe to continue with the Home Command Dashboard next.**
Nothing in this audit found renderer spaghetti, leaking runtime coupling,
duplicate listeners, or a broken build. The one Medium finding (M1, the
duplicate `.status-pill` name) is pre-existing and orthogonal to the
Home/Tonight/Settings work under discussion — it doesn't need to block or
precede it.

## Refactors to defer (not urgent, not blockers)

- M1: rename the generic label `.status-pill` to something distinct from
  the footer session pill — do this the next time CSS in that area is
  touched for a real feature reason, not as a standalone refactor commit.
- L1: if smoke.js keeps growing, consider whether some exact-text regex
  assertions could become structural checks instead (e.g. "the function
  exists and is called from N places" rather than matching literal
  whitespace) — not urgent at 235 checks, worth revisiting past ~400.
- L2: no action needed unless session length assumptions change.
- L3: already has an in-code comment; no further action needed unless a
  new `data-settings-category` use case appears that isn't a real
  category section.

## Exact files/modules at risk (for future attention, not action now)

| File | Risk | Severity |
|---|---|---|
| `electron/styles.css` | Duplicate `.status-pill` name (M1) | Medium |
| `electron/scripts/smoke.js` | Growing exact-text brittleness (L1) | Low |
| `electron/renderer-nav.js` | Unbounded history stack (L2) | Low |
| `electron/index.html` + `renderer.js` (Settings) | Broadened selector extensibility tradeoff (L3) | Low |

## Is the branch mergeable and maintainable?

Yes. Every pass in this chain shipped with lint/smoke/unit/build gates
green, real-runtime CDP verification, and a bounded diff. The chain is
long (12 commits) but each commit is independently reviewable and none
depend on uncommitted state. No dead code, no orphaned handlers, and no
accidental runtime coupling were found. The branch is in a genuinely
healthy state to keep building on.

---

**This is a read-only audit. No fixes were applied. No app code was
committed in this pass.**
