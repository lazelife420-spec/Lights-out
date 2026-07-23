# v11.1.2 provenance review

## Commit boundaries

- Base: `4c3aecf0dc1b1904b7f47fceb613baf8edd8b20a`
- Consolidation source: `28c00605c9f9fe5f12670b6de0abaf4bc71b9342`
- Initial artifact proof: `b7553d69b36d1c1cb07f5964308ee6e0eb1ef329`
- Tray lifecycle fix and current artifact source:
  `8c5ec88c097df9ff5e28c509906aa1079b07c203`

## Provenance decision

The `28c0060..b7553d6` range added proof reports, screenshots, manifests, and
checksums, plus a change to `electron/scripts/native-walkthrough.js`. That
walkthrough script is not present in `electron/package.json` `build.files`, so
it is not a packaged application input.

The later `b7553d6..8c5ec88` range changed `electron/main.js`, which is an
explicit packaged application input. Therefore the earlier artifact hashes were
superseded. The branch-candidate binaries and retained packaged proof were
rebuilt and regenerated from `8c5ec88`.

The proof refresh commit after `8c5ec88` contains committed proof material only;
it does not change application source, package files, lockfiles, build or
installer configuration, version metadata, embedded assets, or generated
application resources.

## Review commands

```powershell
git diff --name-status `
  28c00605c9f9fe5f12670b6de0abaf4bc71b9342..`
  b7553d69b36d1c1cb07f5964308ee6e0eb1ef329

git diff --name-status `
  b7553d69b36d1c1cb07f5964308ee6e0eb1ef329..`
  8c5ec88c097df9ff5e28c509906aa1079b07c203

git diff --name-status `
  4c3aecf0dc1b1904b7f47fceb613baf8edd8b20a..HEAD

git log --format="%H %s" `
  4c3aecf0dc1b1904b7f47fceb613baf8edd8b20a..HEAD

git rev-parse HEAD
git rev-parse origin/ux/v11.1.2-desktop-consolidation
git status --porcelain=v1
```

## Publication boundary

These are branch-candidate artifacts. Independent PR review, merge, rebuild
from the final merge SHA (unless reviewed-source-commit provenance is explicitly
accepted), and explicit acceptance of unsigned Windows distribution remain
separate release-lane decisions.
