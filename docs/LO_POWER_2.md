# LO-POWER-2 — supported Windows Sleep/Hibernate engine

Status: **READY_FOR_GUARDED_ACCEPTANCE**. Development candidate only; the
promoted October 18 Desktop installation is unchanged. No physical power-state
transition, unattended night, or hardware wake reliability is qualified here.

## Implementation

`electron/native/WindowsSuspend.cs` replaces the unsupported suspend invocation
through rundll32. A small x64 .NET Framework 4.x helper calls the documented
`powrprof!SetSuspendState` API with three one-byte BOOLEAN arguments. Sleep uses
`(false, false, false)` and Hibernate `(true, false, false)`. Wake events stay
enabled. There is no automatic fallback, elevation, retry, hibernation enabling,
power-plan mutation, or change to Shutdown/Restart/Lock/Logout dispatch.

`GetPwrCapabilities` is read before readiness and again just before execution.
Sleep requires S1/S2/S3 or S0 low-power idle (AoAc); Hibernate requires S4,
a present hibernation file, and full file type 2. Reduced/absent/unknown file
types block Hibernate. The Windows 10+ SDK structure is 76 bytes; consumed
fields retain their documented byte offsets. Capability failure blocks safely.

The helper enables only its own existing `SeShutdownPrivilege`, checks both
the AdjustTokenPrivileges return and GetLastError (including 1300), restores
the previous privilege state, and closes the token. Privilege cleanup errors
are preserved separately and never rewrite an accepted request as a pre-request
block. The main Electron process never receives an enabled power privilege.

## Dispatch and safety

`windowsSuspend.js` requires an explicit executor. Production supplies spawn
and an absolute helper path beside the application. No shell is involved.
Starting the helper does not suspend the PC. A valid readiness message must
match the action and a random one-use request ID. The parent persists the
request event before sending the matching commit on stdin. Timeout, EOF,
invalid action, missing helper, or cancellation before commit cannot invoke
the native API. The helper independently rejects invalid or absent commits.

Existing Test Mode and QA power lock run before either dispatcher. Unsaved-work
scanning, its fail-closed behavior, save delay, Last Light and other completion
ordering remain unchanged. Emergency cancellation, replacement timers and quit
abort a pending pre-commit suspend preparation. Once the commit is delivered,
Windows might already be processing it; cancellation then reports an unknown
outcome and cannot promise recall.

Preparation is bounded at 5 seconds and output at 16 KiB. After commit, a
3-second observation deadline records `outcome_unverified` rather than assuming
failure or retrying. A native request can stay pending across suspend/resume.
The dispatcher retains one in-flight request until the helper closes and can
record a late API return against the original receipt. No fallback can turn
an unavailable Hibernate into Sleep or Shutdown.

## Evidence and user-visible results

The existing receipt states remain compatible. Helper exit code zero alone is
insufficient: a valid structured result, matching request ID, invocation event,
and clean close are required. API true produces `command_returned_success`
with `nativeAccepted: true`; API false produces `command_returned_failure`
with the Windows error code. Unsupported/denied requests produce `blocked`.
Missing/ambiguous results after commit remain unknown.

All evidence keeps `systemOutcome: unverified`. Main notifications and receipt
truth text say “Windows accepted API request; physical power state unverified”.
No successful-suspend or successful-shutdown receipt is manufactured. Historical
receipts are not migrated. Receipt persistence behavior is otherwise unchanged.

## Build and qualification

`npm run build:power` builds the helper for source development. Native packaging
always compiles the source into staged `resources/app/native/WindowsSuspend.exe`
before creating the archive and runtime hash manifest. A missing compiler is a
build failure. Run with the Windows .NET Framework 4.x runtime; no compiler or
PowerShell is needed for the installed execution path. The old experimental
prototype stays excluded and inactive.

Qualification on October 18 local / October 19 UTC:

- **1,222 unit tests pass; 0 fail.** Includes 48 focused dispatch/UI tests.
- **299 smoke checks pass; 0 fail.** Lint: 0 errors, one pre-existing warning.
- **23 C# fake-API checks pass**, including capability mappings, native arguments,
  denied privilege, error propagation, cleanup and truthful outcomes.
- **12 cross-process scenarios pass** through packaged JS, the production main
  action body and a separately compiled helper using the same adapter/protocol.
  Its `POWER_TEST` build selects only Fake; production contains no runtime fake
  selection switch. Actual production helper invocation is `--probe` only.
- **5 real packaged Electron timer/IPC/receipt cases pass:** accepted Sleep,
  accepted Hibernate, unsupported Sleep, denied Hibernate, failed Sleep. This
  lane uses immutable native/network denial and a protocol fake before app entry.
- Source/runtime manifest verification passes for **1,503 staged runtime files**.
- **Zero actual shutdown/sleep/hibernate/restart/lock/logoff actions; zero live
  smart-light actions.** All profiles used for qualification are isolated.

Evidence directory: `F:\LightsOutQA\LO-POWER-2-20261018`.
Staged candidate: repository `dist-native-lo-power-2-20261018` (not installed).
The real machine's read-only probe reports Sleep available, Hibernate unavailable,
Modern Standby false. That is a capability observation, not a suspend test.

Run the reproducible protocol qualification with:

```
node electron/scripts/windows-suspend-proof.js <packaged-resources-app> <fresh-evidence-directory>
```

The original nightly profile, promoted app, Desktop launcher/shortcuts, rollback,
live scheduled tasks, Windows power configuration and Android were not edited.
No commit, push, release, installation or overnight trial is part of this tranche.

## Primary API references

- [SetSuspendState](https://learn.microsoft.com/en-us/windows/win32/api/powrprof/nf-powrprof-setsuspendstate)
- [GetPwrCapabilities](https://learn.microsoft.com/en-us/windows/win32/api/powrprof/nf-powrprof-getpwrcapabilities)
- [SYSTEM_POWER_CAPABILITIES](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-system_power_capabilities)
- [Windows SDK header, including HIBERFILE_TYPE_FULL](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/winnt.h)
- [AdjustTokenPrivileges](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-adjusttokenprivileges)
