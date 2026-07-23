# v11.1.2 Desktop Consolidation Closure Proof

This directory contains reviewable proof for the desktop-only v11.1.2 closure
lane. The Android companion remains at v11.1.1 and its signing material was not
touched.

## Curated evidence

- [`source-gate.md`](source-gate.md) records the two complete pre-commit
  source-gate passes.
- [`desktop-ux-functional/report.json`](desktop-ux-functional/report.json) is
  the second-pass source Electron report.
- [`desktop-ux-functional/screenshot-manifest.json`](desktop-ux-functional/screenshot-manifest.json)
  and [`desktop-ux-functional/SHA256SUMS.txt`](desktop-ux-functional/SHA256SUMS.txt)
  describe the 25 retained screenshots.
- [`desktop-ux-functional/screenshots/`](desktop-ux-functional/screenshots/)
  contains the native-rendered evidence for
  startup, menus, shared start, Use Tonight, Settings, and active-run states.
- [`packaged-desktop-ux-functional/`](packaged-desktop-ux-functional/) contains
  the same enforced gate rerun against the branch-candidate unpacked executable
  built from commit `8c5ec88`.
- [`native-walkthrough/`](native-walkthrough/) contains the rebuilt three-size
  Settings walkthrough and its checksum manifest.
- [`artifact-metadata.md`](artifact-metadata.md) records candidate filenames,
  versions, byte sizes,
  timestamps, hashes, Authenticode truth, installer validation, and post-build
  gate results.
- [`provenance-review.md`](provenance-review.md) records the commit boundaries,
  standalone packaged-truth closure, two exact remote-head gate passes,
  build-input decision, exact review commands, and publication boundary.

Runtime profiles, Chromium caches, raw settings/receipt state, and disposable
root logs are deliberately excluded. The committed rebuild and packaged proof
are recorded separately after the source commit so the definitive executables
can be tied to a named commit.
