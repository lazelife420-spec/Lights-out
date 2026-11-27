# v11.3.2 release qualification

v11.3.2 is a presentation release on v11.3.1. It does not claim publication:
CI publishes the `v11.3.2` GitHub release only after its own gates pass.

## Scope

- `electron/styles.css`: Tonight, Schedule, Devices, Night Modes and Proof
  layout and typography.
- `electron/index.html`: Schedule section order (rules and One night only
  before the month planner; import/export last) and the Quick start hint.
- `electron/renderer.js`: the idle "Ready · not started" readout gains an
  `is-ready` class so it is spoken but not drawn; its text is unchanged.

No change to timer state, power actions, lights, networking or settings.

## Gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors.
- Unit tests: 1,770 passed, 0 failed (`npm test`).
- Smoke: 363 passed, 0 failed (`npm run smoke`).
- Each changed screen checked in the static browser preview at 900x640 and
  1100x760 (Tonight also at 1400x900, idle and running, both clock faces).
  The preview is layout evidence, not the Electron runtime.

## Gates run by CI on the tag

Lint & Smoke and Android on Linux, the native Windows package with its
packaged-truth checks, and the publish job's asset-hash and source-pin checks.

## Not covered

The interactive desktop gate, signing and Android release.
