# Lights Out v10.1.0 — Shipping Receipt

**Date:** 2026-06-24  
**Release:** v10.1.0 Visual Northstar  
**Tag:** `v10.1.0`  
**main:** `0bf4d10`

---

## What Shipped

Three new northstar visual screens landing on top of an unchanged timer/shutdown core.

| Slice | Screen | Key behavior |
|---|---|---|
| 1 | Last Light overlay | Cinematic countdown ring, UNPLUG button disabled/informational, emergency cancel via Ctrl+Shift+S |
| 2 | Lobby / Tonight's Run | Icon sidebar rail (LIB/SCH/SET/STATS/?), centered wordmark, PLAY button delegates to existing start |
| 3 | Morning Proof hero | Full-width card, real stat pills (session, action, snoozes, total runs), Play Tonight Again + Dismiss |

### Settings Persistence (new in this release)
- `timerName` — editable session name now saves on every edit and restores on launch
- `nsActiveTab` — active sidebar tab persists across sessions
- `nsSelectedMode` — selected mode card persists (safe no-op until mode cards are added)

### Smoke Suite
- Expanded from ~41 to **57/57** assertions
- New coverage: tray guards, IPC handler presence, renderer control wiring, keyboard shortcuts, preview-safe defaults, login/warning wording, preload bridge

---

## PR Chain

| PR | Title | Merged |
|---|---|---|
| #29 | chore: canonical reconciliation | 2026-06-24 |
| #30 | Add Lights Out visual northstar UI | 2026-06-24 |
| #31 | Release Lights Out v10.1.0 visual northstar | 2026-06-24 |

---

## CI Results

| Job | Result |
|---|---|
| Lint & Smoke | ✅ passed |
| Package (Windows) | ✅ passed |
| Publish Release | ✅ published (tag push trigger) |

---

## Release Assets

| File | Notes |
|---|---|
| `Lights.Out.Setup.10.1.0.exe` | NSIS installer, x64 |
| `LightsOut.exe` | Portable build, x64 |
| `SHA256SUMS.txt` | Checksums for both artifacts |

GitHub Release: https://github.com/Z3r0DayZion-install/lights-out/releases/tag/v10.1.0  
Not draft · Not pre-release

---

## What Did Not Change

- Timer logic, countdown, phase transitions
- Shutdown execution path (`executePowerAction`)
- Last Light audio/sequence engine (`lastLight.js`)
- IPC handler signatures
- PowerShell fallback (`SleepTimer.exe v5.3.0`)
- Version: `10.0.10` → `10.1.0` only (no 10.0.x patch skipped)

---

## Integrity Checks

- Tag `v10.1.0` not moved or reused
- No fake stats in Morning Proof (streak pill omitted — not tracked)
- UNPLUG button correctly non-interactive (`disabled` + `aria-disabled`)
- `dist/LightsOut.exe` is the only valid portable artifact; root `LightsOut.exe` does not exist
- `main` matches published release at merge of PR #31
