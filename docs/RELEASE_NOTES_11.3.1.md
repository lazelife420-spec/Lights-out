# Lights Out v11.3.1

A small follow-up to v11.3.0 from its engineering audit. Update if you use a
real (non-Test Mode) timer with WiZ or Hue lights.

**Quitting stops the ending.** If you quit Lights Out in the last moments of a
real run, while it checks for unsaved work, the run now stops there: the lights
are not switched off and no power action is requested.

**Your lights come back.** When a run's ending is blocked (Wi-Fi Guard could not
confirm the internet came back, or the unsaved-work check was unavailable), the
room it dimmed is put back the way it was instead of staying dim. Starting a new
run over a dimmed room restores the room first, so cancelling the new run brings
back your normal lighting rather than the dim level. A light you switched off
yourself stays off.

**Hardening.** The Hue bridge certificate pin can only be set by Lights Out's
own pairing step.

**Tidier Tonight screen.** The dial no longer repeats Test Mode (the pill,
Safety strip and footer already say it; a real action still shows its red chip
on the dial), the running dial drops the end time the plan already states, and
Cancel lines up with Pause and Snooze.

Assets: `Lights-Out-Setup-v11.3.1.exe`, `Lights-Out-Portable-v11.3.1-win-x64.zip`,
`SHA256SUMS.txt`, `BUILD-MANIFEST.json` and `WINDOWS-VERIFICATION.json`. Both
packages are unsigned. Smart-light behaviour is unit-tested; physical testing
used one WiZ bulb (see the v11.3.0 qualification record).
