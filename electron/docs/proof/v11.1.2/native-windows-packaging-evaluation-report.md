# Native Windows Packaging Evaluation Report

## Request

Modernization evaluation accepted.

Rejected candidates:

- **Electron Forge 7.11.2**: rejected, 37 vulnerabilities including 1 critical.
- **@electron/packager + electron-winstaller 5.4.0**: rejected, 10 high vulnerabilities.
- **ESLint 10.7.0 on Node 22.12.1**: currently incompatible because ESLint 10 requires Node `>=22.13.0`.

Goal: determine whether Lights Out can remove `electron-builder`, Electron Forge, `@electron/packager`, and `electron-winstaller` and replace them with:

- the officially provisioned Electron 43.1.0 runtime;
- a repository-owned PowerShell packaging script;
- an unpacked `resources/app` application layout;
- a portable ZIP produced by PowerShell;
- a maintained non-npm Windows installer compiler.

No product behavior, Android, application version, power-action logic, or PR #37 changed.

## 1. Immutable source

- **Starting SHA**: `3be229b3563bfdc1c81ff3c7b1f8fc360accd9e8`
- **Native packaging branch**: `refactor/v11.1.2-native-windows-packaging`
- **Existing modernization branch preserved**: `refactor/v11.1.2-modern-build-toolchain` (`2b66196`)
- **PR #37 changed**: no
- **Electron version**: `43.1.0` (locked)
- **Node current**: `22.12.0`
- **Node candidate evaluated**: `22.23.1`
- **ESLint current**: `9.39.4`
- **ESLint candidate evaluated**: `10.7.1`

## 2. Current packaged layout

Current `dist/win-unpacked` from `electron-builder` 26.15.3 contains:

- `Lights Out.exe` (~225 MB) — renamed from `electron.exe`
- `LICENSE`, `LICENSES.chromium.html`
- `chrome_*.pak`, `resources.pak`
- `d3dcompiler_47.dll`, `dxcompiler.dll`, `dxil.dll`, `ffmpeg.dll`, `icudtl.dat`
- `libEGL.dll`, `libGLESv2.dll`
- `locales/` directory with `.pak` files
- `snapshot_blob.bin`, `v8_context_snapshot.bin`
- `vk_swiftshader*.dll`, `vk_swiftshader_icd.json`, `vulkan-1.dll`
- `resources/`:
  - `app.asar` (~4 MB, 467 entries) with application source and production `node_modules`
  - `app.asar.unpacked/` (empty)
  - `elevate.exe`

Install behavior: NSIS assisted installer (`Lights Out Setup 11.1.2.exe`) with desktop/Start Menu shortcuts and uninstaller.
Portable artifact: single-file self-extracting `LightsOut.exe`.

## 3. Repository-owned unpacked build

Evaluation worktree: `c:\Users\KickA\AppData\Local\Temp\lightsout-native-packaging-eval`

PowerShell script: `electron/scripts/package-native-windows.ps1`

What it does:

1. Creates a clean `dist-native/win-unpacked` directory.
2. Copies the application files listed in `package.json` `build.files` into `dist-native/win-unpacked/resources/app`.
3. Copies `package.json` and `package-lock.json` into `resources/app`.
4. Runs `npm ci --omit=dev` inside `resources/app` to install a production-only `node_modules`.
5. Removes `package-lock.json` from the runtime copy.
6. Copies `node_modules/electron/dist` into `dist-native/win-unpacked`.
7. Renames `electron.exe` to `Lights Out.exe`.

Resulting layout:

- `dist-native/win-unpacked/Lights Out.exe`
- `dist-native/win-unpacked/resources/app/` containing `main.js`, `preload.js`, `index.html`, `renderer*.js`, `styles.css`, `assets/`, `package.json`, `node_modules/` (production only)
- `dist-native/win-unpacked/resources/default_app.asar` remains from Electron dist and is harmless

`app.asar` is intentionally not created. The `resources/app` directory is valid for Electron and simplifies the dependency graph.

## 4. Portable ZIP

Produced by `Compress-Archive`:

- Target: `dist-native/Lights-Out-Portable-v11.1.2-win-x64.zip`
- Contents: the `win-unpacked` directory contents (not a nested `win-unpacked` folder)
- Validated by extracting to a fresh temp directory and launching `Lights Out.exe`

Observed warnings: `Compress-Archive` adjusts Electron distribution file timestamps earlier than 1980 to `1/1/1980 00:00:00`. This is cosmetic and does not affect runtime.

## 5. External installer compilers

| Tool | Installed | Path / notes |
|---|---|---|
| **Inno Setup** | yes | `C:\ProgramData\chocolatey\bin\ISCC.exe` (Inno Setup 6 command-line compiler) |
| **WiX Toolset** | no | not found in PATH or common install directories |
| **NSIS** | no | not found in PATH or common install directories |

Selected installer compiler: **Inno Setup 6** (preferred; already installed; no npm dependency; supports uninstall/shortcuts/per-user installs/signing).

External installation required: none for the chosen compiler.

## 6. Node and ESLint evaluation

- Current environment: Node `22.12.1`
- ESLint 10.7.0 requires Node `^20.19.0 || ^22.13.0 || >=24`
- Newest 22.x available via nvm: `22.23.1`
- Installed Node `22.23.1` in a disposable shell and switched `nvm use 22.23.1`
- Upgraded `eslint` to `10.7.0`
- Removed deprecated `@eslint/js` direct dependency; migrated `eslint.config.js` to generate recommended rules from `eslint/use-at-your-own-risk` `builtinRules`
- Added `no-useless-assignment` and `preserve-caught-error` overrides as `'off'` to preserve existing effective rules (these are new in ESLint 10's recommended set)
- `npm run lint` passes with no errors

## 7. Minimal dependency graph audit

Graph A: packaging frameworks removed (`electron-builder` removed), ESLint 9 kept:

- `npm ci`: succeeds
- `npm audit`: 5 high vulnerabilities (all from ESLint 9's `@eslint/*` / `minimatch` / `brace-expansion`)
- `npm audit --omit=dev`: **0 vulnerabilities**

Graph B: packaging frameworks removed + ESLint 10 + Node `22.23.1`:

- `npm ci`: succeeds
- `npm audit`: **0 vulnerabilities**
- `npm audit --omit=dev`: **0 vulnerabilities**
- Total dependencies: 145

No `electron-builder`, Electron Forge, `@electron/packager`, or `electron-winstaller` remain. No forced `brace-expansion` override. No vulnerability waiver.

## 8. Native unpacked runtime validation (Dry Run)

Launch command: `Lights Out.exe --minimized --no-auto-start --user-data-dir=<temp>` with `ELECTRON_IS_DEV=1` and `LIGHTS_OUT_SUPPRESS_TRAY=1`.

Observed behavior:

- Application process starts and remains running.
- Console output includes `Loaded 4 profiles` and `Selected LAN IP: 192.168.0.11 (Wi-Fi 2)`.
- `Windows Firewall configuration skipped or failed: PowerShell exited with code 1` is expected in a temp user-data context and does not indicate a regression.
- No real power actions executed (`--no-auto-start` prevents timer start).
- After process termination, no orphan `Lights Out` processes or listeners on app ports remain.

Detailed menu automation is still gated by the existing native menu harness nondeterminism; manual/runtime behavior was observed only.

## 9. Distribution format comparison

| Aspect | Current electron-builder 26.15.3 | Native packaging candidate |
|---|---|---|
| **Unpacked output** | `dist/win-unpacked/` with `app.asar` | `dist-native/win-unpacked/` with `resources/app` (no `app.asar`) |
| **Portable artifact** | `LightsOut.exe` single-file self-extractor | `Lights-Out-Portable-v11.1.2-win-x64.zip` containing the unpacked directory |
| **Installer** | NSIS `Lights Out Setup 11.1.2.exe` | **Inno Setup** (selected; definition not yet built) |
| **app.asar** | yes | no (intentionally replaced with `resources/app`) |
| **Icon / metadata** | `assets/icon.ico`, appId, productName | configurable; current script copies `assets/icon.ico` |
| **Install behavior** | assisted, change directory | to be defined in Inno Setup script |
| **Uninstall behavior** | NSIS uninstaller | to be defined in Inno Setup script |
| **npm audit (full)** | 19 high | **0** |
| **npm audit (production)** | non-zero | **0** |

Intentional changes:

- Remove `electron-builder`, Electron Forge, `@electron/packager`, `electron-winstaller`.
- Replace `app.asar` with `resources/app`.
- Replace one-file portable EXE with a portable ZIP.
- Add repository-owned PowerShell packaging script.
- Upgrade ESLint to 10 and migrate to Node `>=22.13.0`.

## 10. Proposed commits

If accepted, use narrow commits:

- `chore(build): add dependency-minimal Windows packaging`
- `chore(lint): migrate to ESLint 10`
- `test(build): verify native package layout`
- `docs(release): record packaging modernization proof`

## Native Windows Packaging Evaluation Report — return fields

- **Starting SHA**: `3be229b3563bfdc1c81ff3c7b1f8fc360accd9e8`
- **Evaluation branch**: `refactor/v11.1.2-native-windows-packaging`
- **Existing modernization branch preserved**: `refactor/v11.1.2-modern-build-toolchain` (`2b66196`)
- **PR #37 changed**: no
- **Electron version**: `43.1.0`
- **Node current**: `22.12.1`
- **Node candidate**: `22.23.1` (satisfies ESLint 10.7.0)
- **ESLint current**: `9.39.4`
- **ESLint candidate**: `10.7.0`
- **Packaging frameworks removed**: `electron-builder` (and transitive Electron Forge/Packager/winstaller chains)
- **Current dependency count (electron-builder baseline)**: 400 total
- **Candidate dependency count**: 145 total
- **Full audit before**: 19 high
- **Full audit after**: 0
- **Production audit**: 0
- **Native staging script**: `electron/scripts/package-native-windows.ps1`
- **resources/app result**: valid; application launches
- **App launch**: success (Dry Run, no power action)
- **Portable ZIP**: `Lights-Out-Portable-v11.1.2-win-x64.zip` produced and extracted-launch validated
- **ZIP extraction proof**: extracted to temp directory; launched successfully
- **Inno Setup**: installed (Inno Setup 6)
- **WiX**: not installed
- **NSIS**: not installed
- **Selected installer compiler**: Inno Setup 6
- **External installation required**: no
- **Runtime validation**: app starts; profiles load; LAN IP selected; no timer/auto-start
- **Menu behavior**: not automated (manual/runtime only; existing harness nondeterminism not waived)
- **Companion behavior**: LAN IP selection observed; companion listener not exercised
- **Receipt identity**: not explicitly exercised in this evaluation
- **Process cleanup**: 0 orphan `Lights Out` processes after termination
- **Listener cleanup**: 0 listeners on app ports after termination
- **Firewall cleanup**: pre-existing `Lights Out` firewall rule remains; no new rules added by evaluation
- **Temporary-profile cleanup**: no diagnostic profiles created; temp extraction dirs removed after validation
- **Real power actions**: 0
- **Exact changed files**: `electron/package.json`, `electron/package-lock.json`, `electron/eslint.config.js`, `electron/scripts/package-native-windows.ps1`, `electron/docs/proof/v11.1.2/native-windows-packaging-evaluation-report.md`
- **Proposed commits**: `chore(build): add dependency-minimal Windows packaging`, `chore(lint): migrate to ESLint 10`, `test(build): verify native package layout`, `docs(release): record packaging modernization proof`
- **Current artifacts publishable**: no (installer not yet built; branch is draft)
- **Remaining issues**: `package-native-windows.ps1` does not yet produce an installer; `Compress-Archive` timestamp warnings; final icon embedding requires separate resource editing if desired; Node must be updated to `>=22.13.0` for ESLint 10 in primary environment
- **Verdict**: **Proceed**. The native Windows packaging route produces a clean zero-audit graph, a working `resources/app` layout, a validated portable ZIP, and a viable Inno Setup installer path. Commit the evaluated changes to `refactor/v11.1.2-native-windows-packaging` after confirming the primary environment can run Node `22.23.1` or later.
