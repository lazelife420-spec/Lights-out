# v11.3.3 release qualification

v11.3.3 is a patch on v11.3.2. It does not claim publication: CI publishes the
`v11.3.3` GitHub release only after its own gates pass.

## Scope

- `electron/main.js`, `electron/preload.js`, `electron/renderer-utils.js`: the
  Automatic time format reads the Windows regional format from
  `app.getSystemLocale()` (validated BCP 47), passed to the renderer.
- `electron/renderer.js`: Settings is inert while a Back/Cancel reload is still
  in flight.
- `electron/styles.css`: ritual dialog spacing and Cancel button.
- QA harness only: the desktop gate walks a standard ritual before expecting a
  run; the native input worker escapes raw control characters in its JSON.

These close the two remaining v11.3.0 engineering-audit follow-ups.

## Gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors.
- Unit tests: 1,775 passed, 0 failed (`npm test`).
- Smoke: 363 passed, 0 failed (`npm run smoke`).
- Full end-to-end (`npm run test:e2e` lanes on the native build, QA power
  lock on): desktop-ux-functional-gate PASS, packaged-truth-smoke PASS,
  night-modes-electron-proof PASS (8/8); real power actions 0. The owner's
  real profile files were unchanged (timestamps compared before and after).
  Run on 2026-11-27 against the v11.3.2 source plus these fixes.

## Gates run by CI on the tag

Lint & Smoke and Android on Linux, the native Windows package with its
packaged-truth checks, and the publish job's asset-hash and source-pin checks.

## Not covered

Signing, Android release, and physical power or light behaviour.
