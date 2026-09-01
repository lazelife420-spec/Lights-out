# RC4 Reality Gate — Custody Record

**Status:** `RC4 REALITY GATE — GREEN (20/20, cryptographically verified)`
**Date:** 2026-09-01 (America/Vancouver)
**Candidate:** Lights Out v11.1.3 RC4 (post-RC3 mini-mode-exit + Android 11.1.3 tranche)

## Identity binding

```text
BRANCH:        codex/lights-out-running-nav-rail
COMMIT:        f9048c381dd285c2fcae592a55267dd5ea513938
TREE:          ea92ac98025ccd9852b92f0ecfcc422cec2368ce
```

The committed tree equals the previously validated post-RC3 BUILD SOURCE TREE
`ea92ac98…`, so the already-verified Android APK binds to this commit without a
rebuild.

## Run

```text
RUN ID:              6b67a712-33ba-4cd6-9c4a-81e66f056750
PIPELINE:            .forge-ci.json "default" (20 steps)
PIPELINE SHA-256:    5b7b91fe9ddc52db7f98bbf3f7a5c5c3601bc236e844513bd23f5ea177f36665
EXECUTION PLAN:      c32a8a2075512ad783390d9e7dd2ea71bd0faad49bc5044190cb6cae9c54b737
DURATION:            361,845 ms
STEPS:               20 passed / 20 total / 0 failed / 0 skipped
SOURCE MUTATION:     false
RECEIPT:             signed (ECDSA P-256), keypair under %USERPROFILE%\.ssh
CRYPTO VERIFY:       /api/ci/verify → verified=true, trust=GREEN
RECEIPT FILE SHA-256:  54FCAB92690BC211758E5CCD3E810D55DDC597D1A4AC1E5ED610C24B3DCDDF44
PROOF FILE SHA-256:    F5AD37E789F9C54BF1E4CD1A5CCEF121253B8540E3D562091A6B6D86CE5441EF
RUNNER:             Reality Gate Runroom (OfflineForge v1.1.0 line), worktree
                    C:\Users\KickA\Projects\Active\OfflineForge_Sovereign_V2\.claude\worktrees\lights-out-runroom-gate
```

## Artifacts validated inside the run

- Windows RC4 portable bytes (declared `dist-native` input, mirrored from the
  fresh RC4 build): ZIP SHA-256 `C7872350101906471E83D8C0649E1E65C5F9BAA4591E0C02CCFD8780215726D6`;
  launcher `DC4FFA82A254820E4946A1056A8B894AEA3C39B171C39E79D4A34747A010545A`
  (byte-identical to RC3's launcher: all tranche changes live in
  `resources\app` payload, not the stamped Electron binary — FileVersion
  11.1.3.0 / ProductVersion 11.1.3 unchanged).
- Packaged smoke and truth, native packaged truth, packaged network,
  packaged phone simulation (Samsung Galaxy S23 ADB/manual-URL lane; camera
  scan not claimed), Companion V2 runtime, Night Modes runtime, receipt
  recovery, reliability, performance, geometry — all passed.
- Real power actions: 0. Provider mutations: 0. GitHub/network provider
  operations by the gate: 0.

## Failed first attempt (honest record)

```text
RUN ID: a9203e13-7661-47f0-aad5-36bbf210ea1b
RESULT: FAILED at "Offline dependency restore" — spawn EINVAL
CAUSE:  Node 22 refuses shell-less spawns of .cmd shims; the runner resolved
        npm to npm.cmd. Restarted the runner with its documented shell-free
        toolchain overrides (REALITY_GATE_NODE + REALITY_GATE_NPM_CLI);
        no runner or product source was modified.
```

The failed run's receipt remains preserved in the runner's data root.

## Files in this directory

| File | Purpose |
|---|---|
| `run-receipt.json` | signed 20/20 run receipt (copy) |
| `proof-receipt.json` | signed proof receipt binding the run receipt |
| `run-logs.txt` | full run console log |
| `SHA256SUMS.txt` | hashes of the three artifacts above |

## Boundary

RC3 remains frozen and untouched. This record proves the RC4 candidate only.
It does not release anything and does not create a tag.
