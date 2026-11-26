# v11.3.0 release qualification

v11.3.0 is a production-audit release. This record states what was checked,
how, and what remains outside automated qualification. It does not claim the
release is published: that happens only when CI publishes the `v11.3.0` GitHub
release after its own gates pass.

## How the audit was run

1. Eight independent review areas over the uncommitted release candidate:
   power actions and safe defaults; network trust boundaries; renderer, preload
   and IPC; Android; packaging, installer and CI; desktop feature logic;
   credentials and persistence; user-facing documentation.
2. Every finding was handed to one or two skeptics instructed to refute it from
   the code (a code-trace lens and a shipped-configuration lens). Findings that
   survived were fixed with a regression test that fails without the fix.
3. Each area's fixes were reviewed again by a fresh reviewer, and that review's
   findings were fixed in a second (and, where needed, third) round until each
   area was marked ship-ready.

## Automated gates run locally (Windows 10, Node 22.23.1)

- ESLint: 0 errors, 0 warnings.
- `node --check` on every `electron/*.js` and `electron/scripts/*.js` file.
- Unit tests: 1,581 passed, 0 failed (`npm test`).
- Smoke checks: 359 passed, 0 failed (`npm run smoke`).
- The unit suite also passed on a CRLF checkout of the tree, matching the Windows
  CI runner's `core.autocrlf=true` (two asset-copy differences aside).
- `npm audit`: 0 vulnerabilities.
- Android (isolated per AGENTS.md: source copied to a temporary project, isolated
  Android/Gradle homes, no signing material): 138 JUnit tests passed, lint passed,
  debug APK built. No emulator or physical device was used.

## Packaged Windows qualification

Recorded after the local build from the release commit; CI repeats the
unattended packaged lane, installer and portable verification, and clean
provenance on the tagged commit before it publishes anything.

## Not established by automated tests

- Physical sleep, hibernate, shutdown and resume. Every receipt states the
  Windows outcome as unverified; the native Sleep/Hibernate helper is exercised
  only through fakes and intercepted requests.
- Real router and Wi-Fi adapter behaviour, including the new Wi-Fi Guard
  recovery record (unit-tested only). Wi-Fi Guard stays opt-in and experimental.
- Real WiZ and Hue lights, phones, OEM battery management and overnight
  unattended runs.
- Android on a real phone: First Light wake under Doze, reboot before first
  unlock, edge-to-edge layout on API 35/36 devices, and 16 KB page-size
  compliance. No production-signed APK ships with this release.
- The interactive Windows desktop gate (`npm run test:e2e:desktop`) needs an
  unlocked, hands-off desktop session and is run by the owner.

## Known limits carried into this release

- Moving back to v11.2.0 cannot decrypt the newly protected integration
  credentials; re-enter them there.
- The suspend helper is compiled at build time without a deterministic
  compiler, so two builds of the same commit have different installer and ZIP
  hashes. Each build's own BUILD-MANIFEST.json and SHA256SUMS.txt are exact; the
  Proof Foundry kit must be built from the published release's files.
- Secure device pairing (handoff) ships in source and is gated off.
- The live Proof Foundry release record links GitHub Releases; installed v11.3
  apps download in-app updates only from `downloads.theprooffoundry.com`. See
  `electron/scripts/build-proof-foundry-kit.js` and the kit's `UPLOAD.md`.
