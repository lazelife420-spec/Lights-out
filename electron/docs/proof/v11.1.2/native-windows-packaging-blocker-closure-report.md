# Native Windows Packaging Blocker-Closure Report

**PR:** #38 (`refactor/v11.1.2-native-windows-packaging`)  
**Date:** 2026-07-25  
**Author:** Cascade / Proof Foundry  

## Executive Summary

The three PR-readiness blockers identified for native Windows packaging have been diagnosed, fixed, and validated:

1. **Executable branding** – `Lights Out.exe` is now stamped with non-generic Windows identity metadata and a branded icon using the approved existing `rcedit` tool.
2. **Post-launch uninstall reliability** – The Inno Setup installer now detects a running `Lights Out.exe` process and aborts setup/uninstall cleanly (including in `/VERYSILENT /SUPPRESSMSGBOXES` mode), preventing partial uninstalls and locked-file failures.
3. **Native packaged-truth coverage** – A dedicated `smoke:native` truth smoke and a repeatable `test:uninstall-matrix` have been added and pass.

The publication blocker remains **Authenticode code signing**; both the portable executable and the installer are currently unsigned.

## PR #38 State

| Property | Value |
|----------|-------|
| Branch | `refactor/v11.1.2-native-windows-packaging` |
| HEAD | `391a9b3` |
| Remote | `origin/refactor/v11.1.2-native-windows-packaging` (`https://github.com/lazelife420-spec/Lights-out.git`) |
| PR status | Draft #38 |
| Tree | Clean of unintended build output; `dist-native/` added to `.gitignore` |

### Commits Pushed

| SHA | Message |
|-----|---------|
| `6a8560a` | feat(packaging): native Windows identity stamping and PowerShell 5.1 compatibility |
| `452203c` | feat(main): add test-only `--test-quit-after-start` CLI flag |
| `4b0eaa9` | fix(installer): block setup/uninstall while `Lights Out.exe` is running |
| `88f714e` | test(packaging): add native packaged-truth smoke and uninstall matrix |
| `391a9b3` | chore: ignore `dist-native` build output |

## Blocker Classification

| Blocker | Category | Resolution |
|---------|----------|------------|
| Executable branding (`Lights Out.exe` still showed generic Electron metadata) | PR readiness | Resolved |
| Post-launch uninstall leaves files / fails with in-use errors | PR readiness | Resolved |
| No native packaged-truth smoke guarding the produced artifacts | PR readiness | Resolved |
| Authenticode signing absent | Publication | Remains a publication blocker; recorded below |
| Deterministic menu harness | Separate release blocker | Out of scope for PR #38 (unchanged) |

## 1. Executable Branding

### Diagnosis

Before stamping, `dist-native\win-unpacked\Lights Out.exe` carried the default Electron version info (`Electron`, `33.x.x.0`, etc.) and the stock Electron icon.

### Approved Tool Used

- `rcedit.exe` located at `C:\Users\KickA\AppData\Local\Programs\Antigravity IDE\resources\app\node_modules\@vscode\gulp-electron\node_modules\rcedit\bin\rcedit.exe`
- No new resource editor was installed.

### Implementation

- `electron/scripts/stamp-windows-identity.ps1` stamps the executable with the correct icon and version info.
- `electron/scripts/verify-windows-identity.ps1` verifies that the metadata no longer contains generic Electron branding.
- `electron/scripts/package-native-windows.ps1` invokes both scripts as part of the build flow.

### Current Metadata

Smoke test `native: executable metadata is branded` passes for `dist-native\win-unpacked\Lights Out.exe`.

Expected and verified values include:

- `CompanyName`: `The Proof Foundry`
- `FileDescription`: `Lights Out`
- `FileVersion`: `11.1.2.0`
- `InternalName`: `Lights Out`
- `OriginalFilename`: `Lights Out.exe`
- `ProductName`: `Lights Out`
- `ProductVersion`: `11.1.2`
- `LegalCopyright`: `Copyright (C) 2026 The Proof Foundry. All rights reserved.`

### Build Artifacts (unsigned)

| Artifact | SHA-256 |
|----------|---------|
| `dist-native\win-unpacked\Lights Out.exe` | `2A630319C42CC33074B10EEBADBCDFEECCA13FA1EEFCAE746442ED52693E5E87` |
| `dist-native\Lights-Out-Setup-11.1.2.exe` | `EC4F49F6A61173AD73389D976E0C12C4E60BA64F314936C96C1DDD295EA5E1C3` |

## 2. Post-Launch Uninstall Reliability

### Root Cause

The Inno Setup uninstaller attempted to delete files while `Lights Out.exe` (and its child processes) were still running. Windows returned `ERROR_SHARING_VIOLATION` (5) and `ERROR_DIR_NOT_EMPTY` (145), resulting in a partially deleted install directory.

`CloseApplications=yes` and `CloseApplications=force` did **not** prevent the uninstaller from attempting deletion in this configuration, and `AppMutex` caused a non-suppressible UI prompt that hung in silent mode. The reliable fix is explicit process detection in the installer itself.

### Implementation

`electron/scripts/LightsOut-Setup.iss` now contains a `[Code]` section with `InitializeSetup` and `InitializeUninstall` functions that:

1. Run `tasklist.exe` filtered by `imagename eq "Lights Out.exe"`.
2. If any matching process is found, abort (`Result := False`).
3. In silent mode, abort without displaying a message box; in interactive mode, show a clear error.

This avoids locked-file deletion entirely by refusing to install or uninstall while the application is running.

### Repeatable Uninstall Matrix

A PowerShell matrix (`electron/scripts/uninstall-matrix.ps1`, `npm run test:uninstall-matrix`) runs the following scenarios and emits `TEMP\lightsout-uninstall-matrix.json`:

| Scenario | Description | Result |
|----------|-------------|--------|
| A | Install, no launch, uninstall | `installExit=0`, `uninstallExit=0`, `leftoverCount=0` |
| B | Install, launch, clean `--test-quit-after-start`, uninstall | `installExit=0`, `uninstallExit=0`, `leftoverCount=0` |
| C | Install, launch, leave running, uninstall | `installExit=0`, `uninstallExit=1` (abort), `leftoverCount=689` |
| D | Install, launch, `taskkill /F /T`, uninstall | `installExit=0`, `uninstallExit=0`, `leftoverCount=0` |
| E | Install over existing per-user install | `installExit=0`, `install2Exit=0`, `leftoverCount=689` |

**Matrix summary: `5 passed, 0 failed`.**

## 3. Native Packaged-Truth Smoke

### Implementation

- `electron/scripts/native-packaged-truth-smoke.js` – new Node smoke test.
- `npm run smoke:native` added to `electron/package.json`.

### What It Verifies

1. `dist-native\win-unpacked\Lights Out.exe` exists.
2. The executable is at least 40 MB.
3. The executable metadata is branded (see values above).
4. The app launches and exits cleanly using the supported `--test-quit-after-start` flag.
5. No orphan `Lights Out` processes remain after the test.

### Result

`npm run smoke:native` passes with `5 passed, 0 failed`.

## 4. Full Current-HEAD Validation

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | Pass |
| Syntax (main.js, renderer.js, preload.js) | `node --check ...` | Pass |
| Unit tests | `npm test` | **301 pass, 0 fail** |
| Smoke | `npm run smoke` | **261 pass, 0 fail** |
| Native truth smoke | `npm run smoke:native` | **5 pass, 0 fail** |
| Audit | `npm audit` | **0 vulnerabilities** |
| Native build | `npm run build` | Success (`dist-native` produced) |
| Installer compile | `ISCC.exe scripts\LightsOut-Setup.iss` | Success |
| Uninstall matrix | `npm run test:uninstall-matrix` | **5/5 pass** |

## 5. Signing Truth

Both built artifacts were checked with `Get-AuthenticodeSignature`:

| Artifact | Signature Status |
|----------|------------------|
| `dist-native\win-unpacked\Lights Out.exe` | **NotSigned** |
| `dist-native\Lights-Out-Setup-11.1.2.exe` | **NotSigned** |

### Publication Blocker

**Authenticode signing is a publication blocker.** PR #38 itself is not blocked by unsigned artifacts, but a public release/tag must not be created until the signing lane (SignPath/Azure signing acquisition) is completed and the binaries are re-built and re-verified from a fresh signing branch, per the existing release policy.

## Cleanup

- `dist-native/` added to `.gitignore`; build output is not committed.
- Temporary `lo-matrix-*` and `lo-uninstall-test-*` directories under `%TEMP%` can be removed when the report is accepted.
- Logs for this session are retained in `%TEMP%` for audit:
  - `blocker-build*.log`
  - `blocker-iscc*.log`
  - `blocker-matrix*.log`
  - `blocker-lint.log`, `blocker-test.log`, `blocker-smoke.log`, `blocker-audit.log`
  - `lightsout-uninstall-matrix.json`

## Recommendations

1. Keep PR #38 as draft until the publication signing blocker is resolved.
2. Do not tag or release `v11.1.2` until Authenticode-signed binaries are produced and the Sandbox proof is re-run on the signed artifacts.
3. The deterministic menu harness remains a separate release blocker; do not conflate it with PR #38 readiness.

## Conclusion

All three PR-readiness packaging blockers (executable branding, post-launch uninstall reliability, and native packaged-truth smoke coverage) are closed. The branch has been pushed to PR #38. The only remaining blocker is Authenticode signing, which is a publication blocker, not a PR-readiness blocker.
