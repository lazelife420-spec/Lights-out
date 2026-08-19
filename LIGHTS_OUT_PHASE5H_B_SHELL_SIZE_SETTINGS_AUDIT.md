# Lights Out — Phase 5H-B: Shell Size + Settings Usability Audit

Read-only audit. No code changed. Checkpoint: `e7786db` (`feat/steam-shell-phase1`,
pushed, working tree clean — includes Commit A's header-drag fix).
Every claim below is grep/read-verified against source, or empirically measured
against the packaged build at `dist-native\win-unpacked\Lights Out.exe`
(built from this same checkpoint). Live measurements were taken with the app's
own `%APPDATA%\lights-out-electron\settings.json` window state temporarily
cleared to simulate a fresh install, then restored byte-for-byte afterward —
no persisted user state was altered.

---

## 1–3. Default window size, min size, and what a fresh user actually sees

**Source claims one thing, Electron enforces another.** [main.js:289-291](electron/main.js:289):

```js
} : {
  width: 520,
  height: 800,
  minWidth: windowGeometry.NORMAL_MINIMUM.width,   // 900
  minHeight: windowGeometry.NORMAL_MINIMUM.height, // 640
  ...
```

`width: 520` is requested, but `minWidth` from [windowGeometry.js:1](electron/windowGeometry.js:1)
is `900` — wider than the requested width. Electron's `BrowserWindow` clamps
the initial size to `minWidth`/`minHeight` at construction; it cannot create a
window narrower than its own minimum. **520×800 has never been the real
default** for a fresh install on any normal display — it's dead code that
looks like the default if you only read the object literal.

**Empirically confirmed** by clearing this machine's persisted window state
and measuring the actual `GetWindowRect` of the freshly-launched packaged app:

| | Requested in source | Actually observed (fresh state) |
|---|---|---|
| Width | 520 | **915px** |
| Height | 800 | **920px** |

Width lands at ~`minWidth` (915 vs. 900 — the small delta is the invisible
`thickFrame` resize border, confirmed by the same ~13-15px offset on a second,
already-resized window). Height overshoots the requested 800 because of a
separate mechanism: a `fit-window-height` IPC call ([main.js](electron/main.js),
referenced in the `smoke.js` mini-mode checks) auto-grows the window to match
rendered content on load, and Tonight's stacked content is taller than 800px
worth of chrome + clock + cards.

**So a fresh user's actual first launch is a ~915×920 window** — closer to
square than the tall, narrow "cockpit" the `520×800` literal in the source
suggests, but still far short of the ~1100-1200px the two-pane Settings
layout is designed around.

## 4-5-6. Settings panel behavior at the real default width

The two-pane architecture ([styles.css:1703](electron/styles.css:1703) onward)
is real and correctly built — this is not a rewrite target:

- `.settings-rail` is a fixed `flex: 0 0 200px` column ([styles.css:1748](electron/styles.css:1748))
- `.settings-categories` is the only scrolling region (`overflow-y: auto`,
  [styles.css:1822](electron/styles.css:1822))
- `.modal-header`/`.modal-footer` are pinned (`flex: 0 0 auto`,
  [styles.css:1729](electron/styles.css:1729))
- content stacks to a horizontal rail only below `500px` window width
  ([styles.css:2517](electron/styles.css:2517)) — far below the real default,
  so this breakpoint essentially never fires in normal use

**Why it still reads as cramped despite that:** the persistent left
`.ns-sidebar` (`208px` fixed, [styles.css:4791](electron/styles.css:4791)) plus
`--section-gap` (`18px`) is subtracted from window width *before* Settings
even starts laying out. At the real ~915px default:

```
915px window
- 208px sidebar
-  18px gap
------------------
689px  ns-panel-set / .settings-panel available width
- 200px settings-rail
-  40px .settings-categories padding (18+20 each side, ~2px border)
------------------
~449px actual content width for every settings row, toggle, and form field
```

`.settings-panel`'s own `max-width: 1100px` ([styles.css:1717](electron/styles.css:1717))
never becomes the binding constraint — the window is never wide enough to
reach it. The two-pane *architecture* is right; the *canvas it's drawn on* is
too small for it to read as spacious. This matches your read exactly: it's
not a modal-vs-panel problem, it's a window-size problem.

## 7. Proposed default/min size

Recommend raising both the requested default and the enforced minimum,
consistently (right now they contradict each other, which is itself a bug
independent of what the target number should be):

- **Default**: `1180×760` (inside your suggested 1100-1200px range; height
  set below the 920px auto-fit-driven current default since a wider window
  needs less stacked vertical height for the same content — should be
  re-checked empirically after the change, not assumed)
- **`minWidth`**: raise from `900` to something around `1040` — enough that
  Settings' rail+content never has to squeeze below a usable width, while
  staying under the new default so a user can still shrink the window
  somewhat
- **`minHeight`**: leave at `640` unless the audit above's height re-check
  says otherwise

This is a `main.js`/`windowGeometry.js` change, not a CSS change — the
current mismatch (`width: 520` vs `minWidth: 900`) is exactly the kind of
"nobody will ever look at both these numbers together" bug a single-line
fix corrects.

## 8. Responsive behavior for a user-shrunk window

Two breakpoints already exist (`720px` sidebar icon-collapse,
`500px` settings-rail stack) and both are reasonable, tested behaviors —
keep them. What's missing is the middle: between the new, wider default
(~1180px) and `720px`, nothing currently adapts, so a user who manually
narrows the window gets the exact cramped Settings experience described
above before either breakpoint kicks in. Worth adding one intermediate
breakpoint (candidate: `~900px`, matching the *old* minWidth) that reduces
`.settings-rail` from `200px` to something like `160px` and tightens
`.settings-categories` padding, so the degradation from spacious → narrow is
gradual rather than a cliff at `720px`/`500px`.

## 9. Do Home/Tonight/Schedule/Devices/Proof also suffer from the narrow default?

**Yes, but differently than Settings.** `.dashboard` (the container for
Home/Tonight/Library) has no `max-width` and no competing fixed column, so it
already uses all available width — widening the window helps those screens
immediately, no CSS changes required there.

**Devices does not benefit from a wider window at all.**
[styles.css:1064](electron/styles.css:1064): `.dev-status-section { flex-direction:
column; }` — hard-coded single column of full-width `.status-card` blocks,
each an internal `.status-row` label/value list
([index.html:1028-1088](electron/index.html:1028)). This is a structural
layout choice, not a symptom of the narrow window — Devices would render the
exact same single stacked column of "diagnostic table" cards at 1180px as it
does at 900px. This confirms problem #4 from your list ("Schedule/Devices
still look like diagnostic admin panels") is real and independent of the
shell-size fix — it needs its own layout pass (a card grid, most likely),
which is exactly the kind of thing the Commit D hierarchy audit
(`LIGHTS_OUT_PHASE5H_SCREEN_HIERARCHY_AUDIT.md`, not yet run) should scope,
not this one.

Schedule (`#ns-panel-sch`) wasn't inspected in the same depth here — flagging
it as unverified rather than guessing; it should get the same grep-verified
treatment before any Commit D scoping.

## 10. Window geometry persistence

Confirmed live: window bounds persist to
`%APPDATA%\lights-out-electron\settings.json` under `window.bounds`
(`settings.js`, `windowGeometry.clampNormalBounds`), written on `move`/`resize`
with a 250ms debounce ([main.js:335-336](electron/main.js:335)), and restored
on next launch via `clampNormalBounds` against the current display's work
area. This means:

- **A fresh-install default-size change only affects users with no saved
  bounds yet** (new installs, or after a settings reset) — existing users'
  windows won't jump in size just because the code changes.
- **Raising `minWidth` is the one part that *can* affect existing users**:
  if someone previously shrank their window below the new `minWidth`, the
  persisted bounds would be clamped up on next launch (this is
  `clampNormalBounds`'s existing, correct behavior — same mechanism that
  already keeps restored windows on-screen). Worth calling out explicitly
  when this ships, not silently.

---

## Proposed Settings layout fixes, if any

None beyond what's already covered above. The two-pane architecture, fixed
header/footer, single scrolling region, and category summary cards are all
already correctly built (Phase 5E-B/5E-C). Once the window has real width to
work with, re-verify visually whether `.settings-categories` padding
(`18px 20px`) and `.settings-rail` width (`200px`) still feel proportionate at
~1180px — likely fine as-is, but that's a visual call, not something this
static audit can settle definitively.

## Files likely to change (Commit B, pending your approval)

- `electron/main.js` — default `width`/`height` in the non-mini `windowConfig`
- `electron/windowGeometry.js` — `NORMAL_MINIMUM`
- `electron/styles.css` — one new intermediate responsive breakpoint (~900px)
  for `.settings-rail`/`.settings-categories`
- `electron/scripts/smoke.js` — update/add coverage pinning the new
  default/min numbers so they can't silently drift apart again the way
  `520` vs `900` did

**Not expected to change:** Devices' single-column layout (that's a Commit D
concern, not this one), any `.dashboard`/Home/Tonight CSS (no cap exists to
fix), Settings' rail/content split, IPC, timer/power execution, Phone
Companion runtime, or packaging.

## Risks and non-goals

- **Risk**: raising `minWidth` clamps any existing user whose saved window is
  narrower than the new minimum, up on next launch. Existing, intentional
  `clampNormalBounds` behavior — not a new bug, but worth a changelog line.
- **Risk**: the auto-fit `fit-window-height` mechanism was empirically
  observed to override the requested default height (800 → 920 in testing).
  A default-height change should be re-measured against the built app, not
  assumed from the literal in `main.js` — the same trap that produced the
  520px myth in the first place.
- **Non-goal**: this audit does not redesign Devices/Schedule's information
  density (grid vs. list, card content) — that's explicitly Commit D's scope.
- **Non-goal**: no change to Settings' internal architecture (rail, category
  switching, save/dirty-state) — it's already correct.
- **Protected and untouched by this audit**: timer execution, power
  execution, Dry Run/Live behavior, schedule execution, Phone Companion
  runtime, IPC, and packaging (aside from the window-geometry default itself,
  which is explicitly in scope pending your approval).
