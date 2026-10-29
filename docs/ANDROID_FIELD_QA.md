# Standalone Android: physical qualification checklist

**Current field status: HOLD / FIELD-UNPROVEN.** Debug unit, build/lint and
emulator/UDP results are separate evidence. This checklist is not a test receipt.
The phone owns its timer, alarms and local lighting actions; PC controls are an
optional separate surface. No new production-signed APK is claimed here.

## Owner preparation and authority

- Record the reviewed source SHA, APK SHA-256, package/version, build type,
  phone alias/model, Android/API and security update, OEM battery policy, WiZ
  bulb models/firmware and network conditions. Do not record credentials, pairing
  tokens, Wi-Fi passwords, signing material or private connector URLs.
- Obtain explicit owner approval for the test phone, any phone reboot and the
  named bulbs' temporary On/Off/brightness changes. Router changes, PC power
  actions and unrelated household devices are outside this checklist.
- Use a separate `.debug` package for QA. Preserve the production install,
  pairing, data and signing identity. Production signing/distribution has a
  separate owner-controlled gate; never read signing properties or keystores.
- Record notification, Alarms & reminders and battery permissions before and
  after testing. Explain each grant. Restore agreed settings when finished.
- For the PC-off cases, record that the Windows machine is actually off. An
  emulator running on the PC or a missing desktop listener is not that proof.

## Cases to execute on approved hardware

| Case | Expected observation | Actual result / evidence |
|---|---|---|
| Offline phone timer | Bundled home loads without account/PC/network; start, pause, resume, +5 min and cancel retain correct independent state. | NOT RUN |
| Notifications denied then granted | Denial is visible and does not imply a delivered alert. Grant enables the active notification and visible finish alert. | NOT RUN |
| Exact alarms denied then granted | Phone calendar reports paused without access; manual timer reports delayed/inexact delivery. Grant restores precise scheduling. | NOT RUN |
| Background / screen off | With required permissions, countdown finishes and a real notification appears while screen stays asleep; reopen shows the same completed run. | NOT RUN |
| OEM battery restrictions | Compare normal policy with the owner's chosen restricted/optimized policy; record delays/failures honestly. No blanket reliability claim. | NOT RUN |
| Close/reopen / process recovery | Closing the UI is distinct from force-stop; the saved run/deadline survives reopening and a controlled app-process restart. | NOT RUN |
| Reboot and storage unlock | After an approved phone reboot and unlock, timer/calendar alarms restore without needing the UI. Record elapsed delay and completion behavior. | NOT RUN |
| Force-stop boundary | Force-stop suspends alarms; reopening restores saved state and scheduling. Do not claim delivery during force-stop. | NOT RUN |
| Wall clock / timezone / DST | Same-boot countdown remains monotonic; calendar re-evaluates local time. Use an isolated test device for time changes and record exact zone/date/rule. | NOT RUN |
| Recurrence and duplicates | Weekly, monthly/last-day and individual dates obey selected months; duplicate delivery/overlap creates at most one occurrence. | NOT RUN |
| Late / busy / deleted rule | More-than-two-minute late occurrences skip; an active or paused timer wins; deleting a saved routine removes future rules without mutating an active snapshot. | NOT RUN |
| Phone-native WiZ with PC actually off | Approved local bulb commands and scheduled routine lighting execute directly from the phone; report per-light acknowledgement/failure. | NOT RUN |
| Unreachable / negative WiZ acknowledgement | Timer continues; lighting failure is visible and is not reported as executed or silently replayed after reconnection. | NOT RUN |
| Discovery and stale addresses | Discovery works on the actual LAN or shows an honest failure; changed IP/offline targets do not cause public/other-device commands. | NOT RUN |
| Manual off / cancellation | Desktop dimming yields to the WiZ app's manual off; phone routine start is one explicit warm command, with no repeated power-on. Cancel does not resurrect lights or apply a captured finish-off later. | NOT RUN |
| Optional PC pairing | QR/URL pairing reaches the intended desktop; forbidden remote power commands stay blocked. Operating the PC timer leaves the phone timer unchanged, and vice versa. | NOT RUN |
| Bridge and external navigation | Remote PC controls cannot call the phone's native bridge; returning home preserves independent phone state. | NOT RUN |
| Stop / failure recovery | Cancel remains reachable; notification controls target the current run only; no phone power action occurs at completion. | NOT RUN |

## Evidence and exit criteria

For each executed case, record start/end timestamps, exact build/source and
permission state, expected versus observed behavior, screenshots or redacted
logs, bulb acknowledgement and any measured delay. Leave unexecuted cases
NOT RUN. Keep owner/device evidence private unless separately approved.

Mark a specific phone/OS/bulb/network combination FIELD-PROVEN only after its
required cases pass. A failed or unexecuted case remains HOLD with a concrete
reproduction and next action. Do not generalize one device's success to other
OEM background policies, routers or lighting adapters.

Field proof does not authorize production signing, uploading an APK, exposing a
LAN listener, router writes or starting the later unified automation tranche.
