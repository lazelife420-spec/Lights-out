# v11.1.2 provenance review

## Commit boundaries

- Base: `4c3aecf0dc1b1904b7f47fceb613baf8edd8b20a`
- Consolidation source: `28c00605c9f9fe5f12670b6de0abaf4bc71b9342`
- Initial artifact proof: `b7553d69b36d1c1cb07f5964308ee6e0eb1ef329`
- Tray lifecycle fix and current artifact source:
  `8c5ec88c097df9ff5e28c509906aa1079b07c203`
- Initial reconciled proof: `d5b76a03ddf625fdc3e1bb620e760625c89da383`
- Standalone packaged-truth readiness fix:
  `1286bb9019aac63e27d2c94b7a3f01ed0b364818`
- Portable smoke isolation fix and twice-gated proof HEAD:
  `2b530d2d02a39230fe3930fc58da7725e5e9461e`
- Packaged-proof failure-safety lifecycle and redaction fix:
  `fb19d77783e67c15e5dac4195af1e478428bae27`
- Time-bounded descendant ownership fix and final twice-gated code HEAD:
  `8d9a279555232c7326ce6ef82f1443f68bf367fa`

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

The later `d5b76a0..2b530d2` range changes only packaged proof scripts and their
focused Node test. None of those files is present in `electron/package.json`
`build.files`, so this range is also non-build-bearing. The standalone failure
was a proof-runner lifecycle race: it used a synthetic DOM click before waiting
for the existing renderer-owned readiness contract. The corrected runner
verifies unique CDP/process/profile ownership, a stable current-document
generation, renderer and menu readiness, native CDP mouse/keyboard interaction,
accessible and visible menu state, pointer transfer, Escape focus restoration,
and bounded diagnostics. A second portable-smoke race found during the first
full-gate attempt was corrected by using an isolated Off-mode profile and
bounded stable process cleanup.

At `2b530d2`, standalone packaged truth passed three consecutive clean runs.
The exact remote-head gate then passed twice: lint and four syntax checks;
unit 281/0; smoke 261/0; companion smoke 15/0; packaged smoke 12/0; desktop UX
functional gate; companion C2 88/0; receipt recovery 11/0 plus 2/0; standalone
packaged truth; packaged network; and audit 0. Every runtime proof reported
real power actions 0, and final process, listener, firewall, and temporary
profile cleanup was confirmed.

An independent proof-harness review then identified three valid defects:
resource acquisition began before the guarded lifecycle, failure screenshots
were not redacted, and the cleanup test asserted only callback execution. The
`fb19d77` correction puts every nullable proof-owned resource under one outer
guard; preserves the original error while attaching secondary cleanup
diagnostics; performs idempotent, non-short-circuiting cleanup; verifies bounded
release of exact PIDs, ports, firewall rule names, profile, and diagnostic
staging; and captures failure screenshots only after opaque QR and credential
redaction is confirmed. Real disposable profile, listener, child-process,
combined, cleanup-error, firewall-adapter, and redaction/restoration tests
replace the callback-only assertion.

Controlled failures passed at `after-profile-created`,
`after-blocker-created`, `after-process-launched`, `after-cdp-connected`,
`after-firewall-rule-created`, and `during-proof`. Each preserved its expected
primary error, cleaned owned resources, returned process/listener/firewall/temp
state to baseline, and produced zero seeded-fake-secret matches. A failure in
the first attempted two-gate run exposed a Windows stale parent-PID collision:
an old unrelated process retained a parent PID later reused by a proof child.
`8d9a279` constrains descendant ownership to processes created during the proof
run and adds a regression test for that condition.

At `8d9a279`, standalone packaged truth passed three consecutive clean runs.
The complete exact-remote-head gate then passed twice: lint and four syntax
checks; unit 289/0; smoke 261/0; companion smoke 15/0; packaged smoke 12/0;
desktop UX functional gate; companion C2 88/0; receipt recovery 11/0 plus 2/0;
standalone packaged truth; packaged network; and audit 0. Every runtime proof
reported real power actions 0. Final process, listener, firewall, profile, and
diagnostic-staging cleanup was confirmed.

Because `8c5ec88..8d9a279` adds no packaged input, the portable and installer
candidate hashes in `artifact-metadata.md` remain valid.

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
