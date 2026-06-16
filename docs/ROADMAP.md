# Lights Out™ — A Proof Foundry Product

# Roadmap

## Current Truth

Lights Out™ is live at v10.0.10 — proof-first software forged for builders.

Recent shipped fixes:

- v10.0.8 fixed the in-app updater download target so it selects the real installer asset.
- Remote control hardening landed on `main`: remote control is gated behind pairing token and safer host binding.
- v10.0.9 restored the Streaks tab panel and fixed the cancel-timer guided-breathing error toast.
- v10.0.10 fixed a packaged-app startup crash (remoteControl.js was missing from the electron-builder file manifest) and corrected settings saves for WiFi Guard, Content Blocker, and Accountability.

Current strongest product promise:

```text
Lights Out helps Windows users stop drifting past bedtime by turning shutdown into a visible, repeatable routine with proof.
```

## The Proof Foundry Standard

> No fake claims. No missing receipts. Ship with proof.

## Product Pillars

### 1. Reliable Shutdown

The timer must always feel trustworthy.

Roadmap:

- Keep force shutdown explicit and never accidental.
- Improve cancellation, pause, snooze, and resume reliability.
- Keep tray behavior predictable.
- Keep updater links and release assets verified.

Proof gates:

- Start timer.
- Pause.
- Snooze.
- Cancel.
- Quit from tray.
- Relaunch.
- Build.
- Smoke tests.

### 2. Personal Wind-Down

Lights Out should feel like a nightly cockpit, not a generic timer.

Roadmap:

- Saved profiles for routines like Movie Night, Hard Stop, Witchcraft, Beastmode.
- Better profile sorting and pinned favorites.
- Optional profile notes.
- Last-used routine memory.
- Better visual state for active profile.

Proof gates:

- Create profile.
- Load profile.
- Auto-start profile if enabled.
- Export/import profiles.
- No layout break at normal window size.

### 3. Streaks And Accountability

The streak UI should make the habit visible without pretending to be medical sleep tracking.

Roadmap:

- Keep Streaks tab visible and clickable.
- Add Home callout for current streak.
- Add timer-complete streak celebration.
- Add morning briefing streak summary.
- Add weekly/monthly views later.

Avoid:

- Medical language.
- Sleep-quality diagnosis.
- Fake scores that are not backed by actual events.

Proof gates:

- Seed streak data.
- Display current streak.
- Display best streak.
- Display total nights.
- Display average bedtime.
- Verify all tabs switch.

### 4. Proof And Receipts

Lights Out should prove what happened.

Roadmap:

- Improve receipt viewer.
- Add clearer proof copy.
- Make copy-proof action more visible after completion.
- Export session proof.
- Include release checksum verification instructions on landing page.

Proof gates:

- Start timer.
- Complete/cancel session.
- Receipt exists.
- Receipt can be viewed.
- Proof can be copied.
- Receipt does not overclaim.

### 5. Safe Remote Control

Remote control should be useful only when safe.

Roadmap:

- Keep remote control off by default.
- Keep pairing token required.
- Keep companion bound to `127.0.0.1` by default.
- Add clearer Remote Control settings copy.
- Later: trusted LAN mode with explicit warning and proof.

Proof gates:

- Default no listener.
- Enable generates token.
- Bad token rejected.
- Good token works.
- Regenerate revokes old token.
- Disable stops listener.

## Suggested Release Sequence

### v10.1.0 - Runtime Trust Polish

Goal: make the app feel unbreakable.

Candidate work:

- Tray/menu regression proof.
- Better visible updater status.
- Clearer completed/cancelled session state.
- Home streak callout.
- Morning briefing uses streak data already sent by main process.

Ship only if:

- Smoke passes.
- Build passes.
- Runtime screenshots prove each changed workflow.

### v10.2.0 - Streaks That Feel Alive

Goal: make habit progress visible without fake wellness claims.

Candidate work:

- Weekly streak view.
- Monthly history.
- Timer-complete streak celebration.
- Missed-night neutral state.
- Export streak summary.

Ship only if:

- Data is real event data.
- Empty state is honest.
- Seeded-data screenshots pass.

### v10.3.0 - Profiles Upgrade

Goal: make routines fast to reuse.

Candidate work:

- Pinned profiles.
- Profile search.
- Profile categories.
- Profile import/export polish.
- Safer overwrite prompts.

Ship only if:

- Create/load/export/import all pass.
- No profile data loss.

### v11.0.0 - Serious Night Mode

Goal: a full night shutdown cockpit for Windows power users.

Candidate work:

- Full-screen clock mode polish.
- Ambient visuals.
- Smart light integration only if runtime-proven.
- Calendar-based wind-down only if parser tests are strong.
- Remote companion mature enough for real LAN use.

Ship only if:

- Manual runtime proof exists.
- No fake integrations.
- No unsafe remote defaults.

## Brand Promise

Proof-first software forged for builders.

- Direct
- Confident
- Evidence-backed
- Practical
- No hype
- No fake AI claims
- No medical sleep claims
- No guaranteed productivity/sleep claims

## Backlog Parking Lot

Good ideas, not immediate:

- Achievements.
- Weekly reports.
- Family profiles.
- Focus scoring.
- Screen-time limits.
- Recurring alarms.
- Content blocker schedules.

Reason to park: these are feature-expansion lanes. Do not start them until the existing nightly workflow feels airtight.
