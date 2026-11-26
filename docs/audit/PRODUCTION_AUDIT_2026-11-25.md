# Production audit — 2026-11-25 (v11.3.0)

Scope: the uncommitted release candidate on top of `main` (15 commits past the
published v11.2.0), covering the Electron app, Windows packaging and CI, and the
standalone Android source. Result: release candidate `v11.3.0` on branch
`release/v11.3.0`.

## Method

1. Eight review areas, each read by an independent reviewer: power actions and
   safe defaults; network trust boundaries; renderer/preload/IPC; Android;
   packaging/installer/CI; desktop feature logic; credentials and persistence;
   user-facing documentation.
2. Every finding went to one or two skeptics told to refute it from the code
   (code-trace lens; shipped-configuration lens). Refuted findings were dropped;
   upheld findings were often re-rated.
3. Fixes landed with regression tests that fail without them; each area was then
   re-reviewed by a fresh reviewer until it was marked ship-ready.

## Findings fixed

| Area | Finding (verified severity) | Outcome |
| --- | --- | --- |
| Power | Countdown fired seconds after wake when the PC slept through the deadline (high) | Missed after 5 min, re-checked before dispatch |
| Power | Emergency Override waited on partner webhooks before cancelling (high) | Cancels first |
| Power | Tray, Ctrl+Shift+X, phone and family cancel refused during the final steps (medium) | Cancel works until dispatch |
| Power | Global quick-start shortcuts started real timers from inside other apps (medium) | Opt-in |
| Power | Paused media restarted before Sleep/Lock; grace warning missed on skipped ticks; jump list ignored while running; 5 s unsaved-work bound (low) | Fixed |
| Network | Wi-Fi Guard block had no crash/quit recovery (medium) | Durable credential-free record, launch and quit restore |
| Network | Export wrote decrypted secrets; import trusted remote-control and credentials (medium) | Export redacted; import strips credentials and destinations |
| Network | Unbounded startup.log from refused sockets; remote Night Mode lacked an action allowlist (low) | Rotation; allowlist |
| Renderer | Any `file:` navigation allowed — a dropped HTML file got the full app bridge (medium) | Own page only; drops ignored |
| Renderer | Widget lacked navigation guards; proof-mode flag mismatch (low) | Fixed |
| Packaging | QA launches deleted the owner's watchdog task and login item (medium) | QA never touches them; ownership-checked deletes |
| Packaging | Upgrade left orphaned files; provenance missed untracked/edited inputs; unverified preset NSIS root; uninstaller removed the wrong Run value and foreign tasks (low–medium) | Fixed |
| Packaging | Installer QA failed on any stderr line under PowerShell 5.1 (medium) | Stdout captured and streamed; stderr unredirected |
| Features | Legacy single schedule became a nightly 22:30 shutdown on load (medium) | Migrated |
| Features | Calendar fetches could hang; events dropped between polls; TZIDs ignored, then bare abbreviations mis-resolved; hostile TZIDs could stall the main process (low–high) | Settle/deadline, watermark, allowlisted Intl lookups with a budget |
| Credentials | JSON-shaped secrets corrupted on restart; verification key held the Hue key/webhook URL; locked credentials erased by ordinary saves; backup failure blocked the primary save (medium) | Fixed |
| Docs | Test Mode, cancel key, Hibernate, update check, streak and media claims did not match the code (low–high) | Corrected and pinned by tests |
| Android | First Light ramp stalled under CPU sleep and could lose the wake reminder; inexact fallback dropped late reminders (high/medium) | One bounded wake lock, independent reminder alarm, inexact window |
| Android | Edge-to-edge insets and large-screen rotation; failure paths not re-armed; mid-ramp edits (low–medium) | Fixed |

## Product page performance (local measurement)

Measured on `docs/index.html` served from loopback in Chromium (Performance
API; no throttling, so TTFB and CDN caching on theprooffoundry.com are not
covered here).

| Metric | Result | Rating |
| --- | --- | --- |
| First Contentful Paint | 104 ms | Good |
| Largest Contentful Paint | the hero `tonight` image, painted in the first frame | Good |
| Cumulative Layout Shift | 0 (full scroll) | Good |
| Long tasks / blocking JS | none; no scripts, fonts or external CSS | Good |

Fixes applied: the page showed 1600 px screenshots at 260–840 CSS px, so each
screenshot now has 800 px and 1200 px WebP variants chosen by `srcset`/`sizes`
(the LCP image falls from 53 KB to 21 KB; total image weight from about 380 KB
to 186 KB on desktop and 99 KB on a phone). The three hidden hero frames load
at low priority so they never compete with the LCP image, and the dim text
colour now meets WCAG AA (4.5:1) on every page surface (it measured 4.37:1).
`build-proof-foundry-kit.js` copies every `srcset` candidate and fails if the
page references a file it did not copy.

After upload, check that `/lights-out/assets/` is served with a long
`Cache-Control` and an `ETag` (the file names are not content-hashed).

## Deferred, with reasons

- **Deterministic installer hashes**: the suspend helper is compiled with the
  Framework `csc` (no `/deterministic`). Needs a pinned Roslyn toolchain or a
  committed, hash-pinned helper binary — an owner toolchain decision.
- **Downgrade to v11.2.0** cannot decrypt newly protected credentials. Fixing it
  needs a sidecar-vault migration design — an owner decision on the rollback gate.
- **Owner-only desktop portable builder** (`package-desktop-portable.ps1`) is not
  part of the release pipeline; stamping and manifest work is recorded for later.
- **Android device-only items**: directBootAware reboot handling, reminder
  re-arm edge cases after access changes, and real-device Doze/OEM behaviour.

## Decisions for the owner

1. Push `release/v11.3.0`, merge to `main`, and push the `v11.3.0` tag — CI then
   builds, verifies and publishes the GitHub release.
2. Run the interactive desktop gate (`npm run test:e2e:desktop`) on an unlocked,
   hands-off desktop before or after tagging.
3. Upload the Proof Foundry kit built from the published release
   (`node scripts/build-proof-foundry-kit.js --release-dir <published files>`),
   and decide whether release binaries move to `downloads.theprooffoundry.com`
   so installed apps can download in-app updates directly.
4. Wi-Fi Guard recovery is unit-tested only; keep it opt-in and experimental, or
   switch blocking off (`blockingAllowed: false` in `main.js`) until it has been
   qualified on real hardware.
