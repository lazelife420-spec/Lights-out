# v11.1.2 Security Remediation and Gate Stabilization

## Dependency advisory

- Advisory: `GHSA-r292-9mhp-454m`
- Affected range: `tar <=7.5.20`
- Installed vulnerable resolution: `tar@7.5.19`
- Patched resolution: `tar@7.5.22`
- Registry-confirmed minimum patched release: `tar@7.5.21`
- Dependency type: transitive development/build dependency
- Introducing paths:
  - `electron-builder@26.15.3 > app-builder-lib@26.15.3 > tar`
  - `electron-builder@26.15.3 > app-builder-lib@26.15.3 > @electron/rebuild@4.2.0 > node-gyp@12.4.0 > tar`

The production-only dependency tree is empty for `tar`; it is absent from the
packed `app.asar` and unpacked application resources. This reachability
classification does not waive the audit requirement.

The remediation changes only the deduplicated `tar` lockfile entry. An offline
Node test inspects every resolved `tar` lockfile package, rejects affected
versions, and requires an introducing parent path.

## Audit

- Before: 1 moderate vulnerability (`tar`)
- After: 0 vulnerabilities
- Real power actions: 0

Raw audit JSON is intentionally not retained because it is environment output,
not review evidence.

## Electron provisioning

Electron 42+ intentionally separates package installation from native binary
provisioning. `npm ci` installs the locked JavaScript package; it does not
create `node_modules/electron/dist/electron.exe`. The official local
`install-electron` command downloads the locked binary on demand.

Fresh runtime setup is therefore:

```powershell
npm ci
npm run electron:provision
npm run electron:verify
```

The project does not add a `postinstall` hook, fabricate `hasInstallScript`
metadata, invoke `node_modules/electron/install.js` directly, or change the
locked Electron version. The offline provisioning-contract test verifies the
locked Electron package exposes `install-electron`, the project script invokes
that supported command, no project postinstall provisions Electron, and the
verifier executes the provisioned binary and matches its version to the lockfile.

Three fresh two-stage setup runs passed with `electron.exe` and `path.txt`
present after provisioning, `electron --version` reporting `v43.1.0`,
`tar@7.5.22`, and zero audit vulnerabilities. The `tar` regression suite now
also proves synthetic `7.5.19` and `7.5.20` resolutions fail, `7.5.21` passes,
all copies are inspected, vulnerable copies among fixed copies fail, and missing
introducing-parent evidence fails.

## Independent gate rerun

A clean provisioned worktree passed unit tests, desktop smoke (`261/0`), and
`npm audit`. Five consecutive native desktop UX gate runs passed with six
phases and 25 screenshots each. The complete source gate then passed against
the existing non-rebuilt package baseline: lint, syntax checks, unit tests,
smokes, C2 proof, receipt recovery (`11/0 + 2/0`), packaged truth, packaged
network, and audit. All scenarios reported zero real power actions.

The existing package baseline remains stale because this branch changes
`package.json`; no package was rebuilt, installed, signed, hashed, tagged,
released, or published.

## Desktop UX functional gate

The initial final-main gate failure was nondeterministic harness input evidence,
not a product failure. The CDP harness used a menu container rectangle that can
include an animated submenu; a press could therefore land on a submenu item or
observe an unfinished transition.

The harness now:

- requires a visible, hit-testable, stable selector rectangle;
- moves the CDP pointer and revalidates the target before pressing;
- targets only direct top-menu trigger labels;
- verifies focus, `aria-expanded`, selected menu item, resulting view, menu
  start invocations, and real power actions for Advanced Options Enter;
- records a unique CDP port, user-data path, renderer generation, and renderer
  console/exception diagnostics per session.

Five consecutive clean source-Electron runs passed. The redacted reports,
manifests, checksums, and one representative 25-screenshot set are in
`desktop-ux-final-gate/`. Chromium profiles, settings, caches, and failed-run
residue were not retained. All temporary `lightsout-desktop-ux-gate-*`
directories were removed after curation.
