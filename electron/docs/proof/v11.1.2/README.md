# v11.1.2 Desktop Consolidation Closure Proof

This directory contains reviewable proof for the desktop-only v11.1.2 closure
lane. The Android companion remains at v11.1.1 and its signing material was not
touched.

## Curated evidence

- `source-gate.md` records the two complete pre-commit source-gate passes.
- `desktop-ux-functional/report.json` is the second-pass source Electron report.
- `desktop-ux-functional/screenshot-manifest.json` and
  `desktop-ux-functional/SHA256SUMS.txt` describe the 25 retained screenshots.
- `desktop-ux-functional/screenshots/` contains the native-rendered evidence for
  startup, menus, shared start, Use Tonight, Settings, and active-run states.

Runtime profiles, Chromium caches, raw settings/receipt state, and disposable
root logs are deliberately excluded. The committed rebuild and packaged proof
are recorded separately after the source commit so the definitive executables
can be tied to a named commit.
