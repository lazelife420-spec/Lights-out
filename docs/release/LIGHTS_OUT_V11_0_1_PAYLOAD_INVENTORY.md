# Lights Out v11.0.1 Release Payload Inventory

Range audited: `v11.0.0..PR_HEAD`. The Windows installer packages `electron/`;
it does not package `companion-android/`, repository documentation, or CI files.

| Payload group | PR / commits | Affected artifact | Automated evidence | Manual evidence | In Windows installer | Separate Android proof |
|---|---|---|---|---|---|---|
| Window lifecycle and responsive desktop UI | PR #26: `822fa01` plus Mini Mode patch `0a091e7` | Windows EXE and installer | lint, syntax, unit, smoke, isolated real-BrowserWindow geometry test, packaged smoke | live move/resize/relaunch proof; Sandbox safe-launch lifecycle | Yes | No |
| Family Profiles identity and proof | PR #24 (`3ab18cd`, `de13fa6`, merge `e5b050e`) | Windows EXE and installer; local receipts/settings | PR gate: 114 unit tests, 181 smoke checks, build; repeated by final v11.0.1 gates | No separate manual claim required; selection remains inert | Yes | No |
| Display-only profile accents | PR #25 (`1240a7a`, merge `b96c02b`) | Windows EXE and installer | PR gate: 123 unit tests, 187 smoke checks, build; repeated by final v11.0.1 gates | Visual behavior is scoped to profile elements | Yes | No |
| Settings persistence and header/pairing polish | PRs #21–#23 (`3dfcf26`/`b285d6c`, `905af3f`/`09d16d8`, `9d6a0b7`/`f86f98b`) | Windows EXE/installer and desktop-served companion PWA | PR gates: lint, syntax, 113 unit tests, 175–178 smoke checks; repeated by final gates | No separate production-artifact claim | Yes | No native Android source in these PRs |
| Companion host and recovery | `8d1e353`, `522adf7`, `85953c7`, `3675674`, `5442ad1` | Electron host and `companion.html` PWA in Windows installer | companion unit/integration coverage and final unit/smoke gates | physical-phone connected/expired/offline/recovery checks recorded in the changelog history | Electron/PWA portions: Yes | Native portions require the Android lane below |
| System-volume fix | `379b131` | Windows EXE and installer | media unit coverage for 0%, 50%, 100%, invalid, and out-of-range input; final gates | No separate manual proof recorded | Yes | No |
| Android companion recovery source | `e8dd021`, plus Android files in `85953c7` and `5442ad1` | Android APK only | Kotlin normalization tests and debug assembly were recorded when implemented | a release-signed physical-phone update/recovery check was recorded, but no final v11.0.1 APK receipt/hash is retained here | No | **Yes.** Build, signing identity, installed APK, runtime result, and hash must be proved separately |
| CI and package validation | PR #26: `83eaac0`, `.github/workflows/ci.yml`, packaged/runtime geometry scripts | CI configuration; Windows package inputs include `profileIdentity.js` and `windowGeometry.js` | local package-list guard, Windows geometry test, build and packaged smoke | GitHub Actions has not run because the account is disabled for Actions | Runtime modules: Yes; CI/scripts: No | No |
| Documentation and proof | `dd56396`, `f80a8a6`, PR #26 `490340a`, `c224bfc`, and subsequent proof updates | Repository documentation only | range/diff/hash review | Windows Sandbox receipt and artifact hashes recorded in the proof pack | No | Does not certify Android |

## Evidence boundary

The Windows Sandbox lifecycle proves installation, safe minimized/idle launch,
upgrade, settings preservation, safe post-upgrade launch, uninstall, and cleanup
for the Windows artifacts. It does not exercise every feature above and does not
install or certify an Android APK.

Local project evidence covers the source-level/unit/smoke behavior for the full
desktop payload, including Family Profiles, profile accents, window behavior,
settings, media, and covered companion-host paths. GitHub Actions execution and
trusted Authenticode signing remain external gates.
