# Lights Out — Windows and standalone Android

## Current truth

Lights Out is a local-first night timer and routine product. Windows and Android
execute independently and keep separate data. Optional phone-to-PC controls
require a running desktop. A shared builder and cross-device coordination are
future architecture; existing local calendars do not establish that architecture.

Windows **v11.2.0 is published** at
[GitHub Releases](https://github.com/lazelife420-spec/Lights-out/releases/latest),
from `335ba773b364dda45a26e60524cd1b95ed0b7f39`.
The [release qualification record](RELEASE_QUALIFICATION_11.2.0.md) describes the
Windows and Android evidence. Android source/debug qualification is separate
from production APK signing and physical-device reliability.

Use distinct labels: **SHIPPED**, **SOURCE-PRESENT**, **TEST-PROVEN**,
**FIELD-UNPROVEN**, **PLANNED**, **DEFERRED**, and **UNKNOWN**. Code, tests,
publication and physical proof are different claims. The Windows release scope
is complete; the broader platform roadmap remains open.

## Shipped

- Windows v11.2.0: Electron timer and safe power controls, profiles/calendar,
  Night Modes, receipts, settings/navigation polish and optional LAN PC controls.
  Installer and portable ZIP have verified source provenance and checksums.
- Windows WiZ selection, locally named room groups, brightness/white/RGB/presets
  and manual-off protection are shipped as **experimental and opt-in**. Automated
  UDP proof does not make the integration field-proven.
- Prior Windows release history belongs in `CHANGELOG.md` and release notes.
  The original five Windows pillars do not define completion of the platform.

## In-source awaiting qualification

- **Standalone Android:** native offline timer, foreground notification controls,
  screen-off alarms, phone-local WiZ, saved routines and recurring/date calendar
  rules are SOURCE-PRESENT and debug/emulator TEST-PROVEN. Current source is not
  a newly published production APK. Physical background/LAN behavior is
  FIELD-UNPROVEN. Phone data remains independent from Windows.
- **Optional Android PC controls:** separate QR/pairing WebView. Desktop protocol
  qualification and historical phone pairing do not substitute for current
  signed-APK and physical-device regression evidence.
- **Local Calendar Routine Builder v1:** a common versioned plan now covers
  explicit Windows/Android local ownership, validated timer actions, existing
  phone WiZ adapters, weekly/monthly/date recurrence, durable occurrence claims
  and visible outcomes. UI-to-executor candidates are TEST-PROVEN with isolated
  Windows Test Mode and Android loopback fixtures; no new public release is
  implied. Existing data and independent engines are preserved. See
  [the contract and migration boundary](CALENDAR_ROUTINE_V1.md).
  The local continuation corrects leap-day alarm lookup, adds explicit action
  editing with separate phone lighting targets, and correlates delayed Windows
  rituals through timer receipts. These changes remain local and unreleased.
  **LO-RIE-1** adds versioned offline files, native file pickers, previews, safe
  conflict copies and explicit local adoption. Windows/phone execution stays
  independent; file intent never grants remote authority. See
  [routine interchange v1](ROUTINE_INTERCHANGE_V1.md).
  **LO-SDH-0** adds locally tested mutual-TLS protocol components, explicit
  enrollment/recipient consent, replay/expiry/revocation checks and adapters into
  inactive import preview. Isolated endpoints only; no production listener,
  discovery, transfer UI or persistent key/trust management was enabled in that tranche. See
  [secured handoff foundation](SECURED_DEVICE_HANDOFF_FOUNDATION.md).
  **LO-SDH-1** adds protected persistent identity, durable trust/revocation/replay
  records and actual pairing/receiving UI through existing inactive import.
  Local opt-in WiZ timer experiences and phone notification beacons are now
  SOURCE-PRESENT, with loopback/emulator runtime evidence; see
  [light experiences v1](LIGHT_EXPERIENCES_V1.md). Physical light/phone
  reliability remains FIELD-UNPROVEN. The native cross-device TLS gate is open.
  Production LAN transport remains disabled; physical-device transfer is still
  FIELD-UNPROVEN. See [protected pairing v1](SECURED_DEVICE_PAIRING_V1.md).
- **Windows invisible-host objective:** Electron main owns the timer/listener/
  receipts. The reviewed v11.2.0 qualification reported seven lifecycle checks
  passing: close/reopen, single timer authority, tray controls, hidden completion,
  intentional Quit, crash recovery and cleanup. Instrumented startup also exposed
  a transient window in a secondary process that lost the lock, without a second
  timer or receipt. The uncommitted correction is now TEST-PROVEN: a fresh build
  passed seven cases in each of ordinary and instrumented startup modes, with
  zero secondary windows, trays, timer starts, startup listeners or receipt work.
  Ordinary startup used a safety bootstrap with unchanged candidate main code;
  the instrumented lane used the unmodified packaged candidate. See the ledger.
  No separate service/daemon is approved here.
- **Windows First Light:** Task Scheduler wake/sunrise source exists; supported
  wake states and physical lighting effects require their own qualification.
  A phone-owned morning path is PLANNED.
- **Hue and generic webhook source:** presence of adapter code is not qualified
  device support. Each needs a bounded spec, fixtures and authorized field tests.

## Active next

1. **Platform truth and Android evidence:** align documentation, preserve the
   qualified Windows release, close safe Android coverage gaps, and maintain the
   [Android field checklist](ANDROID_FIELD_QA.md). Current candidate details and
   command receipts are in [the execution ledger](PLATFORM_ALIGNMENT_EXECUTION_2026-10-16.md).
2. **Windows Host qualification: bounded local gate PASS.** Fresh ordinary and
   instrumented runs close the reviewed lifecycle/startup gate. The corrected
   candidate is committed locally and is not published. Listener opt-in
   and idle login remain safe defaults. No daemon migration is justified.
3. **Calendar Routine Builder continuation:** the first local vertical slice is
   implemented, including bounded local action editing and delayed Windows
   receipt correlation. Offline v1 import/export is implemented with validation,
   inactive drafts, conflict handling and explicit local adoption. Next, qualify
   future format migrations. The secured-handoff protocol foundation is locally
   implemented and isolated-test qualified. Next specify protected identity/key
   storage, durable trust/revocation, visible pairing/transfer consent and bounded
   connection policy before enabling a separately authorized LAN surface. No hidden
   synchronization, arbitrary remote execution or unsupported adapter claims.
4. **First Light extension:** specify a separately qualified phone-owned morning
   path and compatible lighting actions after routine ownership is explicit.
   Never promise PC-off execution from a Windows-only adapter.

These are sequenced engineering gates, not claims that host migration, shared
scheduling or new adapters are already built or released.

## Blocked on hardware or permissions

- Physical Android notification/precise-alarm/OEM background, reboot/unlock,
  Wi-Fi/broadcast discovery, bulb acknowledgement and manual-off reliability:
  **HOLD** pending owner-authorized phone/router/bulb tests.
- New production-signed Android APK: separate owner-controlled signing and
  distribution gate. Never inspect or create the production signing identity.
- Real router control, new Hue/webhook support, physical sunrise and PC wake
  behavior: require a real supported integration and specific hardware authority.
  An absent adapter is blocked or planned; never simulate it as supported.
- Scoped, non-destructive local development and commits have standing owner
  authorization. Remote pushes/merges, release tags, `[release]` triggers,
  production signing and public deployment require separate authorization.

Hardware HOLDs do not reopen the qualified Windows v11.2.0 release. They constrain
what can be claimed for those surfaces and future independent release trains.

## Deferred

Keep these outside the current release and alignment tranche:

| Candidate | Why it remains deferred |
|---|---|
| Quiet House / School Night | Unavailable Night Modes; not release blockers. |
| Family Profiles / extensive household-member management | New local member-directory and assignment scope; see `FAMILY_PROFILES_V1_SCOPE.md`. LAN synchronization/authentication/remote mutation are not implied. |
| Kids Mode | Separate product and permission scope. |
| Focus scoring | Needs a historical event log and careful non-medical, non-guaranteed-productivity messaging. |
| Enforced screen-time limits | Current advisory behavior is not enforcement; blocking adds system-modification risk. |
| Wake-on-LAN | Not authorized as part of this tranche. |

## Maintenance and safety

Keep this as the single forward-looking roadmap. Move completed-task details and
audit history into changelog/release/evidence documents. Verify a line against
current source before starting it. Do not restart completed release repairs or
resurrect the removed PowerShell/WinForms app.

All device/network/system actions remain opt-in. Preserve independent timers,
reduced motion, accessible Stop/Cancel, explicit force-shutdown selection, idle
login startup, token-protected optional LAN controls and forbidden remote power
commands. Automated QA uses dry-run, owned emulators and fixtures. No fake sleep,
medical, hardware-support or execution claims.
