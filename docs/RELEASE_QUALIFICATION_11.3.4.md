# v11.3.4 release qualification

v11.3.4 is a presentation release on v11.3.3. It does not claim publication:
CI publishes the `v11.3.4` GitHub release only after its own gates pass.

## Scope

- `electron/assets/brand/app-icon/*.svg` and the generated `assets/icon.ico`,
  `icon-256.png`, `icon-512.png` (`npm run icons`): the broken-O app icon.
- `electron/styles.css`: larger header wordmark and beam origin on windows
  720px tall or more, the night-blue background, and the narrow-window end
  time kept on one line.
- `electron/test/app-icon.test.js`: small frames are checked for the lit O
  with a dark centre (replacing the lamp-shade check).

No change to timer state, power actions, lights, networking or settings.

## Gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors.
- Unit tests: 1,775 passed, 0 failed (`npm test`), including the icon frame
  checks against the regenerated `icon.ico`.
- Smoke: 363 passed, 0 failed (`npm run smoke`).
- Tonight checked in the static browser preview at 900x640, 1100x760 and
  1400x900, idle and running. Layout evidence, not the Electron runtime.

## Gates run by CI on the tag

Lint & Smoke and Android on Linux, the native Windows package with its
packaged-truth checks, and the publish job's asset-hash and source-pin checks.

## Not covered

How the new icon looks on a physical taskbar at every DPI, signing and
Android release.
