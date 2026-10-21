# LO-UX-CLOCK-1 — current time and countdown remain distinct

**READY_FOR_GUARDED_UI_ACCEPTANCE. Candidate source only; not installed or released.**

The idle ring now shows local time even when a saved legacy `clockMode:false`
is present. It says **Ready · not started**. Duration stays in Tonight's Plan
as **Duration 22 min**; a prospective end says **If started now**, followed by
the selected clock format and a local **today/tomorrow** qualifier. The old
clock-hiding checkbox is replaced by an explanation; its stored value is
preserved, with no migration or settings rewrite. Analog/digital face choices,
clock format and optional date remain supported. Loading My Modes no longer
temporarily hides the wall clock or changes the chosen face.

During a run, the primary number is the engine-provided remaining time. A
persistent **Now 12:06 AM** line continues updating while paused. The existing
single wall-clock interval updates only wall-time text during a run; it never
advances remaining seconds. Start/resume no longer invent renderer deadlines:
they consume the returned IPC timer snapshot, just like timer events. The
main-process countdown, timer gateway and power engine are unchanged.

`formatIdleClockTime`/`formatClock` remain the shared formatters. The small
`formatClockTarget` helper adds local calendar-day qualification and a target
zone when a DST offset changes. It does not assume a day is always 24 hours.
12-hour times retain explicit AM/PM. Manual clock/timezone changes affect
presentation, never substitute a renderer-generated countdown or deadline.
The existing brief completion-outcome hold is retained and labelled Complete.

## Qualified scope

- **131 focused tests passed, zero failures.** Clock, Tonight instrument/plan,
  profile loading, settings compatibility/durability and profile contracts only.
- Deterministic fake-clock coverage includes legacy clock OFF, default idle,
  22-minute and armed plans, authoritative running time, paused/live wall time,
  midnight, 12/24-hour format, clock jumps, timezone changes, spring/fall DST,
  and engine-owned start/resume deadlines.
- Focused lint: **zero errors, zero warnings**. Syntax and diff whitespace pass.
- Guarded real Electron lane: **8 checks pass**, **10 screenshots**. Keyboard
  Enter selects faces; Space starts/pauses/resumes through the existing gateway.
  A real isolated My Mode load stays idle and retains the analog choice. Test
  Mode completes once through the unchanged engine.
- Idle/running/paused at **900×800 CSS pixels**, Chromium DPR **1.0/1.25/1.5**.
  Text bounds were checked and screenshots visually inspected. Reduced-motion
  current-time text remains unanimated. This is renderer scaling qualification;
  native Windows per-monitor DPI moves are not claimed and OS DPI was untouched.
- External immutable subprocess/prototype and network denial installed before
  product entry, plus the app QA power lock. **Zero native delegations, zero
  power requests, zero live smart-light/network mutations.** A test-only renderer
  Date shift verifies the paused wall-clock interval; Windows time was untouched.

Fresh QA assembly uses the already-qualified Electron/runtime/native helper and
current declared app inputs. Exactly **five application files** differ: renderer,
profiles renderer, formatting utilities, markup and focused styles. No compiler,
dependency install, full unit matrix or power qualification was repeated.

Evidence: `F:\LightsOutQA\LO-UX-CLOCK-1-20261019`.
The evidence includes the exact tranche patch, source hashes/HEAD/dirtiness,
isolated QA build manifest, test logs, guarded runtime record and screenshots.

The nightly Desktop installation, original profile (100 receipts, 106 ritual
events), shortcuts, rollback, selected 22-minute plan, saved modes and living
lamp assets remain protected. LO-POWER-3 RC1 remains unchanged and unpromoted.
No task, Windows configuration, power/light action, overnight trial, signing,
commit, push, release, deployment or ceremonial handoff occurred.
