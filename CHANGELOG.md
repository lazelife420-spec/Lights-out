# Changelog

## Unreleased

- Redesigned Windows Lighting settings and the standalone Android light builder
  with visual mode cards, compact previews, clearer light selection, separate
  alert sections and a persistent phone save bar. Connection help is collapsible;
  controls follow the chosen mode/provider. Preview scrubbing no longer marks
  settings as edited, and delayed phone refreshes preserve unsaved changes.
  Desktop navigation, page typography and timer controls now share a clearer
  visual hierarchy. Saved phone connections and manual room controls fold away
  to keep timer modes in reach.

- Added opt-in WiZ Room Hourglass, Orbit and Ember timer modes with screen-only
  previews. Windows offers a separate final-six-second beacon; Android has
  independent timer/reminder and selected-app beacon switches, separate light
  targets, explicit OS notification access and an app allowlist. Manual off
  releases lights; beacons restore only still-owned, on lights. No notification
  message text is read or stored. Physical-device reliability remains unproven.

- Added LO-SDH-1 protected device identities, durable pairing/revocation/replay
  storage, and Windows/Android pairing and receiving screens. Windows uses
  current-user DPAPI; Android uses non-exportable AndroidKeyStore key handles.
  Authenticated enrollment, recipient acceptance and inactive import remain
  separate confirmations. Production LAN transport/discovery remains disabled;
  see `docs/SECURED_DEVICE_PAIRING_V1.md` for scope and security limits.

- Added LO-SDH-0 secured routine-handoff protocol foundations for Windows and
  Android: explicit fingerprint enrollment, mutual TLS, fresh recipient
  challenges, bounded expiring transfers, revocation and separate confirmation
  before saving inactive LO-RIE-1 intent. Isolated Node/Kotlin loopback and native
  Android storage proofs qualify the foundation. Production listeners, discovery,
  persistent device trust/key storage and transfer UI were deferred to LO-SDH-1.
- Routine files now explain that Windows Test Mode skips final PC power actions
  while other explicitly enabled wind-down effects may still run.
- Added LO-RIE-1 offline routine files on Windows and standalone Android. The
  shared versioned JSON contract exports selected timer/action intent and
  associated rules without endpoints, credentials, ownership grants or history.
  Native file pickers, previews, explicit conflict copies and checked local
  writes preserve existing data. Imports remain inactive until reviewed; local
  adoption saves calendar rules disabled and requires explicit resolution of
  platform endings and light bindings. No networking or handoff was added.
- Corrected Android leap-day recurrence beyond the old 741-day cutoff, including
  the non-leap century gap. Selected-month candidates, consumed dates and DST
  policies retain their existing meaning; saved schedules are unchanged.
- Made local routine actions explicit in both editors. Windows rules can require
  Test Mode; Android warm-start and finish actions can select different saved
  WiZ lights. Edits preserve identities and refresh saved calendar plans without
  rewriting a running timer or its receipts.
- Correlated delayed Windows calendar rituals with their eventual timer receipts.
  Accepted, running, cancelled, simulated completion and failure stay distinct;
  a ritual ending without a timer never reports completion. Calendar preparation
  respects timed steps; phone ritual starts retain immediate fast-forward.
- Added a common v1 local routine/action contract for Windows and standalone
  Android, with explicit local ownership, weekly/monthly/date schedules and
  stable local-day occurrence identity. Existing saved rules and timer engines
  remain compatible; cross-device execution and cloud synchronization are absent.
- Calendar dispatch now records durable claims before execution and exposes
  recent outcomes. Phone WiZ results distinguish acknowledgement, failure and
  cancelled finish actions. Corrupt history does not disable manual phone timers.
- Corrected Android weekly rules to respect selected months, matching the shared
  model and planner. Checked desktop calendar saves roll back after disk failure.
- Guarded queued Electron readiness after losing the single-instance lock, so
  a quitting secondary cannot initialize a window, tray or startup services.
  Added focused primary-startup, lock-loss and second-instance focus regressions.
- Corrected Windows update discovery documentation to name Proof Foundry
  machine-truth release metadata, and normalized roadmap line endings.
- Clarified Windows + standalone Android positioning, independent execution and
  release trains. Reorganized the single roadmap around shipped work, source
  awaiting qualification, active next gates, hardware/permission blockers and
  deferred scope. Added a physical Android/WiZ QA checklist; field reliability
  remains unqualified.
- Added guarded Android emulator lifecycle/calendar QA for permission denial and
  grant, offline controls, timezone/clock changes, stale commands, process
  recovery, screen-off notifications and early/duplicate/late alarm delivery.

## v11.2.0 — 2026-10-16

### Release qualification
- Fixed Linux proof-process ownership inspection so cleanup tests stop their own child processes; test fixture cleanup also runs after assertions fail.
- CI uses the supported Node 22 runtime, bounded test execution, explicit Electron provisioning, and isolated Android debug tests/lint/build.
- Qualified Linux and Windows unit/smoke checks, packaged LAN/firewall and Night Modes behavior, installer/portable integrity, installed settings layouts and clean QA uninstall. Source-extraction fixtures handle Windows line endings; geometry checks preserve exact restore behavior across Windows desktop/server frame differences. Android DST coverage uses historical transitions after Vancouver's timezone-policy change.
- Windows packaging produces a verified NSIS installer and deterministic portable ZIP, with source/runtime provenance and SHA256 checksums. Installer QA preserves production registration and user data.
- Android source is reconciled with the standalone timer, direct WiZ controls and native calendar/routine work. Android qualification is debug/emulator only; this Windows release does not include a new production-signed APK.
- Physical bulb/phone/router reliability is not established by UDP fixtures or emulator results. WiZ automation remains opt-in and experimental.
- Quiet House, School Night, family-member management, focus scoring and screen-time enforcement remain deferred.

### Changed
- Polished the desktop Settings layout with a compact search header, consistent
  icon navigation, readable forms, grouped WiZ controls and a persistent save
  footer. All categories fit the minimum-height window. Ctrl+K or / focuses
  search; arrow keys and Home/End navigate categories. Failed saves keep the
  form open with unsaved edits, and repeated Save clicks are blocked in flight.
- Desktop WiZ settings now include individual light selection, locally named
  rooms, brightness, white temperature, custom color, and WiZ presets. Discovery
  preserves selection. Chosen looks apply to already-on lights at dim start;
  Send test action explicitly applies the selected brightness and look.
- WiZ wind-down rechecks live power before each change and never sends power-on
  with a dim command. Switching a light off in WiZ releases it for the run,
  including cancel and completion. Disabling or changing the setup invalidates
  pending dim operations. Cancel restores only lights changed by the dimmer.
  Morning sunrise also stops updating a WiZ light switched off manually after
  its initial wake action.
- Android now opens to a standalone offline phone timer with the countdown ring,
  optional analog idle clock, pause/resume/add/cancel, saved native countdowns,
  foreground notification controls and screen-off completion alerts. A separate
  PC controls screen preserves QR pairing and remote desktop control. Android
  permissions are explained in-app; the local native bridge is isolated from
  the remote PC WebView. Debug installs remain separate from production.
- Redesigned Settings with a searchable category menu, clearer section hierarchy,
  and a dedicated Lighting page using the existing Lights Out colours and type.
- Added WiZ local discovery, passive verification, explicit test actions, gradual
  dimming from current brightness, and restoration on cancel. Existing Hue and
  webhook connections remain available; automatic lighting remains opt-in.
- Added a month planner and weekly, monthly, and individual-date rules with saved
  routines, countdowns, selected months, and last-day support. Scheduled runs wait
  until their chosen time, record each occurrence to prevent repeats, preserve
  Test Mode, and skip deleted routines. Failed saves restore the previous rules.
- Removed the breathing overlay, its automatic Last Light trigger, and breathing
  steps from default and legacy saved routines. Added two hidden decorative star
  signatures with reduced-motion support.
- Countdown ring is now the default clock face, with Analog clock available
  beneath the idle dial and in Appearance settings. Explicit analog preferences
  are preserved; the old hybrid default displays the countdown ring.
- The clock uses a clean, thin ring and a larger reading. Active timers show
  time remaining and their end time; paused timers say they are on hold.
  Mini mode, fullscreen layouts, Dawn, and 12/24-hour readings use the same faces.
- Tonight now groups the plan in a clear card, with the Start action after
  duration and ending choices. Readiness cells keep consistent spacing and fit
  the minimum window. Dawn uses a light clock face with readable dial marks.
- Devices keeps status badges clear of headings. Phone badges distinguish
  local access, waiting for a phone, connected phones and failures; the full
  endpoint status stays available below the heading and in the readiness tooltip.
- Packaged UI checks now cover dark and light layouts at three window sizes.
  Native tests open Power & Safety and Proof before interacting with their controls.
- Updated the locked Electron runtime to 43.7.11 and Sharp to 0.35.5, with patched
  brace-expansion and undici resolutions. Provisioning now checks the declared
  minimum version, including its minor and patch numbers.
- Wi-Fi firewall creation, port changes, rollback and removal now target unique
  rules owned by the current process, preserving other running Lights Out builds.
- Night Modes runtime qualification now advances its own clock as well as its
  polling cadence. Its completion check is required in CI and full E2E runs.
- Packaged validation now has a local-only lane (`npm run test:packaged-local`)
  that checks the seven-item navigation, Test Mode timer controls and companion
  recovery without opening LAN access or changing existing firewall rules.
- Companion runtime proof now verifies that a duplicate desktop start preserves
  the active run, then explicitly cancels it before testing a new run on reconnect.
- Sharp's prebuilt N-API binary needs no Electron ABI rebuild for these updates.
- Proof: the receipts ledger's "Clear All Receipts" is now a two-step
  "Delete all receipts…" with an inline confirm (Keep is focused). Deleting is
  still permanent. The Proof hero no longer has Close / dismiss buttons, and
  "Play Tonight Again" reads "Start tonight's plan".
- Buttons, fields and chips share one system: every control uses the app
  font (nothing falls back to Arial), buttons are pills (violet primary with
  dark ink, a deeper red with white ink only for destructive actions), fields
  are dark in every dialog with light native pickers kept in Dawn, and chips
  share one pill shape (Test Mode / Forced chips read uppercase). Page,
  dialog and onboarding titles use the Bahnschrift display face. Button labels
  read in sentence case, including the Start and Night Mode CTAs.
- Hovers follow the chosen accent: the hover colour is now the accent
  darkened, so every hover visibly changes for every accent (it was the
  accent itself, so many hovers did nothing).
- The Saved Profiles dialog is now the dark My Modes manager ("Save tonight’s
  plan as a mode", Name, Kind, "Save mode", "Your modes", "Search modes…").
  New modes default to Routine; saved modes keep their kind and avatars.
- Times follow your 12-hour / 24-hour setting everywhere on the desktop: the
  session end, Proof's hero and history, the ledger, the Schedule hint, its
  start notice and Tonight's Schedule note. 12-hour times read "5:53 PM",
  with no leading zero.
- The ledger groups runs by night ("Night of Tue, Oct 6"); a run after
  midnight under that night shows its time with a "+1 day" marker.
- The footer keeps the mode after a run: it reads "Test Mode | Cancelled" or
  "Real · Shutdown | Done" instead of replacing the mode with the outcome, and
  shows an outcome only while the mode still matches. The branding line, the
  version and the footer buttons are easier to read.
- The default session is called "Countdown" (Tonight: "Countdown · 28 min" /
  "Start countdown"; Proof: "Countdown"); a Night Mode, a My Mode or a name
  typed on the ring is used instead. A session's first phase reads "Running";
  "Focus" now means only Focus Sessions.
- Test Mode now lists the wind-down effects that still run (for example
  "closes 2 apps · blocks sites") in Settings › Power & Safety and on
  Tonight's plan. Test Mode holds back only the power action; that has not
  changed, the app now says so.
- Toasts on Tonight sit above the readiness rail, and pausing or resuming on
  Tonight goes to the notification centre without a toast.
- The navigation rail stays during a session: starting a run (from Tonight,
  the phone, Schedule or the tray) no longer removes it or shifts the page.
  The Tonight icon turns teal while a session runs and amber while it is
  paused. Mini mode and the full-screen clock stay rail-less.
- During a session the footer status pill leads back to the session: on any
  other page it opens Tonight (it never opens Settings or changes the mode
  mid-run). Idle, it still opens Power & Safety.
- Tonight's readiness cells (Phone, Lights, Network, Safety) open the place
  where you fix them: the matching Devices card, briefly outlined, or
  Power & Safety. They work while idle; during a session the values stay
  fully readable.
- The mini window can be moved by its top strip. The strip disappears while
  any dialog, overlay, first-run setup or menu is open, and double-clicking it
  never maximizes the mini window.
- About fits one screen: the wordmark is the title, the version is a single
  chip, the update check sits in one row and the full key map is shown in two
  columns.
- The window header is open in the night themes (Dawn keeps its solid
  header), the rail starts under it, and rail labels sit on one line. The
  header lockup reads LIGHTS OUT (the O is drawn at the weight of its
  letters), the lamp's beam reads a little stronger, and its flicker dust
  stays inside the beam. Launch and the full-screen clock no longer paint a
  keyboard focus ring on the rail.
- Tonight's ring is a thinner instrument: a fine arc over a calm scale, with
  the logo's broken O just outside it while a run is active, and larger
  digits sized by the ring that no longer wrap. A small mark shows where
  winding down begins, only when the run really has a winding-down phase.
- Winding down no longer looks paused: it dims the violet instead of turning
  amber. A paused run shows the arc cut at the O's three gaps (amber), and a
  REAL Last Light is red and thinner (a Test Mode Last Light stays amber).
- The default session name ("Last Call") no longer shows during a run or on
  the full-screen clock; idle it is muted but still editable. A name you
  chose still shows.
- The session console has one Pause rule: Pause is a violet-tinted control
  while running, and Resume is the filled violet button while paused. The
  room's flicker dust no longer shows through Pause, Snooze, Cancel session,
  the dial, Night Mode cards or the Session History card.
- Tonight's plan makes the end time its largest fact, and the Ending choices
  keep their widths when you change the selection (they no longer carry
  glyphs). The full-screen button is a quiet "Full screen" label under the
  dial.
- The full-screen clock fits the window: it is laid out at real size (no
  scaled blow-up), with no scrollbar, no wrapped labels and no lamp beam from
  an empty corner. The Test Mode / REAL pill and the exit stay visible, and
  your clock size still applies.
- The desktop widget matches the ring: the instrument digits, the broken-O
  track and a dimmed violet while winding down. Its Test Mode / REAL line is
  unchanged.
- The phone's run screen is the desktop's instrument: a thinner arc with the
  logo's broken O just outside it, and the arc is cut at the O's three gaps
  while paused. Winding down is a dimmed violet (no longer amber, so it never
  looks paused), and a Test Mode Last Light is amber on the phone, never red.
  The digits use the condensed instrument face, and Night Mode chips read in
  sentence case ("15 min", "Sleep").
- The phone ring says what will happen: "Test · no shutdown" (amber) or
  "then shut down", with "Test ends …" / "Lights out …", and a "WINDING DOWN"
  or "LAST LIGHT" line only in those phases. Paused reads "Clock stopped" on
  a dimmed, haloless ring (on short or narrow phones the ring keeps just
  "Paused"); the TEST MODE / REAL ACTION badge stays at full strength.
- Phone times follow the phone's own clock format ("1:14 AM" on a US phone,
  "01:14" on most others). The PC does not send its 12/24-hour setting, and
  sending it would change the phone protocol.
- The phone names a run like the desktop: its Night Mode, the name you typed,
  or "Countdown" ("Custom Timer" is gone).
- On the phone, Add time (one joined +5 / +15 / +30 bar), Pause and Stop sit
  at the bottom in thumb reach while a run is active, with the ring centred
  above them. They stay in the page flow (never pinned over it), so on a
  short, landscape or zoomed screen they scroll and never cover the TEST
  MODE / REAL ACTION badge or the ring. Pause is a violet-tinted control at
  Stop's weight while running; Resume is the filled violet button while
  paused. Details still opens below Stop and is never covered. When the
  reading briefly goes stale (for example when the phone wakes), the layout
  holds still; only the dimming changes, so nothing moves under your thumb.
- The phone's link bar leads with the PC's name (no "Target PC:" prefix on
  screen, a small monitor glyph instead) and shows a fresh reading as a small
  teal dot; a stale reading still shows the full amber line.
- Stopping from the phone says exactly what it does: "This will stop the
  timer, and this run's shutdown will not happen"; a Test Mode run says "This
  will stop the timer. This is a Test Mode run: no power action was
  planned." After a confirmed stop with at least 15 seconds left (and not in
  Last Light), a calm strip says "Run stopped · <time> · <PC> will not shut
  down for this run" for up to 10 minutes, until the next run, until you
  dismiss it, or until the phone's reading goes stale (for example after the
  phone sleeps). The phone toast is a branded card, and the buttons
  read "Stop tonight's run" / "Keep running".
- At rest, the phone previews tonight's plan instead of a dead "LAST CALL
  0:00 IDLE" ring: "Tonight's plan · 30:00 · then shut down" with "Lights out
  <time> if started now" (in Test Mode: "Test run · no power action" / "Test
  would end …"). The preview shows only once the PC has reported whether it
  is in Test Mode; while checking or stale the ring shows "—".
- One plan card holds the duration chips (15 / 30 / 45 / 1 hour / 90), the
  "Ends with" choice, a Custom stepper (5-minute steps) and one Start pill
  that names the duration. Night Modes follow it under "Or pick a Night
  Mode".
- Every phone start now goes through a branded Start sheet instead of the
  browser's confirm box. It shows the duration, the ending and the estimated
  end time, and states Test Mode or the real action ("Start test run" /
  "Start · will shut down") from the PC's setting at the moment you tap
  Start. A duration chip still takes two taps (the chip, then Start), as it
  did with the old confirm; the desktop's chips still start in one tap.
- The phone says Test Mode the way the desktop does: "TEST MODE · No PC power
  action will run."
- The phone's Night Mode sheet states the plan once: the duration, the
  estimated end time for a direct start ("Test would end ≈ …" in Test Mode,
  nothing for a guided wind-down), the action and the ritual. It is now a
  proper dialog: the page behind it can't be reached, Tab stays inside, and
  focus returns where you were when it closes. Night Mode cards lose their
  teal top edge (teal now only means live / connected).
- The phone connection mode is called "Same Wi-Fi" everywhere: the desktop
  mode button (it read "Connect Phone"), the status pill, the Devices hint,
  the phone's pairing steps and the Android companion README.
- Phone pairing shows one lamp, the Lights Out wordmark, instead of a second
  grey lamp tile. Its beam stays dim until the PC really answers, then lights
  up once. The pairing-code field is larger and centred, and the "same Wi-Fi"
  note is easier to read.
- Devices: a satellite that is off says what it does ("Pause, add time or
  stop from bed…") instead of "Off." again, keeps its honest Off status, and
  carries one violet call to action ("Set up phone", "Set up Same Wi-Fi",
  "Connect lights", "Choose devices"); the whole card opens its settings, and
  only those cards react to hover. Ready and live devices carry the teal beam
  and glow; attention, error and off cards never do. This PC is the hub: the
  logo's broken-O ring coloured by its real state, a digital sub-grid, the
  host name as an identifier and the strip values in the instrument face
  (Test Mode amber and REAL red still win). Family PC rows have pill
  controls, with Stop in the red outline grammar. Card hairlines follow every
  theme (Dawn, Ember, Carbon) instead of a fixed dark blue-grey.
- Devices says which features still act in Test Mode: in Test Mode, the
  Smart Lights and Wi-Fi Guard cards state that they run too (Test Mode only
  holds back PC power actions), from the same reading as Settings and
  Tonight. Outside Test Mode the notes are hidden.
- Night Modes reads as a library: each Ready card has its own poster from the
  Lights Out world (a crescent over a broken horizon, the desk lamp and its
  beam, a screen with end credits, the lamp with its beam cut short), and the
  duration ring is an instrument with a big numeral over its unit ("15 / MIN",
  ">2 / HRS"), so the duplicate duration chip is gone from full cards. Modes
  that hand the screen to the guided ritual say "Ritual" on the card.
- My Modes now sit right after the presets, before "Not available yet", with
  a "N saved" count; the not-available shelf is one row of ghost pills. My
  Mode cards are keyboard-reachable (Tab, then Enter or Space), show the
  duration in the same words as Night Modes, and a card click or Enter while
  idle loads the mode and lands on Tonight with that plan.
- A Night Mode's detail opens as a poster spread whose ring draws once
  (instantly with reduced motion), with a one-line "Direct start" / "Guided
  ritual" spec instead of the repeated Details table, and a forward chevron on
  Use Tonight (it arms the plan; it never starts it). In Test Mode the detail
  also lists the wind-down effects that still run.
- The "Not available yet" reasons no longer deny multi-device control: Quiet
  House is "a house-wide mode that settles every device at once", not built
  yet; School Night needs router-level Wi-Fi control Lights Out does not have
  yet.
- The My Modes manager asks inline before deleting or replacing a mode (press
  "Delete" then "Delete?", or Save mode twice), with no browser dialogs. Its
  rows no longer overlap, and reordering uses labelled chevron buttons. The
  right-click "Delete…" opens the manager at that mode with Delete armed; it
  never deletes in one click.
- Schedule's hero is now an instrument: the next lights-out in big numerals
  inside the logo's broken-O dial, a line that spells out "Countdown from
  22:30 · Shutdown at 23:30" ("Test ends" in Test Mode), and the one
  Auto-start switch right beside it, with what it means underneath. It says
  "Next lights-out" only while Auto-start is on; otherwise "Next bedtime".
  When every rule is switched off it says so.
- Bedtime rule cards lead with the time the action lands, show a 7-day track
  with today marked, and use icon Edit / Delete buttons. Deleting a rule now
  asks for a second click ("Delete?") within 4 seconds, the same way My Modes
  does; Escape, leaving the button or waiting cancels it.
- The rule editor is a dark two-column form whose labels focus their fields
  ("Minutes before the action" for the countdown length).
- Calendar checks say what happened: the button reads "Check feed" / "Check
  calendar", shows "Checking…", then "Reached · N events in the next 14
  days" or a fixed reason ("Couldn't reach this feed (timed out)", "Sign-in
  expired or not allowed"). A broken feed no longer looks like an empty one,
  and no feed URL or token ever appears in the status or the logs.
- The One night only date field stays hidden until its switch is on (no
  empty "mm/dd/yyyy" box), and choosing a time says "Test Mode countdown to
  …" or "Shutdown at …" instead of "Schedule target selected".
- Proof shows how long a countdown really ran: a Test Mode run cancelled after
  10 seconds reads "RAN <1m of 25m" in the hero, "ran <1m of 25m" in Session
  History and "<1m / 25m" in the ledger. A snoozed or unfinished run says
  "25m planned" instead of inventing a number.
- The ledger separates mode from outcome: "0 real · 59 Test Mode · 59 on this
  PC" sits above the outcome bar, whose Test segment now reads "Test
  completed". Interrupted keeps its attention amber as a solid square, so only
  the hatched dot means Test Mode. The ledger lists every stored receipt (up
  to 100), never fewer rows than its total.
- The Proof hero is one instrument strip (Ran, Action with its pauses and
  snoozes, Started, Ended) with a single Test Mode / REAL mark. The receipt
  total moved to the page head ("59 receipts · this PC"), and "Open receipt"
  opens the ledger on that run's row.
- "Start tonight's plan" on Proof now goes to Tonight first and starts there;
  if Tonight can't open, nothing starts.
- Routine drops the achievement trophies, the score ring and the 30-day grid
  that called Test Mode nights "Missed". Its details are one strip of real
  numbers (Real streak, Best, Real completions, Avg lights-out, Before 11 PM ·
  last 7 nights, Routine score) and the weekly report no longer counts
  achievements. The streak line stays muted until a real streak exists.
- With no receipts yet, Proof says "No runs yet" and offers "Plan tonight",
  which opens Tonight without starting anything.
- Copy proof copies a complete receipt: its id, the Test Mode / REAL line
  first, the result in words (never "Completed" for a Test Mode run), the
  action, planned and ran lengths, start and end times. The button itself
  confirms with "Copied".

### Fixed
- Starting a ritual Night Mode (Lights Down, Movie Wind-Down, Full Shutdown)
  while the guided ritual is turned off in Settings › Automations now fails
  with a clear message, on the desktop and on the phone, instead of showing a
  countdown that never ran. With the ritual on, a phone start of those modes
  (which runs the ritual straight through to its countdown) is reported as
  started, on the phone and on the desktop.
- Wi-Fi Guard on Devices no longer says "Armed" when nothing will block: with
  "block at wind-down" off it reads "Manual only", a provider that cannot
  block another device is not armed, and the Wi-Fi adapter mode reads "Armed
  · this PC's Wi-Fi" (it ignores the device list) and states its cost: this
  PC's own Wi-Fi turns off at wind-down, so a phone or other PCs reaching it
  over Wi-Fi disconnect until it is restored.
- A failed phone companion on Devices explains itself in one plain line (for
  example "Port 58732 is already used by another app. Change the port in Phone
  settings.") and its link reads "Fix in Phone settings". No address or
  pairing code is shown.
- The This PC strip shows only real facts: Battery hides when the PC does not
  report one, the labels read "Ending" and "Ends at", and "Ends at" reads
  "Not running" when idle (never "Idle"). Any hidden cell reflows the strip.
- Stopping, cancelling or finishing a timer no longer pauses the music or
  video you are playing. The Windows media key is a play/pause toggle, and
  Lights Out sent it on every stop to "resume" media even when it had paused
  nothing. It now resumes only players its own wind-down paused (with "Pause
  media at wind-down" on), and turns Night Light back off only if the
  wind-down turned it on.
- Loading a My Mode no longer turns Test Mode off: a mode saved in Test Mode
  can turn it on, and a REAL mode loaded under Test Mode stays a test and says
  so. My Modes chips show what a load would really do now.
- Ctrl+1..9 loads the mode shown on that card (pinned first) and never starts
  a timer; Ctrl+1..6 used to also start a 5–120 min preset. A digit typed into
  the session name no longer starts a preset either. The right-click menu reads
  "Load and start", "Edit…" (opens that mode in the manager) and "Delete…".

## v11.1.3 — Post-Audit Remediation (2026-09-15)

### Fixed
- Updated the transitive build-time `tar` resolution from 7.5.19 to 7.5.22,
  resolving `GHSA-r292-9mhp-454m` without broad dependency updates.
- Automated Electron proof runs no longer create real Windows notification-area
  icons. Tray creation is now idempotent, proof instances explicitly suppress
  the tray, and normal app shutdown destroys its tray icon before exit.

### Verification
- 629/629 unit tests, 261/261 smoke checks, lint clean, 7 syntax checks.

## v11.1.2 — Desktop Consolidation (2026-07-22)

Desktop: 11.1.2
Android Companion: 11.1.1, unchanged

### Changed
- **Startup returns to Tonight.** Normal launches and legacy saved
  `set`/`help` routes now settle on Tonight without flashing Settings. The
  migration completes before the renderer declares itself ready and preserves
  unrelated saved settings.
- **Usable Power, Settings, and Help menus.** Top menus now remain open while
  the pointer enters them and support click toggling, outside-click and Escape
  dismissal, mutual exclusion, arrow-key navigation, Enter activation, and
  focus return. Power choices still select intent only; confirmation and Dry
  Run safeguards remain on the shared start path.
- **Authoritative Use Tonight selection.** A selected Night Mode now drives the
  hero title, duration, action, ritual summary, preview, CTA, start payload,
  active-run identity, receipt attribution, and restart restoration from one
  state. The main process continues to resolve canonical mode identity and
  execution values.
- **Settings is a desktop workspace.** Settings is now a primary in-flow view
  with a persistent category rail and one selected category at a time instead
  of a widened modal or all-category mega-scroll. Save, Cancel, Back, Escape,
  sidebar state, and return navigation share one predictable lifecycle.
- **One primary Start action.** The visible Tonight hero CTA, Space shortcut,
  and Play Tonight Again all delegate to the same command and payload path.
  The hidden duplicate Start control and competing listeners are gone.
- **Focused active-run presentation.** The current countdown and selected mode
  dominate while Saved Profiles, streak content, and prior proof are hidden.
  Pause/Resume, Snooze, Cancel, and Dry Run status remain prominent, including
  while paused.
- **Navigation and terminology cleanup.** Desktop labels, routes, and control
  descriptions now match the consolidated Tonight, Modes, Schedule, Settings,
  and Stats surfaces.

### Fixed
- Registered ritual side-effect callbacks before the renderer becomes
  interactive, closing an early-launch window where a standard ritual could
  reach its timer step without creating the countdown or receipt.
- Replaced the desktop proof runner's preload-existence guess with an explicit
  renderer-ready handshake, fresh debugging ports, console/exception capture,
  route/view/modal diagnostics, and enforced native assertions.

### Safety
- Timer, receipt, companion, and Windows power-action boundaries remain
  unchanged. Dry Run is enabled in all release proof scenarios, and the native
  desktop gate records zero real power actions.
- This release does not claim Windows Authenticode signing.
- Android source, `versionCode`, and `versionName` are unchanged.

## v11.1.0 — Night Modes Library (2026-07-16)

### Added
- **Night Modes Library.** A new Modes panel offers six declarative bedtime
  presets. Four modes are ready to arm; Quiet House and School Night remain
  visibly unavailable with honest reasons. Selecting "Use Tonight" only loads
  canonical duration/action/ritual values into the lobby—it never starts a
  timer by itself. The Electron main process resolves mode identity, receipts
  record the canonical mode ID/title/version, and Night Modes cannot introduce
  arbitrary script or shell execution paths.

### Fixed
- **Static browser preview now initializes Night Modes.** The fallback API now
  supplies the smart-light getter used during startup plus safe preview-only
  Night Modes catalogue/arming methods. This prevents an unrelated missing
  method from aborting initial data loading and leaving the Modes panel empty.

### Verification
- ESLint, entry-point syntax checks, 214 unit tests, 239 smoke checks, the
  20-check Night Modes source proof, an 8-check real Electron runtime proof,
  static-preview interaction checks, and the full portable/NSIS production
  build pass. Real Electron interaction confirmed all four ready modes across
  DOM/preload/IPC/main, canonical receipt attribution, ritual handoff and
  cancellation, an accelerated Dry Run completion, and zero real power actions.

## v11.0.1 — Windows Production Readiness (2026-07-13)

This release includes all desktop work merged after v11.0.0. Android companion
source also changed in the same repository range, but it is not part of the
Windows installer and is not certified by the Windows production proof.

### Added
- **Family Profiles identity and receipt attribution.** Saved profiles can carry
  local family identity metadata, selected identity remains inert until a user
  explicitly starts a timer, and completed-run proof records the selected
  profile without breaking legacy profiles or receipts (PR #24).
- **Display-only profile accents.** Profiles can use an optional accent from a
  constrained palette. The accent is scoped to profile cards and manager rows;
  it never changes the desktop theme or timer behavior (PR #25).

### Changed
- **Settings, header, and pairing presentation.** Advanced options persist as
  they change, the wordmark no longer overlaps narrow desktop layouts, and the
  desktop/PWA pairing and companion-stat cards have clearer presentation
  (PRs #21–#23).
- **Companion diagnostics and host recovery.** Failed pairing attempts are
  surfaced, phone battery display is wired, stale socket callbacks cannot
  replace healthy connections, expired pairing is explained, and offline-host
  retries recover cleanly (commits `8d1e353`, `522adf7`, `85953c7`, `3675674`,
  and `5442ad1`). The Windows installer contains the Electron companion host
  and PWA changes.
- **Android companion recovery source.** Native Android recovery gained saved
  token reuse, subnet discovery, and a load watchdog (`e8dd021`, `85953c7`, and
  `5442ad1`). These sources require a separately signed, installed, and tested
  APK; this Windows release does not claim Android production readiness.

### Fixed
- **Desktop window movement, resizing, and placement persistence.** The custom
  frameless header now exposes a usable drag region, retains the native Windows
  resize border, and includes an explicit maximize/restore control. Manual
  dimensions are no longer overwritten by content mutations, the layout uses
  the available width, and normal window bounds survive Mini Mode and app
  restarts. Restored coordinates are clamped to an available display so a
  monitor change cannot strand the app off-screen.
- **Mini Mode geometry.** Entering Mini Mode now lowers the active minimum
  before requesting its 260×320 geometry. Exiting restores the 480×600 normal
  minimum, display-clamped saved bounds, and the prior maximized state. A real
  isolated Electron BrowserWindow test verifies the resulting geometry and
  relaunch behavior.
- **System volume setting now honors the requested percentage.** The media
  helper previously calculated a clamped volume but referenced an undefined
  PowerShell variable instead of inserting that value into the command. Volume
  commands now sanitize and clamp input, convert it to two-percent key steps,
  and guard the zero-step case so PowerShell cannot interpret `1..0` as a
  descending range. Unit coverage locks the 0%, 50%, 100%, invalid, and
  out-of-range cases. Confirmed dead bindings were removed and intentional
  cross-script renderer exports are now declared explicitly, leaving ESLint
  clean without suppressing dead-local detection.
## v11.0.0 — Serious Night Mode (2026-07-09)

### Fixed
- **Critical: the phone companion was completely non-functional.** Found via
  live device testing (a real phone physically paired against a real
  desktop instance) — every connection attempt silently failed and stayed
  stuck on "Connecting…" forever, regardless of a correct pairing code or
  network. Root cause: two unrelated past markup redesigns each left behind
  a dead DOM reference in `companion.html` (`#pair-reset`, then separately
  `#disconnected`/`#disconnected-msg`) that threw an uncaught exception and
  silently aborted the page's script before it ever attempted a connection.
  Fixed by removing the dead code; the status pill and automatic reconnect
  already covered everything those removed elements provided. Verified
  end-to-end afterward on a real device: real pairing, real WebSocket, live
  connected state. No reinstall needed on already-installed phones — the
  companion app loads this page fresh from the desktop on every connection.

### New
- **Trusted LAN mode.** Enabling "Connect Phone" (the mode that exposes the
  companion server to your Wi-Fi network) now requires explicitly
  confirming a warning that states exactly what's exposed (any device on
  the network with the pairing code can start/pause/snooze/cancel) and what
  stays off-limits (never a forced shutdown, logout, or hibernate).
- **Weekly Reports.** A "This Week" section on the Streaks tab summarizes
  the last 7 nights in plain language (nights logged, streak, bedtime
  consistency, snooze rate, actions taken) with a one-click "Copy Report"
  to clipboard. Built entirely from data already tracked — no new claims,
  no fabricated scoring.
- Full-screen clock mode (reuses the main window, hides all chrome, scales
  the analog clock to read from across a room) — carried over from the
  unreleased tail of v10.4.0's follow-through work.

### Removed
- `companion-mobile`, an unfinished, unused duplicate of the real Android
  companion app (`companion-android`) — no signing setup, no QR pairing, no
  CI or documentation references.

### Descoped
- **Smart light integration** is explicitly not part of this release.
  Code exists (`smartLights.js`) but has never been runtime-proven against
  real hardware, and this project ships proof-first — it stays parked
  until either real hardware is available to test against, or there's an
  explicit decision to ship it labeled experimental.

## v10.4.0 — Phone Companion Easy Connect + Profiles Upgrade + Streaks (2026-07-08)

### New
- **Phone Companion Easy Connect** — redesigned pairing flow with three modes:
  `Off` (disabled), `This PC only` (binds `127.0.0.1`, local machine only), and
  `Same Wi-Fi` (binds for LAN access). Desktop status pill shows live state:
  `Off`, `This PC only`, `Waiting for phone`, `Phone connected`, or
  `Connection failed`.
- **QR + manual pairing** — in `Same Wi-Fi` mode the desktop shows a scannable
  QR code, a manual URL fallback, and a short 6-character pairing code, with
  one-click copy for the manual URL. `This PC only` mode never exposes a QR.
- **Token-protected remote actions** — every phone command requires the
  pairing token; invalid or missing tokens are rejected with a proper
  WebSocket 401/403 response before the handshake completes. A hard safety
  check in the message handler also rejects any command while mode is `Off`,
  independent of the token check.
- **Real-time connection status** — the desktop status pill and the phone's
  own connection state (`Connecting…`, `Connected to [PC]`, `Disconnected`,
  `Pairing expired`, `Wrong network or PC offline`) update live, and the
  desktop shows how many phones are connected. All phone-side timer actions
  require confirmation and are disabled while disconnected.
- **Companion integration smoke test** — `npm run smoke:companion` starts the
  real HTTP/WebSocket bridge and verifies off/local/wifi mode, token gating,
  token rotation, and rejection semantics (`test/companion-integration.test.js`).

### Features (merged from `blackboxai/pr7-scope-cleanup`)
- **Profiles search, filter & pin** — the Profiles panel now has a search box,
  category filters, and the ability to pin favorite profiles to the top.
- **30-day sleep-history grid** — a calendar-style grid visualizes the last 30
  nights (on-time / snoozed / neutral) with hover tooltips; a streak-celebration
  modal fires on milestone streaks.
- **Companion auto-firewall + system status** — enabling `Same Wi-Fi` mode opens
  Windows Firewall inbound rules for the companion port/discovery and removes
  them on stop; the phone view shows the PC power plan and battery charge.

### Internal
- `companion.js` tracks connected client count and emits `status` events;
  main process broadcasts `remote-control-status` to the renderer on every
  state change.
- Updated `main.js`, `renderer.js`, `companion.js`, `companion.html`, and
  `styles.css`.

## v10.3.0 — Ritual Mode + Intelligence (2026-06-28)

### New
- **Ritual Mode** — guided bedtime ritual chains multiple systems together:
  breathing → content block → dim → timer → smart lights. Each step auto-advances
  or awaits acknowledgment. Fully skippable and configurable. "Begin Ritual" button
  on the main lobby.
- **Stats Dashboard** (`statsDashboard.js`) — single IPC that aggregates sleep score,
  debt, override history, streak, screen time, and recent receipts for the STATS panel
- **Smart Suggestions** (`smartSuggestions.js`) — analyzes sleep debt, override history,
  streak patterns to recommend bedtime adjustments and timer durations
- **Notification Center** — in-app notification feed with badge counter. Bell button in
  footer opens a scrollable drawer with all recent notifications (timestamped, colored by
  type). Notifications auto-accumulate from all `notify()` calls.
- **Companion stats view** — phone UI now shows sleep score, debt, streak, override tax
  debt, and autopilot badge in a dedicated section
- **Companion full stats broadcast** — state updates now include aggregated stats payload

### Internal
- New modules: `ritualMode.js`, `statsDashboard.js`, `smartSuggestions.js`
- Smoke suite: 72/72 (+4 over v10.2.0)
- Build files list updated for all new modules

## v10.2.0 — Override Tax + Autopilot (2026-06-28)

### New
- **Override Tax** — escalating cost for hitting snooze. First snooze is free; 2nd
  is logged and accountability partner notified; 3rd+ shortens tomorrow's timer by
  15 min; 4th+ requires a typed reason. Configurable via settings panel: free snoozes,
  tighten amount, max cap, reason threshold. Tray menu shows live cost level.
- **Override Tax settings panel** — full UI to enable/disable, adjust parameters,
  and view live session stats (snooze count, tomorrow's debt)
- **Snooze escalation modal** — renderer popup shows consequences list before
  allowing non-free snoozes, with required reason input for high-level overrides
- **Autopilot Bedtime** — learns your bedtime from streak history (median + std dev),
  schedules auto-start at habitual time with 5-min warning. Fully opt-in.
- **Autopilot settings panel** — shows learned bedtime, confidence, sample size;
  optional manual override time input
- **Companion phone tax indicator** — phone UI shows snooze cost warning when the
  next snooze would be penalized
- **Last Call** — default timer name renamed from "Witching Hour" to "Last Call"
- **Expanded smoke suite** — 68 assertions (+11 over v10.1.0) covering Override Tax
  module, IPC, modal, renderer integration, and Autopilot wiring

### Changed
- `snoozeTimer` now accepts a `reason` parameter for Override Tax compliance
- Tray snooze label dynamically reflects current cost level
- Companion state broadcast includes Override Tax stats

### Internal
- New modules: `overrideTax.js`, `autopilot.js`
- New test: `test/overrideTax.test.js` (11 assertions)
- Build files list includes new modules

## v10.1.0 — Visual Northstar (2026-06-24)

### New
- **Northstar Last Light overlay** — cinematic full-screen wind-down sequence with
  countdown ring, flavor panels, and UNPLUG button (informational-only; power action
  proceeds automatically after the sequence)
- **Northstar Lobby shell** — icon sidebar rail (LIB / SCH / SET / STATS / ?),
  centered header wordmark, and Tonight's Run hero card with PLAY shortcut; shown
  in idle state, hidden while running
- **Northstar Morning Proof hero** — full-width mission-complete card with dynamic
  headline, real stat pills (session length, action, snoozes, total runs), and
  actions: Play Tonight Again / View Ledger / Copy Proof / Dismiss. No fake data;
  streak pill omitted until tracking is implemented
- **Settings persistence for northstar UI state** — active sidebar tab and selected
  mode card now round-trip through `settings.json` alongside existing prefs
- **Timer name persistence** — `timerName` (editable session name) now saves on
  every edit and restores on launch
- **Expanded smoke suite** — +57 assertions covering tray guards, IPC handler
  presence, renderer control wiring, keyboard shortcuts, preview-safe defaults,
  login/warning wording, and preload bridge

### Fixed
- UNPLUG button correctly marked `disabled` with `aria-disabled`; sub-label updated
  to "PROCEEDING AUTOMATICALLY" so intent is unambiguous
- CSS orphaned custom properties wrapped in `:root` block
- Stray closing brace removed from `styles.css`
- `clearLastLightTimers` now correctly handles both `setTimeout` IDs and interval
  wrapper objects from the northstar ring ticker

### Unchanged
- Timer logic, countdown, and phase transitions
- Shutdown execution path (`executePowerAction`)
- Last Light audio/sequence engine
- IPC handler signatures
- PowerShell fallback (`SleepTimer.exe v5.3.0`)

---

## v10.0.10 — Startup crash fix (2026-06-16)

Fixed a packaged-app startup crash (`remoteControl.js` missing from electron-builder
file manifest) and corrected settings saves for WiFi Guard, Content Blocker, and
Accountability.

## v10.0.9 — Streaks tab restored (2026-06-15)

Restored the Streaks tab panel and fixed a cancel-timer error where guided breathing
cleanup could show a red error toast.

## v10.0.8 — Updater download target (2026-06-14)

Fixed in-app updater download target so it selects the real installer asset.

## v10.4.0 — Easy Connect Companion (2026-07-01)

### New
- **Easy Connect for phone companion** — redesigned pairing flow:
  - **Three connection modes**: `Off` (disabled), `This PC only` (local binding), and `Same Wi-Fi` (LAN binding)
  - **QR Code pairing**: Scan from the desktop app to pair instantly in `Same Wi-Fi` mode
  - **Short pairing codes**: 6-character codes for manual fallback
  - **Desktop status pill**: Real-time status indication (`Off`, `This PC only`, `Same Wi-Fi`)
  - **Mobile-first companion UX**: Improved layout, connection state feedback (`Connecting`, `Connected`, `Disconnected`, `Pairing expired`), and action confirmations
  - **One-click copy**: Copy the manual pairing URL to clipboard
- **Security hardening**:
  - Token-protected WebSocket handshake with 401/403 rejection
  - Explicit host binding control per mode
  - Hard safety check in message handlers to reject commands when mode is `Off`

### Internal
- New integration test: `test/companion-integration.test.js`
- Smoke suite: 116/116 (+6 over v10.3.0)
- Updated `main.js`, `renderer.js`, `companion.js`, `companion.html`, and `styles.css`
