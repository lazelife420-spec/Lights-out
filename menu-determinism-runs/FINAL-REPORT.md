# Native-Menu Determinism Gate – Final Report

## Objective
Achieve deterministic native-menu automation and validate the fix with a 10-cold + 5-warm consecutive-run determinism gate, full regression gate, cleanup verification, and a final report.

## Branch / PR
- **Branch:** `test/v11.1.2-native-menu-determinism`
- **Target:** `fix/v11.1.2-tar-audit-final-gate`
- **Draft PR:** https://github.com/lazelife420-spec/Lights-out/pull/39

## Root Causes Identified
1. **Flaky submenu clicks** – The generic `CdpSession.click` helper relied on `elementFromPoint` retries with fixed waits. Submenu items (`#toggle-dryrun`, `#open-options`, etc.) were frequently reported as "missing or unstable".
2. **Unreliable process cleanup** – `stopApp` used PowerShell + `Get-CimInstance` to kill and probe process state. This was slow, prone to WMI staleness/hangs, and `Stop-Process` silently failed on `CimInstance` pipeline input.
3. **Native smoke path bug** – `native-packaged-truth-smoke.js` looked one directory too high for `dist-native`.
4. **Gate hang on orphan Electron** – Without `child.unref()`, a surviving Electron process could keep the Node test process alive.

## Fixes Applied
- `electron/scripts/desktop-ux-functional-gate.js`
  - `CdpSession.condition()` now returns the truthy evaluation result.
  - Added `CdpSession.clickMenuItem()` – waits for the element to be the topmost hit target, then moves the pointer and clicks.
  - Replaced fixed `WAIT` calls and `s.click()` in `runTopMenuGate()` with `s.condition()` and `s.clickMenuItem()` for `#open-options`, `#toggle-dryrun`, `#menu-power [data-action="shutdown"]`, and `#open-about`.
  - Rewrote `stopApp()` to terminate and verify using direct `taskkill` / `tasklist` calls instead of PowerShell/WMI, added a bounded retry/poll loop, and unref'd the spawned child.
  - Replaced `process.exit(1)` in the failure handler with `process.exitCode = 1` so stdout/stderr streams flush.
- `electron/scripts/native-packaged-truth-smoke.js`
  - Fixed `distNative` path to `electron/dist-native/win-unpacked`.

## Determinism Gate Results
**Gate 4 (final): 15/15 passed**  
Log: `menu-determinism-runs/determinism-gate-4.log`

```
PASSES=15 FAILS=0
Determinism gate 4 finished at Sun 07/26/2026  0:11:05.74
```

## Regression Gate Results
| Lane | Result | Evidence |
|------|--------|----------|
| `node --check main.js/renderer.js/preload.js` | Passed | Syntax-checked during edits |
| `npm run lint` | Passed | `menu-determinism-runs/lint.log` (no errors) |
| `npm test` | Passed | `menu-determinism-runs/npm-test.log` (301 passed) |
| `npm run smoke` | Passed | `menu-determinism-runs/smoke.log` (125/0) |
| `npm run smoke:companion` | Passed | `menu-determinism-runs/smoke-companion.log` (15/0) |
| `npm run smoke:native` | Passed | `menu-determinism-runs/smoke-native-2.log` (5/0) |
| `npm run build` | **Not completed** | `menu-determinism-runs/build.log` – build script stopped because `rcedit.exe` is not installed in this environment. This is an environment limitation, not a code regression. |

## Cleanup Verification
- `check-processes.ps1` after cleanup showed **no `Lights Out.exe` processes** and **no `electron` test processes**.
- `cleanup-temp-dirs.ps1` removed **71 leftover `lightsout-desktop-ux-gate-*` temporary directories** from `%TEMP%`.
- Final `processes.txt` confirms **no Lights Out processes** and **no temp dirs** remain.

## Conclusion
The native-menu automation is now deterministic: the determinism gate achieved **15/15 consecutive passes**, the required regression lanes pass, and the system is left clean of test artifacts and orphan processes. The only unresolved item is the packaging build step, which is blocked by the absence of `rcedit.exe` in the current environment and is unrelated to the menu-determinism work.
