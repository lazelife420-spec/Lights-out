# LO-RIE-1 — offline routine interchange v1

This format projects the existing `routineModel` actions and calendar schedules.
It is portable intent, not an execution grant. Each installation retains its
own timer, local ownership, permissions, Test Mode policy and occurrence ledger.
There is no network transfer, account, synchronization or background listener.

## File contract

UTF-8 JSON, maximum 256 KiB, one object, nesting at most 16. Exact field sets,
unknown versions, duplicate fields, malformed JSON and dangling references are
rejected. One file contains 1–32 routines and 0–64 associated rules.

```json
{
  "format": "lights-out.routines",
  "schemaVersion": 1,
  "routines": [{
    "id": "night-1",
    "name": "Weeknight",
    "actions": [{
      "id": "timer",
      "type": "timer.start",
      "phase": "start",
      "parameters": {"seconds": 600, "endAction": "sleep"}
    }]
  }],
  "rules": [{
    "id": "leap-night",
    "routineId": "night-1",
    "name": "Leap night",
    "schedule": {
      "kind": "monthly", "time": "22:00",
      "weekdays": [], "monthDays": [29], "months": [2], "date": null,
      "timezone": "device-local", "dstPolicy": "shift-forward-first"
    }
  }]
}
```

Routine/rule IDs use 1–80 ASCII letters, digits, `_` or `-`; action IDs use
1–64. Names contain 1–60 printable characters with no surrounding whitespace.
IDs must be unique within each namespace, and action types/IDs within a routine.
Exactly one `timer.start` is required; duration is an integer 60–86,400 seconds.
Endings are `reminder`, `shutdown`, `sleep` or `hibernate`. A receiving platform
must explicitly resolve endings that its engine does not implement.

The existing Android adapter supports `wiz.warm` at phase `start`, with integer
`brightness` 10–100, and `wiz.off` at phase `timer-complete`. Both use
`parameters.bindings`, a nonempty array of up to eight unique abstract slot IDs
(1–32 ASCII letters/digits/`_`/`-`). The whole routine has at most eight slots.
The export replaces local addresses with `light-1`, `light-2`, etc.; equal slots
across actions retain target relationships. Adopted named slots retain their
names on subsequent exports. Addresses never enter the file.

Schedules use the existing weekly ISO weekdays (1–7), monthly days (1–31 or -1
for last), selected months (1–12), or one exact date (2000–2199). All selector
arrays are present and contain no duplicates. `date` is null except for once.
Clock times are HH:mm. The receiving device resolves its own timezone: gaps
shift forward and overlaps use the first instant. Platform late windows and
Windows' minimum scheduled countdown remain local execution policy.

## User flow and local authority

Windows exposes Routine files in Schedule; Android exposes it in Routines.
Select sources and export through a native file picker. Open a file, inspect
its routines/rules and capability warnings, then save inactive drafts. Parsing
and preview never write settings, start timers, claim occurrences or register
new alarms. Import performs one checked local-store write and never activates
native routines or rules.

Conflicting IDs reject the complete import by default. The explicit copy choice
allocates new conflicting routine/rule IDs and remaps references; action IDs
remain stable. A later adoption rechecks conflicts so a stale preview cannot
overwrite records created in the meantime. Names never trigger replacement.

Review local actions before adoption. On Windows, phone reminders require an
explicit power-ending choice and WiZ requires explicit omission. Scheduled
durations below 300 seconds need a reviewed longer duration. Adopted Windows
rules are disabled and require Test Mode; the optional manual start always uses
Test Mode. On Android, Windows endings require an explicit reminder choice;
each light slot must bind to a saved local light or lighting must be explicitly
omitted. Adopted phone calendar rules are disabled. Users subsequently enable
rules through the established native editors, subject to their existing access
and auto-start controls.

Compatible intent round-trips unchanged; explicit copies change only conflicting
identities/references. Unsupported intent remains intact in inactive drafts and
can be exported again. Adoption intentionally changes intent only where the
user chose a replacement duration/ending or omitted lighting. Local target
bindings, ownership and activation flags remain local.

## Persistence and compatibility

Drafts live in the existing calendar settings on Windows and phone-home config
on Android. Windows imports/adoptions use checked atomic settings replacement
and cache rollback. Android uses a single SharedPreferences commit, restoring
cached authority if persistence reports failure. Neither operation rewrites
receipts, consumed dates, active timers or unrelated sections. Failed previews,
conflicts and imports leave prior records intact.

Windows exports selected duration profiles, canonical built-in rule plans, or
imported intent. Selecting a profile also exports its associated rule plans;
each remains its own canonical routine so per-rule duration/ending overrides
are preserved. Clock/calendar-mode profiles and other Windows ending types are
outside v1 export. Android exports selected saved routines with all associated
rules, or inactive imported intent. Existing engine action IDs survive adoption
and edits. Existing schedules remain readable; no migration rewrites old data.

The format excludes owner/device IDs, local endpoints, credentials, tokens,
pairing material, receipt history, occurrence keys, force-shutdown, local safety
switches, warning preferences and unrelated settings. Unknown adapters and
privileged extra fields are rejected rather than retained as executable data.

Qualification evidence is under `review/LO-RIE-1-20261016/`. Actual Android
DocumentsUI/Storage Access Framework and Windows renderer/IPC/file I/O are
exercised; Windows QA supplies file-dialog selections through a test adapter.
Both local stores, all four exchange directions, rollback and existing timer
regressions are qualified independently from physical-device reliability.
Production signing/publication and secured handoff remain separate tranches.
