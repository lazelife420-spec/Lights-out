# v11.3.1 release qualification

v11.3.1 is a patch on v11.3.0 (source commits after tag `v11.3.0`). This record
states what was checked. It does not claim the release is published: that
happens only when CI publishes the `v11.3.1` GitHub release after its own gates.

## Scope

- `electron/main.js`: quitting aborts an in-progress completion before the
  light-off and the power request; blocked completions restore a dimmed room;
  a new run over an earlier run's dim restores that room first; the renderer
  cannot set the Hue certificate pin.
- `electron/styles.css`: Tonight dial and running column presentation only.

The fixes came from an independent engineering audit of v11.3.0 that found no
hotfix-grade defect. Two low findings remain follow-ups: the Automatic clock
format follows the app language rather than the Windows region format, and a
Settings reload can race edits made within milliseconds of reopening.

## Gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors.
- Unit tests: 1,770 passed, 0 failed (`npm test`), including a new guard that a
  quit during completion dispatches no power request.
- Smoke: 363 passed, 0 failed (`npm run smoke`).
- Tonight screen checked in the static browser preview at 1100x760 and
  900x640, idle and running (layout only, not the Electron runtime).

## Gates run by CI on the tag

Lint & Smoke and Android on Linux, the native Windows package with its
packaged-truth checks, and the publish job's asset-hash and source-pin checks.
See the workflow run for tag `v11.3.1`.

## Not covered

Physical light behaviour of the new restore paths (unit-tested only), the
interactive desktop gate, signing and Android release.
