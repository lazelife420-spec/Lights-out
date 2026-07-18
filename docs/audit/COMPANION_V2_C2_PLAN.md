# Lights Out Companion V2 — C2 Plan: Phone Night Mode Start

Date: 2026-07-17
Status: **Architecture plan only** — implementation blocked until C1 real-night observation is clean.
Target PR: `feat/companion-v2-c2-night-mode-start`
Baseline: `main` at `b991e61e3cfb847120de64f0dcb122b8fa36fa1b` (post-C1 merge commit)

## 1. What C2 adds

C2 lets the phone start a **canonical Night Mode** from the bedside companion.

Today (C1), the phone can only start a **custom** timer by picking an action and a duration. The desktop owns canonical Night Mode resolution, but the phone cannot reach it.

C2 exposes the same catalogue the desktop renders, lets the phone pick a mode, and has the desktop resolve and start that mode exactly as it would from the lobby's **Use Tonight** → **PLAY** flow. The phone becomes a Night Mode launcher, not just a custom-timer remote.

## 2. What C2 does **not** do

- Does not change the pairing protocol, token format, or transport.
- Does not add new Android source, signing, or release assets.
- Does not bump version, tag, or release.
- Does not change desktop timer execution, power-action execution, or updater logic.
- Does not make remote starts eligible for the standard ritual gateway; remote source still blocks ritual execution.
- Does not let the phone choose Dry Run, force shutdown, logout, hibernate, or custom durations when using a canonical mode.
- Does not implement command IDs, acknowledgements, foreground/background hooks, or token lifecycle — those are C3.

## 3. Current state audit (post-C1)

### 3.1 Desktop Night Mode resolution (already shipped)

`electron/nightModes.js` provides:

- `getCatalogue()` — returns all modes with availability.
- `getById(id)` — returns one mode.
- `resolveForExecution(id)` — validates availability and returns canonical timer options including `durationSeconds`, `action`, `ritualId`, `nightModeId`, `nightModeTitle`, `nightModeVersion`, `dryRun: false`, `forceShutdown: false`, `muteSystem: false`, `gracePeriod: 2`.
- `resolveNightModeStart(options)` — confirms a start still matches the canonical mode and returns the identity tuple.

Ready modes: `quick-sleep`, `lights-down`, `movie-wind-down`, `full-shutdown`.
Disabled modes: `quiet-house` (coming soon), `school-night` (needs router setup).

### 3.2 Desktop arming/start flow (already shipped)

1. Renderer calls `api.useNightModeTonight(id)`.
2. Main IPC handler calls `nightModes.resolveForExecution(id)` and returns resolved options **without starting**.
3. Renderer loads those values into the lobby and sets `state.armedNightMode`.
4. User presses **PLAY** (`ns-play-btn`); renderer calls `api.startTimer({ ..., nightModeId, startOrigin: 'play' })`.
5. Main's `startTimer` calls `resolveNightModeStart(options)`. If the options still match the canonical mode, `nmIdentity` carries the canonical title/version/ritualId; otherwise it is cleared.
6. `startDecision.resolveStartDecision` chooses direct countdown vs standard ritual. Local PLAY and profile-start are eligible origins; a generic `source === 'remote'` blocks the ritual gateway. C2 adds a trusted `companion-night-mode` origin set by main after validating the canonical `nightModeId`, so a phone Night Mode start can enter the ritual gateway when the resolved mode's `ritualId` is `standard`.

### 3.3 Companion protocol today (C1)

Client → server messages are validated by `remoteControl.validateCompanionMessage`:

- `start`: requires `timerAction` ∈ {shutdown, sleep, restart} and `durationSeconds` ∈ [60, 86400].
- `togglePause`, `snooze`, `cancel`.

Main's `handleCompanionMessage` handles `start` by calling `startTimer({ durationSeconds, action, source: 'remote' })`. No `nightModeId`, no `dryRun`, no `forceShutdown` is passed, so phone starts are always **Real Action** custom timers.

Server → client messages today are only `type: 'state'` broadcasts.

### 3.4 Companion UI today (C1)

Idle screen shows:
- Action segment (Sleep / Shut down / Restart)
- Quick-start grid (15 / 30 / 45 / 60 min)
- Custom minutes + Start
- Explicit "REAL ACTION" warning and a native `confirm()` before starting.

Active screen shows countdown, add-time (+5/+15/+30), pause/resume, cancel.

## 4. C2 product contract

### 4.1 User flow

1. Phone is paired and connected (same as C1).
2. When idle, the phone shows a "Start from a Night Mode" section in addition to the custom-timer controls.
3. Tapping it expands a scrollable card list matching the desktop Night Modes library (same artwork, title, subtitle, duration, action tag, availability status).
4. Selecting a mode opens a detail view with the canonical timeline and a **Start Tonight's Run** button.
5. The button shows whether the resulting run will be **Dry Run** or **Real Action** based on the desktop's current dry-run setting.
6. After a single tap, the phone enters a pending state. It shows success only when the desktop broadcasts an authoritative state change.
7. The desktop starts the mode with canonical duration/action, inherits the desktop dry-run setting, and records the Night Mode identity on the receipt.

### 4.2 Phone-to-desktop message contract

Add two client → server actions:

```json
{ "action": "getNightModes" }
```

Server replies with a one-off broadcast:

```json
{
  "type": "nightModes",
  "modes": [
    {
      "id": "quick-sleep",
      "version": 1,
      "title": "Quick Sleep",
      "subtitle": "A short countdown, then sleep this PC.",
      "artworkId": "quick-sleep",
      "status": "ready",
      "availability": { "supported": true, "reason": null },
      "timer": { "durationSeconds": 900, "action": "sleep", "ritualId": "none" },
      "actions": [{ "type": "start-timer" }],
      "tags": ["15 MIN", "SLEEP", "READY"]
    }
  ]
}
```

Only the server decides availability; the phone cannot arm a disabled mode.

```json
{ "action": "startNightMode", "nightModeId": "quick-sleep" }
```

Server validates:
- `nightModeId` is a non-empty string.
- Mode exists and `isAvailable(mode)` is true.
- `resolveForExecution(id).success` is true.

Then calls `startTimer({ ...resolved, source: 'remote', startOrigin: 'remote-night-mode' })`. The desktop's current `settingsStore.getSection('app').dryRun` value is passed so the run matches the desktop toggle.

### 4.3 Server-to-phone additions

- `type: 'nightModes'` response to `getNightModes`.
- Existing `type: 'state'` already broadcasts `dryRun`, `nightModeId`, `nightModeTitle`, `nightModeVersion`, `profileId`, `profileName` — sufficient to show the result.

## 5. Implementation plan

### 5.1 Protocol validation (`electron/remoteControl.js`)

Extend `validateCompanionMessage`:

- Add `'startNightMode'` to `COMPANION_ACTIONS`.
- For `startNightMode`: require `nightModeId` to be a non-empty string; reject any supplied `durationSeconds`, `timerAction`, `dryRun`, `forceShutdown`, or other fields.
- Keep existing `start` validation unchanged so custom timers still work.

Add unit tests in `electron/test/remoteControl.test.js`:
- `startNightMode` accepts a valid ID.
- Rejects missing / non-string / empty ID.
- Rejects injected `timerAction`, `durationSeconds`, `dryRun`, `forceShutdown`.

### 5.2 Main process handling (`electron/main.js`)

In `handleCompanionMessage`:

```js
case 'startNightMode': {
  const resolution = nightModes.resolveForExecution(msg.nightModeId);
  if (!resolution.success) break;
  const appSettings = settingsStore.getSection('app') || {};
  startTimer({
    ...resolution.resolved,
    source: 'remote',
    startOrigin: 'companion-night-mode',
    dryRun: appSettings.dryRun === true
  });
  break;
}
```

Important: spread `resolution.resolved` first, then override `source`, `startOrigin`, and `dryRun` so the phone cannot smuggle them. `dryRun` must come from the desktop setting only.

The trusted `startOrigin: 'companion-night-mode'` is added to `profileRitualContext.ELIGIBLE_ORIGINS`, and `startDecision` allows ritual gateway when this origin is present even though `source: 'remote'`. Generic remote starts still cannot set this origin because `validateCommand` / `validateCompanionMessage` do not let callers pass `startOrigin`; only main sets it after canonical mode resolution.

### 5.3 Companion server catalogue broadcast (`electron/companion.js`)

Add a targeted send helper so the server can reply to one client:

```js
function sendToClient(client, data) {
  if (!client || !client.socket || !client.alive) return false;
  try {
    client.socket.write(encodeWS(JSON.stringify(data)));
    return true;
  } catch {
    return false;
  }
}
```

Pass the client through `emitter.emit('message', result.message, client)` (already done).

In `handleCompanionMessage`, when receiving `getNightModes`, reply with catalogue. Options:

**Option A (preferred):** keep the existing `onMessage` callback shape and add a `companion.sendToClient(client, { type: 'nightModes', modes })` call inside `handleCompanionMessage` in `main.js`. This avoids turning the companion module into a request router.

**Option B:** expose a new `companion.onRequest(handler)` API. Avoid unless Option A becomes messy.

Catalogue filtering: send the full `getCatalogue()` result. The phone can render disabled cards as unavailable.

### 5.4 Companion UI (`electron/companion.html`)

New elements (add inside `#idle-controls` or a new section after it):

- `<div id="night-mode-section">`
  - Header: "Start a Night Mode"
  - Button: "Choose a preset bedtime"
  - Expandable card grid (`#night-mode-grid`)
- Each card mirrors desktop `renderer-night-modes.js` rendering: artwork emoji, title, subtitle, duration tag, action tag, availability badge.
- Disabled cards are visible but non-interactive and visually dimmed.
- Tapping a ready card opens a detail overlay (`#night-mode-detail`) with timeline and a primary **Start Tonight's Run** button.
- The detail overlay shows the current desktop dry-run state by reading the latest broadcast (`latestState.dryRun`). Label: "This run will be: REAL ACTION" or "This run will be: DRY RUN".

State/JS changes:
- On WebSocket open, send `{ action: 'getNightModes' }`.
- Handle incoming `type: 'nightModes'` by storing `nmCatalogue` and rendering the grid.
- Reuse existing `beginPending` / `confirmPendingFromState` for the start button: disable, show "Waiting for PC…", clear only on authoritative state change.
- The start button sends `{ action: 'startNightMode', nightModeId: selectedId }` exactly once.
- If the server replies implicitly through the state broadcast, success is confirmed when `state.running` becomes true with a matching `nightModeId`.

### 5.5 Styling

- Reuse desktop Night Mode CSS variables where possible.
- Cards must be at least 48 px touch targets.
- Layout must not clip at 320–430 px widths (carry forward C1 responsive fixes).
- Reduced-motion support preserved.

## 6. Safety rules and invariants

| Invariant | How it is enforced |
| --- | --- |
| Phone cannot choose Dry Run | `dryRun` is read from desktop `settingsStore` and passed to `startTimer`; any phone-supplied value is overwritten. |
| Phone cannot choose custom action/duration for a Night Mode | Only `nightModeId` is accepted; canonical values come from `resolveForExecution`. |
| Phone cannot arm a disabled/unknown mode | `resolveForExecution` rejects `coming_soon`, `needs_router_setup`, `needs_device_setup`, `unsupported`, and unknown IDs. |
| Phone cannot choose, forge, bypass, or directly invoke a ritual | The phone sends only `nightModeId`; main resolves the mode and sets the trusted `startOrigin: 'companion-night-mode'`. Ritual gateway is entered only when the resolved mode's `ritualId` is `standard`. Generic remote starts still cannot forge this origin because `validateCommand` / `validateCompanionMessage` strip `startOrigin`. |
| Force shutdown / logout / hibernate remain impossible | Night Mode catalogue actions are within `ALLOWED_ACTIONS`; `resolveForExecution` returns `forceShutdown: false`; `validateCompanionMessage` strips force fields. |
| Single-send, no replay | Reuse C1 `beginPending` / `confirmPendingFromState`; no automatic retry. |
| Authority remains on desktop | Phone reflects desktop state broadcasts; it does not invent success. |

## 7. PR sequence

Recommended as a single focused PR, `feat/companion-v2-c2-night-mode-start`, because the protocol, main, and UI changes are tightly coupled.

### Commit structure

1. `feat(companion-protocol): add startNightMode and getNightModes message validation`
2. `feat(main): handle startNightMode by resolving canonical mode from desktop`
3. `feat(companion): send targeted nightModes response`
4. `feat(companion-ui): add Night Mode picker and detail overlay`
5. `test: extend unit, protocol, smoke, and electron proof for C2`

## 8. Test and proof plan

### 8.1 Unit tests

`electron/test/remoteControl.test.js`:
- `validateCompanionMessage` accepts `startNightMode` with valid ID.
- Rejects missing / invalid / empty ID.
- Rejects injected fields (`timerAction`, `durationSeconds`, `dryRun`, `forceShutdown`).

`electron/test/nightModes.test.js` (extend if needed):
- Remote `startOrigin` combined with a canonical mode does not bypass ritual gate (already covered indirectly by `startDecision.test.js`, but add an explicit companion-path test).

### 8.2 Isolated protocol tests

`electron/test/companion-frames.test.js` or new `electron/test/companion-c2.test.js`:
- `getNightModes` request yields a `nightModes` response containing the full catalogue.
- `startNightMode` with ready ID results in an outbound state broadcast with matching `nightModeId`, `nightModeTitle`, `nightModeVersion`.
- `startNightMode` with disabled/unknown ID is rejected and does not emit a start command.
- `startNightMode` with injected `dryRun: true` still starts as Real Action (mock desktop setting off) or Dry Run (mock desktop setting on), but never the phone's value.

Use a test seam or monkey-patch `settingsStore` to control `dryRun`.

### 8.3 Smoke tests

`electron/scripts/smoke-test.js`:
- `remoteControl.validateCompanionMessage` recognizes `startNightMode`.
- `handleCompanionMessage` case for `startNightMode` exists and calls `nightModes.resolveForExecution`.
- Companion HTML contains `#night-mode-section`, `#night-mode-grid`, `#night-mode-detail`.
- Start button has correct accessibility label and single handler.

### 8.4 Electron proof

Extend `electron/scripts/companion-v2-electron-proof.js`:
- Open companion viewport at phone size.
- Request and verify catalogue renders all four ready modes and two disabled modes.
- Select `quick-sleep`, verify detail shows duration/action.
- Start it; verify state broadcast shows `nightModeId: 'quick-sleep'`, `nightModeTitle`, action `sleep`, duration `900`.
- Select disabled `quiet-house`; verify start button is absent or disabled.
- Attempt to forge `startNightMode` with unknown ID; verify no command log entry and no state change.
- Attempt to forge `startNightMode` with `dryRun: true`; verify the started run respects desktop setting, not phone value.
- Keep every proof in Dry Run and cancel it.
- Expected proof result: ≥ 12 new assertions, all green, zero real power actions.

### 8.5 Packaged smoke

`electron/scripts/packaged-smoke.js`:
- No changes required unless the UI changes affect launch/minimize behavior; expected to remain 11/11.

## 9. Expected validation after implementation

- `git diff --check`: clean
- `npm run lint`: zero errors/warnings
- `node --check` on all shipped JS: clean
- Unit tests: 216 + new tests pass
- Smoke tests: 239 + new checks pass
- Isolated companion protocol suite: 41 + new tests pass
- Companion-v2 Electron proof: 59 + C2 additions pass, 12+ commands, zero real power actions
- Packaged smoke: 11 passed
- `npm audit`: zero vulnerabilities

## 10. Real-night observation gate

Do **not** merge C2 until C1 has several nights of real use with no regressions in:

- Reconnect after phone backgrounding
- `+5` / `+15` / `+30` exact-once behavior
- Pause / resume
- Cancellation
- Stale / offline recovery
- Any duplicated or uncertain command behavior
- Readability and reachability from bed
- Dry Run / Real Action labeling

C2 implementation can be written and reviewed in parallel with observation, but merge and release must wait for a clean observation log.

## 11. Out-of-scope notes

- C3 owns command IDs/acks, idempotent pause/resume, stale-session policy, foreground/background hooks, token lifecycle, and packaged-desktop-plus-real-phone proof.
- Real-phone LAN testing remains best-effort due to environment variability; the Electron proof plus isolated protocol tests are the merge gate.
- No changes to Android, signing, versioning, tags, or release assets.
