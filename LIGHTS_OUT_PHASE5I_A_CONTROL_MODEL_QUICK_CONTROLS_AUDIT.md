# Lights Out — Phase 5I-A: Control Model + Quick Controls Audit

Read-only audit. No code changed. Checkpoint: `86a72e1` (`feat/steam-shell-phase1`,
pushed, working tree clean). Every claim below is grep/read-verified against
source — file:line citations throughout, no speculation presented as fact.

---

## 1. Preset duration chips — exact behavior and proposed fix

**Confirmed: chips instant-start a real timer. This is not a misreading of
the UI — it's exactly what the code does, and the code says so itself.**

Six chips in Tonight ([index.html:553-558](electron/index.html:553)), each
`data-min="N"`. The caption directly above them already admits it:
[index.html:551](electron/index.html:551) — `"Presets start immediately --
no confirmation step"`, and a dev comment at
[index.html:546-550](electron/index.html:546) explains this was a known,
named tradeoff from Phase 5B-A, not an oversight.

Click handler, [renderer.js:3701-3709](electron/renderer.js:3701):
```js
chip.addEventListener('click', () => {
  const minutes = Number(chip.dataset.min);
  state.unit = 'min';
  setInputFromSeconds(minutes * 60);
  clearAnyArmedPlan();
  startTimer(minutes * 60);
});
```
`startTimer` is called unconditionally — no confirmation, no arm step. It's a
real IPC call ([preload.js:8](electron/preload.js:8) →
`ipcMain.handle('start-timer', ...)`) that sets `timerState.running = true`
server-side ([main.js:720](electron/main.js:720)) with no gate in between.
Number-key shortcuts 1-6 ([renderer.js:4062-4069](electron/renderer.js:4062))
are a second, independently-coded instant-start path with the identical
pattern (own minute table: 5/10/15/30/60/120, slightly different from the
chips' 5/15/30/45/60/120 — worth noting as its own small inconsistency).

**The contrast that proves this is a real regression, not just a style
choice**: the app already has a working "inert selection" pattern elsewhere.
`applyProfile()` ([renderer-profiles.js:163-212](electron/renderer-profiles.js:163))
loads a saved profile's duration/action into the setup UI *without* starting
anything, documented explicitly at
[index.html:608-614](electron/index.html:608) as deliberate. Chips don't
follow this pattern — they both set the duration display and fire the real
start in the same click, then actively discard (`clearAnyArmedPlan()`,
[renderer.js:3706](electron/renderer.js:3706)) any plan the user had already
armed, with no warning that an armed plan is being dropped.

This predates `Arm Tonight` (added later per the "Custom Timer Arm Model"
commit in the git log) — chips were fine when instant-start was the *only*
model. Once Arm Tonight/Start Now/Unarm became real, separate concepts, chips
became the one control surface that still silently skips all of them.

**Proposed fix**: change chips from `startTimer(...)` to the same inert
"set duration, don't start" pattern `applyProfile()` already uses —
`setInputFromSeconds(minutes * 60)` without the `startTimer` call, leaving
`Start Now`/`Arm Tonight` as the two real commit actions. Do **not** call
`clearAnyArmedPlan()` on chip click either, once chips no longer start
anything themselves — an armed plan and a chip-selected duration can coexist
without conflict once chips stop being a competing start path. Number-key
shortcuts need the identical fix, applied separately (it's a second code
path, not shared logic).

## 2. Unarm / Clear Armed Plan — gap and proposed fix

**Correction to the handoff doc's premise: this does not need to be built —
it already exists and is wired.**

- `clearAnyArmedPlan()`, [renderer.js:2236-2239](electron/renderer.js:2236),
  clears both an armed Night Mode and an armed custom timer.
- UI button: `#armed-mode-clear`
  ([index.html:466](electron/index.html:466)), inside the armed-mode banner.
- Wired: [renderer.js:3770](electron/renderer.js:3770) —
  `document.getElementById('armed-mode-clear')?.addEventListener('click', clearAnyArmedPlan);`

**What's real about the "no obvious Unarm flow" complaint**: the button's
own `title`/`aria-label` — `"Remove night mode selection"`
([index.html:466](electron/index.html:466)) — is Night-Mode-specific
wording, even though the same handler also clears an armed **custom timer**.
A user with an armed custom timer sees a clear (×) button labeled for a
concept (Night Mode) they didn't select. That's a real, narrow, low-risk
copy fix, not a missing feature.

**Proposed fix**: retitle to something mode-agnostic ("Clear armed plan" /
"Unarm"), no logic change. Bundle with Commit 1 (preset-chip fix) since both
touch the same armed-plan model and the retitle is a one-line change once
you're already in that code.

## 3. Media auto-pause / YouTube-pause — exact cause and proposed fix

**Mechanism**: not a YouTube-aware or MediaSession-aware feature — it's a
simulated Windows global media-key press plus, per-detected-browser-process,
a simulated **Spacebar keystroke**, both sent via PowerShell `SendKeys`,
blind to which tab/site is focused. [media.js:38-52](electron/media.js:38)
(global media key), [media.js:54-70](electron/media.js:54) (per-app
shortcuts — `chrome`/`msedge`/`firefox` all get literal Space, which is
YouTube's own pause shortcut). It targets whatever has focus, not a specific
tab — this is exactly the "why did my YouTube video pause" mechanism.

**Trigger**: any running timer's countdown reaching the **dim phase**
(remaining ≤ 25% of total duration, [main.js:210-216](electron/main.js:210)),
gated only on `appSettings.pauseMediaOnDim === true`
([main.js:986](electron/main.js:986)). **No mode/ritual gating exists** —
it fires identically for a plain custom timer and for a Night Mode/ritual;
`applyDimPhase()` never inspects `nightModeId`/`ritualId`.

**Default is OFF** ([settings.js:102](electron/settings.js:102):
`pauseMediaOnDim: false`) — so the user (or an imported profile/preset) must
have turned it on at some point. This is not a "secretly on by default" bug.

**Disclosure: confirmed absent.** `renderTonightPlanFeatures()`
([renderer.js:2421-2438](electron/renderer.js:2421)), the function
responsible for showing "what will actually happen" chips before a timer
starts/arms, only checks Smart Lights, Wi-Fi Guard, and Companion status —
there is no media-pause chip, and no `ta-media-status`-equivalent element
exists anywhere in `index.html`. The only user-facing signal is a **toast
that fires after the pause already happened**
([renderer.js:4563-4568](electron/renderer.js:4563): `notify(`Media paused:
${data.players.join(', ')}`, 'info')`) — after-the-fact, not advance warning,
and invisible if the window isn't visible at that moment.

**Proposed fix**:
1. Add a media-pause chip to `renderTonightPlanFeatures()`, same pattern as
   the existing lights/Wi-Fi/Companion chips, so it's visible before the user
   commits to a plan whenever `pauseMediaOnDim` is on.
2. Do not change the pause mechanism itself (it's working as designed, opt-in,
   off by default) — the trust problem is *silence*, not the feature.
3. Optional, lower priority: since the mechanism is genuinely blind
   (SendKeys to whatever's focused), the Settings copy for this checkbox
   should say so plainly — something like "sends the OS pause key to
   whatever app/tab has focus" — rather than implying targeted media-app
   detection.

## 4. Quick Controls drawer — proposal

**Verified gap**: the footer today has exactly one status pill (`#status-pill`,
[index.html:2174](electron/index.html:2174), just "Idle"/running text) plus
icon-only action buttons (notif, widget, companion) — no Dry Run/Live,
Companion, Media Pause, Smart Lights, Wi-Fi Guard, First Light, or Proof
status. A consolidated Quick Controls surface genuinely doesn't exist.

**What already exists and should be reused, not duplicated**: Home's command
card already has a real status-facts row —
`#ns-home-run-badge` + `#ns-home-command-facts`
([index.html:296-298](electron/index.html:296)), explicitly documented
([index.html:287-295](electron/index.html:287)) as "Dry Run/Live Ready
always shown, Companion always shown, everything else omitted rather than
faked." This is the right *pattern* (real-data-only, omit-if-unconfigured) —
it just isn't reachable from anywhere except Home.

**Proposal**: extend the footer's single status pill into a small drawer
(click-to-expand, not a second permanent status bar) that surfaces the same
real facts Home's command card already computes — Dry Run/Live, current
plan, Companion, Media Pause (once added per §3), Smart Lights, Wi-Fi Guard,
First Light, Proof — reachable from the footer regardless of which screen
you're on, plus from the `Status & Safety` top menu (which already exists as
a dropdown, [index.html:183-206](electron/index.html:183), and already
happens to be the one menu with Dry Run in it). Reuse Home's existing status
computation rather than re-deriving these facts a third time.

## 5. Settings → setup/control sections — proposal

Settings' architecture (two-pane rail+content, real in-flow panel, category
summary cards) is already correct — established in Phase 5E-B/5E-C and
confirmed again in the [Phase 5H-B audit](LIGHTS_OUT_PHASE5H_B_SHELL_SIZE_SETTINGS_AUDIT.md).
Existing categories: General, Power & Safety, Wind-Down, Phone Companion,
Protection, Accountability, Automations, Appearance & Sound, Advanced
(`data-settings-category` values, pinned by
[smoke.js:625](electron/scripts/smoke.js:625)). Each category already opens
with a `.settings-category-summary` purpose/affects-tonight card
([styles.css:1804-1820](electron/styles.css:1804)).

**Gap**: that summary card states purpose + whether it affects tonight, but
doesn't consistently separate "primary action" from "advanced controls"
within a category — e.g. Wi-Fi Guard's category mixes the enable checkbox,
provider config, device-block list, and two dim-coupling checkboxes at one
visual level (verified in §6 below). Turning "status / what happens tonight /
primary action / advanced controls" into an explicit structural pattern
(not just a summary card) is real work, but it's an internal reorganization
of already-dense categories — not a rewrite of the two-pane shell. Scope
this as its own commit (Commit 4) so it doesn't get tangled with the control
model / Quick Controls work, which touches different files entirely.

## 6. Lights / Wi-Fi / Companion / First Light — connected sections

**Smart Lights** ([index.html:1387-1465](electron/index.html:1387)):
Settings UI only exposes 3 providers (None/Hue/HTTP Webhook) via
`sel-light-provider`, but `smartLights.js` already implements working
Home Assistant, IFTTT, and MQTT providers with real config fields and
`invoke*Action`/`testSmartLightConnection` cases
([smartLights.js:26-37](electron/smartLights.js:26)) — **no UI exists for
3 of the app's 5 real providers.** That's a concrete, scoped gap: add UI for
existing backend capability, not new capability.

**Wi-Fi Guard** ([index.html:1600-1678](electron/index.html:1600)):
"Experimental" labeling already exists in 4 separate places in the UI
(Home glance pill, Settings category description, section header, provider
helper text) — the handoff doc's suggested labeling is already shipped, not
a gap. The one genuine per-device targeting in the app lives here (Scan
Network → MAC/IP block list), but it's a flat list with no time-of-day/rule
association.

**Devices cards** (per the earlier Phase 5H-B audit's finding that
`.dev-status-section` is a hardcoded single column of label/value rows) —
the "What is it / Is it ready / What happens tonight / What can I do now"
reframe from the handoff doc is a real, valid target shape, but it's the
same Devices layout work already explicitly deferred to Commit 6 — don't
pull it forward into this pass.

## 7. Calendar Routine Builder — current model vs. the vision, honestly

**The gap is real and larger than "needs more UI" — it's a data-model gap.**
Today's Schedule is a multi-rule *time-match trigger list*, not a
timeline/routine builder:

- Each rule has exactly **one** `action` field, restricted to three PC power
  actions (`shutdown`/`sleep`/`hibernate`,
  [index.html:840-844](electron/index.html:840)). A calendar event object
  ([calendarProviders.js:74-88](electron/calendarProviders.js:74)) carries a
  single `action` string — there is no array of actions, no light/Wi-Fi
  fields, anywhere in the schema.
- Smart Lights and Wi-Fi Guard are **not** driven by the calendar rule at
  all — they're a side effect of whatever PC timer the rule happens to
  start, cascading off that timer's dim phase
  ([main.js:993-1001](electron/main.js:993)). One calendar rule → one PC
  timer → that timer's dim phase incidentally triggers whatever's globally
  configured. It is not a per-rule, user-composed list of distinct timed
  actions.
- Smart Lights config is a single module-level singleton
  ([smartLights.js:9](electron/smartLights.js:9)) shared by every rule —
  only Hue has any room/group targeting at all
  (`hueLightIds`/`hueGroupId`), and it's one global setting, not
  per-rule/per-time.
- Wi-Fi Guard has **no independent time trigger** — it only hooks the timer's
  dim-phase start/cancel ([main.js:993-1001](electron/main.js:993),
  [main.js:1054-1060](electron/main.js:1054)). "Cut router access at 10:15
  PM without starting a shutdown timer" is not possible today.
- First Light *is* already independently schedulable at any `HH:MM`
  ([alarm.js:13,20](electron/alarm.js:13)) and does already cascade into a
  Smart Lights sunrise sequence if Smart Lights is enabled
  ([main.js:1092-1111](electron/main.js:1092)) — this one piece of the
  vision is already real, and is the closest existing thing to a "timed
  action with a lights consequence" model worth learning from.

**Conclusion for scoping**: building the target model (`Routine → Date/Days →
Timeline actions → [PC, Light, Wi-Fi, First Light, Proof]`) requires a real
schema change (calendar events/rules carrying a list of typed actions
instead of one `action` string) plus decoupling Smart Lights/Wi-Fi Guard
from "PC timer dim phase" into their own independently-triggerable actions.
This is exactly why the handoff doc scopes it as Commit 7 ("write the
model, don't rewrite the scheduler yet") rather than an implementation pass
— confirmed correct after reading the actual schema, not just from caution.

## 8. Dynamic hero/logo — proposal

**Confirmed static today, and confirmed cheap to wire.** Both logo
instances — header `.brand-mark`
([styles.css:327](electron/styles.css:327), 22px) and Home's
`.ns-home-brand-icon` ([styles.css:5070-5076](electron/styles.css:5070),
58px) — have only a fixed `filter: drop-shadow(...)`, no animation, no
state-driven class.

**The good news**: the state hooks this needs already exist and update on
every real state change — nothing new to plumb.
`document.body.classList.add('phase-' + state.phase)`
([renderer.js:2020](electron/renderer.js:2020)),
`is-paused`/`is-running` ([renderer.js:2022-2023](electron/renderer.js:2022)).
`phase-dim`/`phase-lastlight` are already consumed by `.ambient-canvas`
([styles.css:288-291](electron/styles.css:288)) for a similar full-page
ambient effect — the hero glow can hook the identical classes with pure CSS,
no JS changes. The repo already has one working `prefers-reduced-motion`
disable pattern to copy ([styles.css:4611-4613](electron/styles.css:4611)).

**Proposed states**, mapped to real existing classes (not invented ones):
idle (no state class) → dim glow; `is-running` → slow breathing glow;
`is-paused` → held/dimmed; `phase-dim` → brighter/warm pulse (matches the
existing warm-shift ambient effect already keyed to this class);
`phase-lastlight` → lights-out transition. Dry Run/Live doesn't currently
set a body class — would need one small addition (a `dry-run`/`live` class
alongside the existing `state.dryRun` toggle) if that badge state should
also drive the glow; everything else is CSS-only.

## 9. Files likely to change (grouped by proposed commit — see §11)

- **Commit 1** (preset-chip + Unarm): `electron/renderer.js` (chip handler,
  number-key handler, armed-mode-clear label wiring),
  `electron/index.html` (chip help text, clear-button aria-label),
  `electron/scripts/smoke.js`
- **Commit 2** (media-pause disclosure): `electron/renderer.js`
  (`renderTonightPlanFeatures()`), `electron/index.html` (possibly a new
  `ta-media-status` glance tile to mirror the existing three),
  `electron/scripts/smoke.js`
- **Commit 3** (Quick Controls drawer): `electron/index.html` (footer
  markup), `electron/renderer.js` (reuse Home's existing status computation,
  don't re-derive), `electron/styles.css`, `electron/scripts/smoke.js`
- **Commit 4** (Settings sections): `electron/index.html`,
  `electron/styles.css`, `electron/scripts/smoke.js` — no handler/save logic
  changes
- **Commit 5** (hero/logo states): `electron/styles.css` (new rules keyed
  off existing body classes), `electron/renderer.js` only if a new
  dry-run/live body class is added
- **Commit 6** (Devices layout — not this pass): deferred, per handoff doc
- **Commit 7** (Routine Builder spec — not this pass): a design doc, not
  code; touches `calendarProviders.js`/`calendar.js`/`smartLights.js`/
  `wifiGuard.js` schemas eventually, once actually implemented

## 10. Risks and non-goals

- **Risk**: removing `startTimer()` from the chip handler changes real,
  field-proven behavior (chips currently start real countdowns nightly per
  the user's own report). This needs explicit runtime QA — click each chip,
  confirm duration loads but nothing starts, confirm `Start Now`/`Arm
  Tonight` still work unchanged — before merging, not just a smoke-test pass.
- **Risk**: the two instant-start paths (chips, number keys) are
  independently coded with slightly different minute tables. Fixing only one
  and missing the other would leave a confusing half-fixed state — both must
  land together.
- **Risk**: `pauseAllDetectedMedia()`'s mechanism (blind SendKeys to
  whatever has focus) is unrelated to whether it's disclosed — don't
  conflate "make it visible" (safe, scoped) with "make it smarter/targeted"
  (a real feature change, out of scope here).
- **Non-goal**: no change to the pause mechanism itself, no new Smart
  Lights/Wi-Fi providers' backend (HA/IFTTT/MQTT already work — only their
  Settings UI is missing, and that's still a separate, larger pass), no
  scheduler/routine-builder implementation, no Kids Mode, no Devices layout
  changes.
- **Non-goal**: this audit does not touch timer execution, power execution,
  dry-run/live gating, schedule execution, Phone Companion runtime, IPC, or
  packaging — confirmed nothing in §1-§3's proposed fixes requires touching
  `beginValidatedCountdown()`, the power-action execution path, or any IPC
  handler signature.

## 11. Recommended implementation split

Matches the handoff doc's ordering, confirmed sound after the audit:

1. **Timer control semantics** — chips + number keys stop instant-starting,
   Unarm label fix. Smallest, most trust-relevant, do first.
2. **Media-pause disclosure** — add the missing plan-summary chip. Small,
   independent of Commit 1.
3. **Quick Controls drawer** — reuse Home's existing status computation.
   Depends on nothing from 1/2 but is more UI surface area.
4. **Settings setup sections** — internal reorg, no handler changes.
5. **Dynamic hero/logo** — purely additive CSS, lowest risk, can move
   earlier or later freely since it touches nothing else.
6. **Devices layout** — deferred (per explicit instruction not to start yet).
7. **Routine Builder spec** — deferred, write-the-model-only when reached.

Commits 1 and 2 are the two genuinely trust-sensitive ones (they change what
happens when a user clicks something they click every night) — recommend
those get the most explicit runtime QA and the most cautious review, more
than the shell-size work did.
