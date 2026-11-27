# Power-action truth and unattended qualification

Scope: `LO-POWER-TRUTH-01`, then gated `LO-OVERNIGHT-RELIABILITY-01`.
The restored cockpit, stylesheet, living lamp and existing countdown semantics
remain the reference. This work does not qualify a real Windows power transition.

## Evidence predicates

| Receipt state | Evidence required | What it does not establish |
| --- | --- | --- |
| `timer_elapsed` | The existing countdown reaches its completion callback | A command request or Windows state change |
| `action_requested` | The receipt persistence attempt finishes before calling the injected executor | Durable proof when persistence says unsaved; successful spawn |
| `command_spawned` | The child emits `spawn` after listeners are attached | Successful command return or a Windows state change |
| `command_returned_success` | Observed `exit`/`close` has integer code 0 and no signal | Shutdown, restart, sleep, hibernation, lock or logout occurred |
| `command_returned_failure` | Observed command exit code is nonzero with no signal | Whether Windows independently changed state |
| `spawn_failed` | Synchronous spawn throw or asynchronous pre-spawn error | A Windows outcome |
| `outcome_unverified` | Signaled child, bounded observation expiry, post-dispatch cancellation, observer error after launch, or startup finding an in-flight request | Success or failure of the requested Windows action |
| `cancelled` | Cancellation before dispatch, or the existing timer cancellation path | Recalling an already dispatched OS command |
| `blocked` | QA power lock, rejected action, unsupported Sleep/Hibernate state, or a fail-closed completion check (an unsaved-work scan that failed or passed its 15-second bound, or a Wi-Fi Guard restore that could not be confirmed) | Any dispatch |
| `missed` | A non-Test countdown whose deadline passed more than 5 minutes earlier (PC asleep or hibernated through it); checked on the tick and again just before dispatch | Any dispatch; no power action is requested. Caught on the tick, the run ends like a cancel: smart lights are restored, Wi-Fi Guard's block is undone and wind-down effects end, paused media is not restarted, and no partner message is sent. Caught just before dispatch, the completion side effects have already happened (the streak and bedtime-estimate events, the completion partner message and, if enabled, the Last Light finale) and only the power request is skipped; the smart lights are switched off only after this check, just before the power request, so here the lights the countdown dimmed are restored instead |
| `dry_run_completed` | The existing Test Mode ending | PC power actuation |

`powerEvidence.events` retains the observed transition timeline and return data.
`timerElapsedAt`, `plannedEndsAt`, `endedAt` and `reconciledAt` have separate roles.
Duplicate exit/close/error events cannot finalize the same dispatch twice.
Observation is bounded to three seconds; host shutdown may terminate Electron
before any terminal event. A later launch never replays an in-flight command.
There is no independent OS-outcome verifier in this tranche and no supported
transition to `system_outcome_observed`. The observed-outcomes count is therefore
zero, meaning **no outcomes independently verified**, not that no action occurred.

The command adapter requires an explicit executor. Production supplies the
Windows `spawn` binding for the four command mappings (Shutdown, Restart and Log
out through `shutdown.exe`, Lock through `rundll32 user32.dll,LockWorkStation`);
tests supply non-actuating fakes. Sleep and Hibernate have no command mapping:
they go only to the injected native suspend adapter (see below), and a missing
adapter blocks them. Force `/f` remains opt-in for shutdown/restart. Listeners are
attached before relying on child events, and `unref` follows terminal evidence or
bounded observation. No native command is invoked by dispatcher unit tests.

Node distinguishes process creation, errors and process termination; successful
spawn is not successful command execution ([Node child-process documentation](https://nodejs.org/api/child_process.html#event-spawn)).
Even the typed `ExitWindowsEx` API returns asynchronously and does not establish
that shutdown completed ([Microsoft ExitWindowsEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-exitwindowsex)).

## Historical data, Proof and ritual record

Existing `power_executed` and `completed` receipt fields remain intact and are
displayed as **legacy/unverified**. Read-time interpretation also applies to
calendar routine history, including entries whose receipt is unavailable.
New records use receipt version 2. The legacy `completed` statistics key remains
for compatibility but is labeled **Unverified endings**, never confirmed Windows
actions. Timer endings, Test Mode, command failures and operating mode are separate.
All Proof views, history, clipboard copy, exports and partner notifications follow
this distinction. Unsaved receipts carry an explicit persistence warning.

The existing streak calculation is deliberately unchanged: non-Test timer endings
and emergency overrides create ritual events, and historical unflagged events
retain their existing treatment. Night grouping, deduplication, retention,
achievements and sleep-deficit estimates are not recalculated or migrated.
Ritual records do not establish completed Windows actions or measured sleep.
Test Mode skips the final PC power action. Since this tranche it also skips the
automatic wind-down effects (smart-light dim/off/restore, Night Light, closing
apps, media pause, Wi-Fi Guard, Content Blocker, window lockout) and
accountability-partner messages (`main.js` `applyDimPhase`, the countdown tick
and `sendAccountability`). Qualification disables and intercepts all device
effects independently.

## Receipt persistence and failure behavior

The receipt store writes and flushes a verified `.pending` snapshot, retains the
last valid primary as `.bak`, and atomically renames the pending snapshot over the
primary. A newer interrupted pending snapshot or valid backup can be recovered
on opening. Corrupt originals are retained before a recovered replacement.
Existing 100-receipt retention remains; the preceding snapshot is retained.
Filesystem flushes and rename are bounded application evidence, not a guarantee
against every filesystem, storage-device or power-loss failure.

A failed write remains visible as unsaved, with an error code. It does not silently
block the user's power intent. Subsequent writes retry the in-memory ledger.
If no existing history snapshot can be read, existing files are left intact and
the store remains memory-only until a later reopening can read them. Empty failed
reads report **unavailable**, rather than falsely saying there is no history.
An unavailable Electron user-data path never redirects proof into another profile.
Non-Electron test/CLI fallback files are isolated by process ID.
Failed history deletion restores the in-memory ledger; its uncommitted empty
snapshot is not recoverable as a successful deletion on restart.

## Sleep/Hibernate: native WindowsSuspend.exe dispatch

When this tranche was written, Sleep/Hibernate still used `rundll32` mappings,
whose observation is only process evidence: Microsoft restricts `rundll32` to
entry points designed for it
([rundll32 documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/rundll32)).
That is superseded by [LO_POWER_2.md](LO_POWER_2.md). Current source has no
`rundll32` Sleep/Hibernate path and no fallback:

- `powerActionDispatcher.js` returns no command for `sleep`/`hibernate` and
  sends both only to the injected suspend adapter; without one the request is
  `blocked` (`native-suspend-adapter-unavailable`).
- `main.js` injects `windowsSuspend.js` with the helper at
  `native/WindowsSuspend.exe` beside the app. Native packaging compiles it from
  `native/WindowsSuspend.cs` (.NET Framework 4.x), which calls the typed
  `SetSuspendState` `BOOLEAN(BOOLEAN, BOOLEAN, BOOLEAN)` API
  ([Microsoft SetSuspendState](https://learn.microsoft.com/en-us/windows/win32/api/powrprof/nf-powrprof-setsuspendstate)):
  Sleep `(false, false, false)`, Hibernate `(true, false, false)`.
- The helper reads `GetPwrCapabilities` before it reports readiness and again
  just before the call. Sleep needs S1/S2/S3 or modern standby; Hibernate needs
  S4, a present hibernation file and the full file type. Otherwise the result
  is `blocked` (`unsupported-state`) and no request is made. A blocked Hibernate
  is never turned into Sleep or Shutdown.
- The parent records `action_requested` before sending a one-use commit with a
  random request ID. Cancellation before the commit stops the request; after it,
  the outcome is unknown and cannot be recalled.
- API acceptance is `command_returned_success` with `nativeAccepted: true`; the
  physical Windows transition stays `unverified`. Physical Sleep/Hibernate on
  real hardware is not qualified by this document or LO_POWER_2.

## Qualification boundaries

Gate A requires source review, focused event/persistence/Proof regressions,
preservation of the accepted UI and a packaged non-actuating execution proof.
Packaged QA installs immutable subprocess and network denials before the first
product statement, uses an exact isolated user-data path, verifies all packaged
application inputs, and has an independent Windows process-start observer with
a harmless positive control. Native power/light executors are never delegated.
QA also blocks login registration, shell jump-list replacement and global-hotkey
registration; those shell behaviors are not field-qualified by this fixture.

After Gate A, three individually identified real-clock overnight conditions are
ordinary open window, X-to-tray, and launcher exit with surviving application.
Each record must state actual runtime, profile/executable/source identities,
checkpoints, discontinuities and executor results. Short fault checks are separate
from these trials and never count as overnight evidence. Shared host/night trials
must be described as such, not as three independent nights or machines.
An interrupted request is unknown, not a presumed completed Windows action.
Event ID 41 alone cannot attribute a missed night to Lights Out
([Microsoft Event ID 41 guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/event-id-41-restart)).
