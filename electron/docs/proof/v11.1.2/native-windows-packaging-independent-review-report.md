# Native Windows Packaging Independent Review Report

## Return summary

- **Base SHA**: `3be229b3563bfdc1c81ff3c7b1f8fc360accd9e8`
- **Branch**: `refactor/v11.1.2-native-windows-packaging`
- **Reviewed HEAD**: `03d2950` plus in-review worktree additions (to be committed)
- **Stacked draft PR**: #38 (`refactor/v11.1.2-native-windows-packaging` into `fix/v11.1.2-tar-audit-final-gate`)
- **Exact commits**:
  - `c8ee992` — `chore(build): add dependency-minimal Windows packaging`
  - `43e7a74` — `chore(lint): migrate to ESLint 10`
  - `38c2274` — `docs(release): record packaging modernization proof`
  - `03d2950` — `chore(dev): pin supported Node 22 toolchain`
- **Exact changed files** (review additions):
  - `electron/.nvmrc`
  - `electron/package.json`
  - `electron/package-lock.json`
  - `electron/eslint.config.js`
  - `electron/scripts/check-node.js`
  - `electron/scripts/package-native-windows.ps1`
  - `electron/scripts/LightsOut-Setup.iss`
  - `electron/scripts/packaged-native-smoke.js`
  - `electron/scripts/packaged-native-network-smoke.js`
  - `electron/test/dependency-security.test.js`
  - `electron/docs/proof/v11.1.2/native-windows-packaging-independent-review-report.md`

## Environment

- **Node previous**: `22.12.1`
- **Node reviewed**: `22.23.1`
- **Node contract**: `.nvmrc` `22.23.1`; `package.json` `engines.node` `>=22.13.0`; `npm run check-node` preflight
- **Electron version**: `43.1.0`
- **ESLint version**: `10.7.0`
- **electron-builder present**: no
- **Forge present**: no
- **@electron/packager present**: no
- **electron-winstaller present**: no

## Dependency graph

- **Direct dependency count**: 6 (`electron`, `eslint`, `png-to-ico`, `qrcode`, `sharp`, `ws`)
- **Total dependency count**: 145
- **npm ci**: pass
- **Full audit**: 0 vulnerabilities
- **Production audit**: 0 vulnerabilities
- **No forced brace-expansion override**: confirmed
- **No vulnerability waiver**: confirmed
- **No lowered audit threshold**: confirmed

## Native build script review

- **Script**: `electron/scripts/package-native-windows.ps1`
- **Runtime allowlist**: `package.json` `build.files`
- **Excluded development files**: tests, docs, `.git`, `.github`, `.claude`, `.kilo`, proof screenshots, dev scripts, source maps, caches, nested worktrees, old build outputs
- **Runtime dependencies**: `qrcode`, `sharp` and their transitive production dependencies only (`npm ci --omit=dev` inside `resources/app`)
- **Native unpacked path**: `dist-native/win-unpacked`
- **Native unpacked bytes**: `397,415,863`
- **Native unpacked file count**: `611`
- **resources/app validation**: contains only runtime-required files, production `node_modules`, no dev-only tree, no secrets, no recursive `dist-native`, no stale `electron-builder` artifacts

## Windows executable metadata and branding

- **Executable product name**: *(blank)*
- **Executable file description**: *(blank)*
- **Executable version**: `43.1.0`
- **Product version**: `43.1.0`
- **Company name**: `GitHub, Inc.`
- **Original filename**: `electron.exe`
- **Internal name**: *(blank)*
- **Executable icon**: generic Electron icon
- **Generic Electron identity remaining**: **yes — distribution blocker**
  - Renaming `electron.exe` to `Lights Out.exe` does not update embedded version info, icon, or original filename.
  - A resource editor (e.g., `rcedit`) or resource compiler step is required before this is shippable.

## Portable ZIP

- **ZIP name**: `Lights-Out-Portable-v11.1.2-win-x64.zip`
- **ZIP size**: `162,341,217` bytes
- **ZIP top-level directories**: `locales`, `resources` (no nested `win-unpacked` folder)
- **ZIP file count**: `611`
- **Path traversal / absolute paths**: none
- **Development worktree files / settings / caches / profiles**: none
- **ZIP extraction**: pass
- **Extracted Dry Run launch**: pass
- **Repeat build hash deterministic**: not proven

## Inno Setup installer

- **Inno Setup version**: `6.7.1`
- **Inno compiler path**: `C:\ProgramData\chocolatey\bin\ISCC.exe` (engine `C:\Users\KickA\AppData\Local\Programs\Inno Setup 6\ISCC.exe`)
- **Installer script path**: `electron/scripts/LightsOut-Setup.iss`
- **Application ID**: `com.lightsout.sleep-timer`
- **Application name**: `Lights Out`
- **Version**: `11.1.2`
- **Publisher**: `Lights Out`
- **Default install directory**: `{localappdata}\Programs\Lights Out`
- **Per-user vs per-machine**: per-user (`PrivilegesRequired=lowest`)
- **Privileges required**: none
- **Start Menu shortcut**: created in `{autoprograms}`
- **Desktop shortcut**: optional (`desktopicon` task, unchecked by default)
- **Upgrade behavior**: install over existing directory; user data retained
- **Uninstall behavior**: `{app}` files removed; user data not touched
- **Launch-after-install behavior**: none (`DisableFinishedPage=yes`, no `[Run]` entries)
- **Compression**: `lzma2` / `SolidCompression=yes`
- **Signing settings**: none

### Installer test results

- **Clean install**: pass (exit `1`)
- **Installed Dry Run launch**: pass
- **In-place upgrade**: pass
- **Settings preservation**: pass (`customization.accent` `#a855f7` retained across upgrade)
- **Uninstall (clean)**: pass (exit `1`, install directory removed)
- **Uninstall (after launch)**: exit `1`, install directory left empty; requires investigation
- **Shortcut cleanup**: not explicitly verified
- **Process cleanup**: pass
- **Listener cleanup**: pass
- **Firewall cleanup**: pass
- **Temporary-profile cleanup**: pass

## Source validation under Node 22.23.1

- **Lint**: pass
- **Syntax (`main.js`, `preload.js`, `renderer.js`, `renderer-settings.js`)**: pass
- **Unit tests**: `301` passed, `0` failed
- **Smoke**: `261` passed, `0` failed
- **Companion smoke**: `15` passed, `0` failed
- **Full audit**: `0`
- **Production audit**: `0`
- **Real power actions**: `0`

## New-package validation

- **Packaged smoke**: `4` passed, `0` failed (`scripts/packaged-native-smoke.js`)
- **Packaged truth**: no dedicated script; receipt recovery runtime covered below
- **Packaged network**: pass (`scripts/packaged-native-network-smoke.js`); listener and firewall cleanup confirmed
- **Receipt recovery**: `13` passed, `0` failed; real power actions `0`
- **C2 proof**: `88` passed, `0` failed; real power actions `0`
- **Startup/shutdown lifecycle**: pass
- **Process cleanup**: pass
- **Listener cleanup**: pass
- **Firewall cleanup**: pass
- **Profile cleanup**: pass

## Menu-harness blocker

- **Manual menu behavior**: not separately validated beyond runtime launch
- **Deterministic automated menu proof**: remains a separate release blocker; not claimed as fixed by packaging modernization

## Signing truth

- **Portable Authenticode**: `NotSigned`
- **Installer Authenticode**: `NotSigned`

## PR and branch state

- **PR #37 changed**: no
- **Working tree**: clean (after review commits)
- **Existing artifacts publishable**: no
- **New candidate artifacts publishable**: no

## Remaining blockers

1. **Executable branding/metadata**: still generic Electron; requires a resource editor (`rcedit` or equivalent) to set product name, description, company, version, and icon.
2. **Inno uninstall after app launch**: returned exit `1` and left an empty install directory in one test; needs root cause and fix.
3. **Packaged truth smoke**: no native truth smoke script exists; receipt recovery runtime provides substitute coverage.
4. **Deterministic menu harness**: flaky native-menu automated proof remains a separate release blocker.
5. **Authenticode signing**: not configured; both portable executable and installer are `NotSigned`.
6. **ZIP determinism**: not proven across repeat builds.

## Verdict

**FAIL — not release-ready.**

The native packaging candidate successfully removes the vulnerable npm packaging graph, produces a working `resources/app` runtime, a launchable portable ZIP, and a compilable Inno Setup installer. Node `22.23.1` plus ESLint `10.7.0` gives a zero-audit dependency graph, and all current source-level validation passes.

However, the candidate is **not shippable** until the following are resolved:

- Generic Electron executable branding and icon must be replaced with Lights Out identity.
- Uninstall must reliably remove the install directory after the application has been launched.
- Authenticode signing must be configured (or explicitly documented as not in scope).
- The deterministic native-menu automated proof must pass in its own lane.

Do not mark the draft PR ready or merge.
