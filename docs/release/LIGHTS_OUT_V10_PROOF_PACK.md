# Lights Out v10.0.0 Proof Pack

**Version:** 10.0.0

**Release line:**
Lights Out v10.0.0 is the zero-friction sleep/shutdown timer: calendar-aware, idle-aware, bedtime-aware, with ambient visuals, smart-light sunrise, and proof-backed Windows builds.

## Commits

- `75a1f57` original v10 implementation
- `18748a0` hardening/proof fixes

## Build

- `npm run build`: PASS
- `node --check` (all modules): PASS
- Smoke tests: 41/41 PASS

## Artifacts

- `Lights Out Setup 10.0.0.exe`
- `LightsOut.exe` portable

## Feature Proof

### Ambient Visuals
- Canvas-rendered backgrounds (fireplace, rain, starfield, aurora) during dim phase
- **Proof:** `AmbientVisuals.stop()` called on both cancel and complete code paths
- Runs via `<script>` tag in renderer only (not Node)
- CSS `opacity: 0` by default, fades to `0.6` only during dim phase

### Calendar Auto-Start
- Checks every 60s for calendar events starting within 2 minutes
- **Proof:** Only matches events containing keywords: "lights out", "bedtime", "wind down", "shutdown", "sleep timer", "goodnight", "lights off"
- "Team Standup" and "Lunch with Sarah" correctly skipped in test
- Calendar fetch failure caught silently (`try/catch`), does not crash app

### Idle Detection
- Win32 `GetLastInputInfo` via PowerShell, checks every 15s
- **Proof:** `wasIdle` flag fires once on idle enter, once on return
- No repeat notifications within the same idle/return cycle
- Threshold configurable, default 5 minutes

### Bedtime Reminder
- Checks every 60s against configured bedtime
- **Proof:** `bedtimeReminderEnabled` and `bedtimeReminderMinutes` persisted in settings
- Toggle state restores on app launch
- Fires once per day per date check (`lastReminderDate` guard)

### Smart Light Sunrise Sync
- During First Light, gradually brightens room lights 0-100% over 60s
- **Proof:** `invokeSmartLightAction().catch(() => {})` swallows all failures
- Timer completes regardless of smart light availability
- Hue/HA/IFTTT/MQTT offline = silent skip, no crash

### Morning Routine Builder
- 5s after First Light, fetches calendar + sleep debt + streaks
- **Proof:** Only notifies `if (data?.events?.length)` -- honest empty state
- Calendar fetch failure caught, briefing simply not sent
- No fabricated placeholder data

## Version Alignment

- `package.json` version: `10.0.0`
- Build output: `Lights Out Setup 10.0.0.exe`
- HTML footer: `v10.0.0`
- Git tag: `v10.0.0`

## Safety Guarantees

- No real shutdown during tests
- No cloud telemetry (all data local)
- Smart light failure does not block timer
- Calendar failure does not crash app
- Ambient visuals clean up on timer end
- Idle detection does not spam notifications
- Calendar auto-start does not trigger from non-bedtime events
- Morning briefing does not fabricate data
