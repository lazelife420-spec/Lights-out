# Lights Out — Phase 5F-C: Custom Timer Arm Model Source Audit

Read-only audit. No code changed. Checkpoint: `28dca57`, pushed, working
tree clean. Every claim below is grep/read-verified directly against
`electron/renderer.js`, `electron/renderer-night-modes.js`, and
`electron/main.js` — both the renderer AND main-process sides of the
round trip, not renderer assumptions alone.

---

## 1. How `state.armedNightMode` actually works

```js
function armNightMode(mode) {
  state.armedNightMode = {
    nightModeId: mode.nightModeId,
    nightModeTitle: mode.nightModeTitle,
    durationSeconds: mode.durationSeconds,
    action: mode.action,
    ritualId: mode.ritualId || 'none'
  };
  renderArmedModeBanner();
  persistArmedNightMode();
}

function clearArmedNightMode() {
  state.armedNightMode = null;
  renderArmedModeBanner();
  persistArmedNightMode();
}
```
(`renderer.js:2176-2192`)

Both functions do exactly three things: mutate a plain in-memory `state`
field, re-render the existing current-plan banner (Phase 5A), and persist
the value to disk via `persistArmedNightMode()`. Neither calls
`startTimer()`, `api.startTimer()`, or anything power/timer-adjacent.

`persistArmedNightMode()` (`renderer.js:2168-2174`) does exactly one
thing: `await api.saveAppSettings({ app: { armedNightMode: state.armedNightMode } })`
— a settings-persistence IPC call, the same category the Dry Run toggle
already uses. Not a timer/power IPC call.

## 2. Every real call site of `startTimer()`

Grepped `renderer.js` for `startTimer(` — six matches, all accounted for:

| Line | Context | Instant-start? |
|---|---|---|
| 2383 | `async function startTimer(...)` — the definition itself | n/a |
| 2397 | `await api.startTimer({...})` inside the definition — the actual IPC call | n/a |
| 2380 | `return startTimer(inputSeconds(), 'play');` inside `startTonightPlan()` | Yes — but `startTonightPlan()` itself is the single shared "Start" command, called from exactly 3 real UI entry points (Home's hero CTA via `handleHomeCta`, Tonight's `#btn-start-custom`, the Space keyboard shortcut) — this is deliberate, existing, and where every legitimate "start now" action already converges |
| 3563 | Top-menu quick-preset item (`item.dataset.minutes`) | Yes, instant |
| 3612 | Tonight's duration chips (`.chip` click handler) | Yes, instant |
| 3972 | Number-key keyboard shortcut (1-6) | Yes, instant |

**Every one of the three instant-start-outside-`startTonightPlan()`
call sites (3563, 3612, 3972) calls `clearArmedNightMode()` immediately
before `startTimer()`** — confirmed by direct read of all three. This is
an existing, deliberate safety-consistency pattern: instant-starting a
different duration always clears whatever was armed first, so the app
never has stale armed-mode state after a real start.

## 3. How `Use Tonight` arms without starting — verified end to end

Renderer side (`renderer-night-modes.js:279-324`, `useTonight()`):
```js
const result = await api.useNightModeTonight(nmSelectedId);
// ...loads result.durationSeconds/result.action into the Tonight UI...
armNightMode({ nightModeId: result.nightModeId, ... });
setAction(result.action);
```
No `startTimer()` call anywhere in this function.

Main-process side (`main.js:2213-2227`, the actual IPC handler) — the
comment is explicit, not inferred:
```js
ipcMain.handle('use-night-mode-tonight', async (e, nightModeId) => {
  const resolution = nightModes.resolveForExecution(nightModeId);
  if (!resolution.success) return resolution;
  // Return resolved options for the renderer to display in lobby.
  // The timer is NOT started here — selection remains inert.
  return { success: true, nightModeId: ..., durationSeconds: ..., action: ..., ritualId: ... };
});
```
Confirmed on both ends of the IPC boundary: arming a Night Mode is
provably inert. This is the existing, tested, safe precedent Phase 5F-B's
`homeCtaState()` already builds "Start Tonight" on top of.

**No hidden auto-start path exists.** Grepped every reference to
`state.armedNightMode` in `renderer.js` (11 occurrences) — persistence,
set/clear, CTA-state computation, banner rendering, and one read inside
`startTimer()` itself that only *attaches metadata* (`nightModeId`) to an
already-in-progress start call, gated by `origin === 'play'`. There is no
`if (state.armedNightMode) startTimer()` anywhere. Arming cannot trigger
a start by itself, under any code path found.

**Dry Run is untouched by arming, confirmed at the exact call site**:
`api.startTimer({ ..., dryRun: state.dryRun, ... })` reads whatever
`state.dryRun` is at the moment `startTimer()` actually runs — a
completely separate, unrelated piece of state that `armNightMode()`/
`clearArmedNightMode()` never read or write.

## 4. What custom-timer state is currently missing

`homeCtaState()` (`renderer.js:2204-2208`):
```js
function homeCtaState() {
  if (state.running || state.paused) return 'continue';
  if (state.armedNightMode || state.currentProfileId) return 'start';
  return 'choose';
}
```
A plain custom timer (duration stepper + action select, nothing armed,
no profile loaded) always falls into `'choose'`, which routes to Library
rather than offering a "commit to this plan, don't start it yet" step.
**There is no `state.armedCustomTimer` or equivalent** — the only two
things `homeCtaState()` recognizes as "there is a real plan" are an armed
Night Mode and a loaded saved profile. A user who just types a duration
into Tonight's stepper has no arm step at all today — only instant-start
chips or the direct Start Custom Timer button.

## 5. How to add "Arm Custom Timer" without touching the timer/power engine

The existing pattern is directly extensible, not something to invent:

1. A new `state.armedCustomTimer` boolean (or a small object mirroring
   `armedNightMode`'s shape, minus `nightModeId`/`nightModeTitle`) —
   pure UI state, same category as `armedNightMode`.
2. A new `armCustomTimer()` / equivalent to `clearArmedNightMode()` that
   sets this flag, re-renders the current-plan banner, and optionally
   persists it — modeled 1:1 on `armNightMode()`/`clearArmedNightMode()`,
   calling zero `api.*` functions beyond `saveAppSettings`.
3. `homeCtaState()` gains one more condition in its `'start'` branch
   (`|| state.armedCustomTimer`) — a one-line change to an already-tiny,
   already-tested function.
4. A new "Arm Tonight" button on Tonight's setup controls, wired to the
   new arm function — **not** to `startTimer()` or `startTonightPlan()`.
5. `checkArmedModeMatch()` (`renderer.js:2360-2366`, which already clears
   `armedNightMode` if the user edits the input fields away from the
   armed mode's canonical values) would need a matching branch for the
   custom-timer case, or an equivalent invalidation rule — this is the
   one piece of real new logic, and it's UI-consistency logic, not
   engine logic.

None of this requires touching `startTimer()`, `api.startTimer`, any
`ipcMain.handle` in `main.js`, or any power-execution path. It is
additive state and a new button, following the exact shape of a
mechanism that already exists, ships, and is already smoke-tested.

## 6. How to ensure arming never disables Dry Run or starts anything accidentally

Two guarantees, both already structurally true of the existing
Night-Mode arm path and directly inheritable by a custom-timer arm:

- **Never touch `state.dryRun`.** Confirmed above — `armNightMode()`/
  `clearArmedNightMode()` never read or write it, and `startTimer()`
  reads it fresh at call time from wherever the user last set it (footer
  pill / Settings / top-menu toggle). A custom-timer arm function that
  follows the same shape (touches only its own new field) inherits this
  guarantee for free — the risk is only introduced if someone writes new
  code that explicitly sets `state.dryRun` inside the arm function, which
  the existing pattern gives no reason to do.
- **Never call `startTimer()` from the arm function itself, or from
  anything reading the new armed flag except the real Start button's
  click handler.** The Night Mode precedent's safety comes specifically
  from `armNightMode()` containing zero calls to `startTimer`/`api.startTimer`
  — a custom-timer arm function must hold the same invariant. This is
  enforceable exactly the way it already is for Night Modes: a smoke
  check asserting the new arm function's body contains no `startTimer`
  call, mirroring the existing `'night-modes: Use Tonight does not
  auto-start timer'` check.

---

## Audit conclusion

All six required proof points are confirmed clean by direct source
inspection, spanning both the renderer and main-process sides of the one
IPC boundary involved. No hidden auto-start path, no Dry Run coupling,
and a directly reusable, already-proven pattern to extend. **Safe to
proceed to implementation** whenever you're ready — no code has been
written in this pass, and any future implementation should be held to
the same standard demonstrated here: new smoke coverage proving the new
arm function never calls `startTimer`, matching the existing Night Mode
check.

This is an audit only. No app code was changed or committed in this pass.
