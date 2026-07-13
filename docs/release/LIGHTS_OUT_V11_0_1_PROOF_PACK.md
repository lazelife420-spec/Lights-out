# Lights Out v11.0.1 Windows Production Proof Pack

- Date: 2026-07-13
- Branch: `codex/v11.0.1-production-readiness`
- Pull request: [#26](https://github.com/lazelife420-spec/Lights-out/pull/26)
- Current PR review baseline: `c224bfc4885bb1ec9c16bfbe137989ceb43ae16f`

## Scope

This proof pack covers the complete Windows desktop payload between `v11.0.0`
and PR #26, plus the local release gates available while GitHub Actions is
disabled at the account level. The detailed payload and evidence mapping is in
[`LIGHTS_OUT_V11_0_1_PAYLOAD_INVENTORY.md`](LIGHTS_OUT_V11_0_1_PAYLOAD_INVENTORY.md).

The release restores practical movement and resizing for the frameless desktop
window, adds maximize/restore, persists usable window geometry across restarts,
preserves normal bounds across Mini Mode, and clamps restored coordinates onto
an available display. It also includes already-merged Family Profiles identity,
profile accents, settings/header/pairing polish, companion-host recovery, and
the system-volume fix.

Native Android source changed in the same repository range. It is not packaged
by the Windows installer and is not certified by this proof pack. A separate
signed APK receipt is required before claiming Android production readiness.

## Evidence Boundaries

### Proven by Windows Sandbox

- clean v11.0.0 installation
- safe minimized/idle launch
- upgrade to v11.0.1
- settings preservation
- safe v11.0.1 launch
- silent uninstall, registry cleanup, and executable cleanup

### Proven by local automated or manual project evidence

- lint, syntax, unit, smoke, package build, and packaged smoke
- Family Profiles identity and receipt compatibility
- display-only profile accents
- desktop window movement, resizing, persistence, and Mini Mode geometry
- settings persistence, media input handling, and covered companion-host paths

### Not proven by the Windows installer lifecycle

- Android APK installation or runtime behavior
- trusted Authenticode signing
- GitHub Actions execution

## Automated Verification

All commands completed successfully on Windows 10:

- `npm run lint`
- syntax checks for `main.js`, `renderer.js`, `preload.js`, and `settings.js`
- `npm test`: 123 tests passed, 0 failed
- `npm run smoke`: 190 checks passed, 0 failed
- `npm audit --audit-level=low`: 0 vulnerabilities
- `npm run build`: portable and NSIS artifacts produced
- `npm run smoke:packaged`: 11 checks passed, 0 failed

These counts and the artifact hashes below describe the historical pre-patch
candidate. The Mini Mode runtime patch requires a new complete validation run,
new output directory, and new hashes before this proof becomes final.

The Windows CI workflow now includes `npm run smoke:packaged` after packaging
and before artifact upload. GitHub has not executed that workflow because its
API returns HTTP 422: `Actions has been disabled for this user`.

## Live Desktop Window Proof

The packaged application was launched safely with `--no-auto-start`, moved and
resized through the Windows API, terminated, and relaunched. Its geometry was
restored after restart at 703 x 722 pixels, position 180,140.

No timer or power action was started during this proof.

## Disposable Clean-Machine Proof

The installer lifecycle was exercised inside a fresh Windows Sandbox. The host
had no Lights Out installation and was not modified by this test.

The sandbox verified:

1. No pre-existing Lights Out installation was registered.
2. `Lights Out Setup 11.0.0.exe /S` completed successfully.
3. Version 11.0.0 was registered and `Lights Out.exe` existed.
4. The installed 11.0.0 app remained running when launched minimized and idle
   with `--minimized --no-auto-start`.
5. A user-settings sentinel was written before upgrade.
6. `Lights Out Setup 11.0.1.exe /S` completed successfully.
7. Version 11.0.1 was registered and the user-settings sentinel survived.
8. The upgraded 11.0.1 app remained running when launched minimized and idle.
9. `Uninstall Lights Out.exe /S` completed successfully.
10. The uninstall registration and installed executable were removed.

Sandbox result: 6 lifecycle assertions passed, 0 failed.

## Historical Pre-patch Artifact Receipt

Artifact-producing commit: `822fa011223864805dd812a323f60874bb235878`

Electron tree: `1d590f1567bac9c1c0f3db6219764169c49f1854`

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `LightsOut.exe` | 96,352,319 | `9e57d55bbae4c3edbb31d35161eea8ddaf750038f7f775dea1e8cae4cf919844` |
| `Lights Out Setup 11.0.1.exe` | 96,612,961 | `1ad4404ebf72c5ca9276e6be55eb2ac1322a303a753fa305bbfcf65f8519d48e` |

The matching local checksum file is `dist/SHA256SUMS.txt`. The `dist` directory
is build output and remains intentionally untracked.

These candidate artifacts remain valid historical evidence for the earlier
window patch, but they are superseded for final release purposes by the pending
Mini Mode geometry patch. They must not be published as the final v11.0.1
artifacts.

## Final Post-patch Artifact Receipt

Pending the new runtime commit, validation, isolated build, packaged smoke, and
repeat Windows Sandbox lifecycle proof.

## Open Production Gates

- **GitHub Actions:** repository permissions and billing are healthy, but the
  account-level HTTP 422 restriction prevents workflow execution. Local results
  are evidence, not a substitute for a green GitHub check.
- **Authenticode:** both artifacts are unsigned. The only certificate available
  locally is a self-signed development certificate and was intentionally not
  presented as production signing.
- **Android:** native source is present in the release range, but no final
  v11.0.1 signed APK artifact/hash receipt is part of this Windows proof.
- **Release:** PR #26 remains a draft. No merge, v11.0.1 tag, or public GitHub
  release has been created while the gates above remain open.
