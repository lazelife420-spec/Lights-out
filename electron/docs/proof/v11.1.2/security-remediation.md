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
