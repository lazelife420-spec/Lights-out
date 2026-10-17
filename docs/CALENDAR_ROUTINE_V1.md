# Calendar Routine Builder v1 — local execution slice

Base: local platform-alignment commit `4c52470887b7a12b7abb7dbcbb79f7d3e63cb7b2`;
published origin/main remains `335ba773b364dda45a26e60524cd1b95ed0b7f39`.

Before v1, the Windows month planner, saved profiles, weekly/monthly/date rules,
Test Mode and main-process timer worked. Android had a native routine
editor, local calendar alarms, monotonic timer and direct WiZ adapter. They lacked
a common versioned action/ownership contract and durable structured calendar
outcomes. Windows currently records occurrence consumption after dispatch;
Android reports most outcomes as a single replaceable text message.

This slice keeps both timer engines and UIs. It adds a common v1 local plan,
adapts existing saved rules without rewriting or deleting them, claims calendar
occurrences before dispatch and exposes durable action outcomes. Windows local
countdowns and Android local reminders are supported; Android's existing WiZ
actions retain acknowledgement-based results. Cross-device execution, router,
new Hue adapters, cloud, signing and publication are outside this slice.

## Contract

A plan has `schemaVersion: 1`, stable `id`, `name`, `owner` with `platform`
(`windows` or `android`) and `deviceId: local`, an optional `schedule`, and
`actions`. Every action has stable `id`, `type`, `target: local`, `phase` and
validated `parameters`. Supported types: `timer.start` on both owners;
`wiz.warm` / `wiz.off` on Android through its existing adapter. Windows timer
end actions remain shutdown/sleep/hibernate; Android completion is a reminder.
No supplied plan may acquire a remote target or additional capability.

Schedules use weekly ISO weekdays, monthly selected days/months including -1
for the last day, or a single date. Timezone is `device-local`; spring gaps move
forward and autumn overlaps choose the first instant. Existing platform late
windows (Windows 60s, Android 120s) remain unchanged. An occurrence key combines
v1, platform, local, rule ID and local calendar date, not editable time or action
parameters. Existing consumed keys remain honored. The two installations keep
separate ledgers; this key is not a cross-device synchronization mechanism.

Occurrence claims are persisted before side effects. Failed claim storage prevents
dispatch. A crash after claim leaves an honest uncertain/accepted result and
does not automatically replay. Timer acceptance is distinct from completion;
WiZ success requires acknowledgement. Unsupported/unavailable targets fail
closed, busy timers are skipped, and cancel preserves existing cancellation
semantics. Local outcome history is bounded; it contains no pairing secrets.

## Implementation and acceptance plan

1. Shared JS model and pure tests: validation, migration, ownership, stable keys,
   recurrence compatibility, unsupported actions and Android/Windows parity.
2. Windows: persist canonical plans on calendar-rule save; attach them to built-in
   events; write-ahead ledger and existing timer adapter; display recent outcomes.
3. Android: native plan validation/serialization, atomic claim + receipt,
   timer lifecycle and WiZ result correlation; expose outcomes in Calendar.
4. Run full desktop unit/smoke/lint and isolated Android unit/lint/debug build.
   Exercise UI → persisted rules → executor → receipts with Test Mode, an owned
   emulator, no lamp targets, and isolated mock adapters. Recheck custody and
   commit only this slice locally after passing. No remote publication.

Legacy settings remain authoritative and readable. New saves add a plan;
existing rules acquire a projection in memory. Unknown future versions are
rejected instead of silently downgraded. Editing preserves stable IDs and old
occurrence claims. No automatic import, cloud account or handoff is introduced.

Physical Android/OEM/router/WiZ reliability remains FIELD-UNPROVEN. The published
v11.2.0 is SHIPPED; this implementation is a local candidate until separately
released. All parked features remain DEFERRED.

## Implemented boundary and qualification

The shared JS plan is byte-identical on both platforms. Android native plan JSON
was compared against that model through actual UI saves for date, weekly and
monthly rules. Unknown/fractional future versions and foreign ownership are
rejected at the native bridge. Existing rules are projected without rewriting
old data; a new save persists the canonical projection alongside legacy fields.

Windows uses `routine-outcomes.json` under the current installation's user data.
It fails closed on unreadable history or failed claim persistence. The existing
timer receipt supplies completion/cancel/simulation status. Delayed rituals carry
the occurrence identity through their one-use context into countdown state,
recovery snapshots and run receipts. The ledger advances from accepted to running
only when that countdown creates its receipt. Cancellation before the timer,
step failure and completion without a timer have explicit outcomes. Cancelling
the ritual overlay after timer handoff leaves the timer's authority intact.
Receipt lookup by occurrence also recovers display correlation if the ledger's
link update failed. Existing run-receipt storage remains best effort, so these
records are not a transactional audit guarantee. Pending rituals are interrupted
on restart; linked timers retain the existing explicit recovery flow.
Imported external events retain their existing
legacy path; the v1 write-ahead model currently covers built-in local rules.

Android atomically saves the new receipt and both old/new occurrence keys in
one preferences edit. Timer progress and WiZ target acknowledgements update
that receipt. A claimed-but-unconfirmed run is not replayed. Failed history
updates are disclosed without terminating an already-running/manual timer;
new calendar claims remain strict. Keys and logs are installation-local,
bounded history, not a distributed or tamper-proof audit service.

Fresh qualification includes 1,066 desktop units, 299 smoke checks, zero lint
errors, six Windows UI/dispatch cases, 64 isolated Android units/lint/debug build,
and seven native UI/alarm/adapter/receipt cases. The latter uses a UDP mock bound
only to the owned emulator's `127.0.0.1`; the real adapter requires acknowledgements
before marking lighting successful. A real 60-second reminder and finish action
completed, rejection remained failure, and cancel suppressed pending actions.
Corrupt debug history was injected to verify independent manual start/pause/cancel.
Final lifecycle/calendar compatibility receipts and exact hashes are in
`review/CALENDAR-ROUTINE-V1-20261016/QUALIFICATION.json`.

Failed test-fixture attempts are retained. Host-loopback routing was unavailable;
the mock moved into the emulator. A shell-PID interpolation error was corrected.
SIGTERM did not stop the fixture shells; their exact UID/token/ancestry was
verified before terminating only those QA processes, and actual absence was
checked. This cleanup correction is separate from product execution results.

The local continuation adds explicit action groups to both editors. Windows
rules can require Test Mode, which combines with app/profile Test Mode using OR;
unchecking it cannot override another Test Mode setting. Android saves separate
`warmTargets` and `offTargets`, falling back to legacy `targets` when absent.
Its native service snapshots finish targets when a run begins. Editing a routine
refreshes linked saved-rule plans while preserving rule IDs/creation times and
completed receipts. Optional WiZ actions can be enabled/removed with stable
type IDs (`timer`, `warm`, `off`); action order/offsets are not configurable.

Android recurrence now enumerates valid days in selected months. Impossible
selectors return immediately. The bound uses the 400-year Gregorian cycle and
the finite consumed-date set; it covers February 2028 to 2032 and 2096 to 2104.
It preserves shift-forward/first-overlap resolution and the original day key.
An owned emulator verified an actual AlarmManager deadline for February 29,
2032 through the UI, native persistence and scheduler.

Continuation evidence is kept separately under
`review/CALENDAR-CONTINUATION-20261016/`; v1 counts above describe the earlier
qualification, not the continuation. No new public release is implied.
The continuation passed 1,077 desktop units, 299 smoke checks, zero lint errors
(one existing warning), 74 isolated Android units/lint/debug build, nine Windows
and nine Android runtime cases, plus six Android calendar and six lifecycle
compatibility cases. No production power or lamp action was exercised.

Remaining engineering: independently timed action offsets, portable
plan interchange, explicitly secured local
handoff and availability negotiation. These are not silently represented as
implemented. Hardware/OEM reliability and Android production distribution
remain separate HOLDs; no cloud, daemon, router or new Hue adapter was added.
