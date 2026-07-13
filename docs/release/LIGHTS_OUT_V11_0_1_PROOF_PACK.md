# Lights Out v11.0.1 Production Proof Pack

Date: 2026-07-13  
Branch: `codex/v11.0.1-production-readiness`  
Pull request: [#26](https://github.com/lazelife420-spec/Lights-out/pull/26)  
Verified commit: `822fa011223864805dd812a323f60874bb235878`

## Scope

This proof pack covers the v11.0.1 desktop-control fix and the local release
gates available while GitHub Actions is disabled at the account level.

The release restores practical movement and resizing for the frameless desktop
window, adds maximize/restore, persists usable window geometry across restarts,
preserves normal bounds across Mini Mode, and clamps restored coordinates onto
an available display.

## Automated Verification

All commands completed successfully on Windows 10:

- `npm run lint`
- syntax checks for `main.js`, `renderer.js`, `preload.js`, and `settings.js`
- `npm test`: 123 tests passed, 0 failed
- `npm run smoke`: 190 checks passed, 0 failed
- `npm audit --audit-level=low`: 0 vulnerabilities
- `npm run build`: portable and NSIS artifacts produced
- `npm run smoke:packaged`: 11 checks passed, 0 failed

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

## Artifact Receipt

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `LightsOut.exe` | 96,352,319 | `9e57d55bbae4c3edbb31d35161eea8ddaf750038f7f775dea1e8cae4cf919844` |
| `Lights Out Setup 11.0.1.exe` | 96,612,961 | `1ad4404ebf72c5ca9276e6be55eb2ac1322a303a753fa305bbfcf65f8519d48e` |

The matching local checksum file is `dist/SHA256SUMS.txt`. The `dist` directory
is build output and remains intentionally untracked.

## Open Production Gates

- **GitHub Actions:** repository permissions and billing are healthy, but the
  account-level HTTP 422 restriction prevents workflow execution. Local results
  are evidence, not a substitute for a green GitHub check.
- **Authenticode:** both artifacts are unsigned. The only certificate available
  locally is a self-signed development certificate and was intentionally not
  presented as production signing.
- **Release:** PR #26 remains a draft. No merge, v11.0.1 tag, or public GitHub
  release has been created while the two gates above remain open.
