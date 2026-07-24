# Branch-candidate desktop artifact metadata

Source commit:
`8c5ec88c097df9ff5e28c509906aa1079b07c203`

Build command: `cd electron && npm run build`

Build date: 2026-07-23 (America/Los_Angeles)

| Artifact | Bytes | File version | Product version | Built (UTC-07:00) | SHA-256 | Authenticode |
|---|---:|---|---|---|---|---|
| `dist/win-unpacked/Lights Out.exe` | 225,784,832 | 11.1.2 | 11.1.2.0 | 2026-07-23 01:19:08.6048806 | `9A1349D6EA755230130745418D693109AB4C38E9497B0F985A4DF305077EEF11` | NotSigned |
| `dist/LightsOut.exe` | 96,223,434 | 11.1.2 | 11.1.2 | 2026-07-23 01:20:49.2683006 | `2D34AC2E0DA7346B6D337914CA91F5A8D10FE03BA5F53822652641C8B9F2FC9B` | NotSigned |
| `dist/Lights Out Setup 11.1.2.exe` | 96,484,047 | 11.1.2 | 11.1.2 | 2026-07-23 01:20:51.1828736 | `0F3D5EEC224DC0DEDF8F5049B71F2A3AEF2F38CD29ACC015DE9C3CD41778617B` | NotSigned |

## Packaged and native proof

- Portable launch: passed.
- Packaged smoke/truth: passed; real power actions 0.
- Packaged network: passed; listener and firewall cleanup confirmed; physical
  adapters unchanged; real power actions 0.
- Desktop UX functional gate: passed against the unpacked executable, all six
  phases, 25 screenshots, no uncaught renderer exceptions, real power actions
  0.
- Focused Settings runtime proof: passed clean and legacy startup, all category
  navigation and lifecycle checks, ten reopen cycles, and 1280×720,
  1920×1080, and ultrawide layouts.
- Native rebuilt walkthrough: passed at 1280×720, 1920×1080, and 2560×1080.
- Companion V2 Electron proof: 88 passed, 0 failed, real power actions 0.
- Receipt recovery Electron proof: passed, real power actions 0.
- Standalone packaged truth: three consecutive clean passes at proof-only HEAD
  `2b530d2`, including Power pointer transfer, Escape/focus restoration,
  Settings and Help menus, zero console/page errors, and real power actions 0.
- Exact remote-head gate: passed twice at `2b530d2`; unit 281/0, smoke 261/0,
  companion smoke 15/0, packaged smoke 12/0, companion C2 88/0, receipt
  recovery 11/0 plus 2/0, packaged truth/network PASS, and audit 0.
- Packaged-proof failure-safety closure: passed at `8d9a279`. Deterministic
  partial-initialization failures covered all six stages; real profile,
  listener, child, combined, cleanup-error, firewall-dispatch, redaction, and
  stale parent-PID collision tests passed; seeded-fake-secret scans found zero
  matches.
- Final standalone packaged truth: three consecutive clean passes at
  `8d9a279`, with console/page errors 0, real power actions 0, and owned
  process, listener, firewall, profile, and diagnostic-staging cleanup
  confirmed after every run.
- Final exact remote-head gate: passed twice at `8d9a279`; unit 289/0, smoke
  261/0, companion smoke 15/0, packaged smoke 12/0, desktop UX gate PASS,
  companion C2 88/0, receipt recovery 11/0 plus 2/0, packaged truth/network
  PASS, audit 0, and real power actions 0.

## Installer validation

With no pre-existing registered installation:

1. Silent fresh per-user install exited 0 and registered `Lights Out 11.1.2`.
2. Running the same installer again as an in-place upgrade exited 0.
3. The installed executable reported file version 11.1.2 and product version
   11.1.2.0. Its SHA-256 matched the definitive unpacked executable before and
   after upgrade.
4. Silent uninstall exited 0; the install directory and uninstall registry
   entry were both removed.

Windows Authenticode is truthfully `NotSigned` for the portable, installer, and
unpacked executable. No signing claim is made.

These hashes are branch-candidate hashes. Merge and publication remain separate
lanes; release artifacts should be rebuilt from the reviewed merge SHA unless
reviewed-source-commit provenance is explicitly accepted.

The proof-only commits through `8d9a279` change scripts, tests, and proof
documentation only; they do not alter any `build.files` input. Therefore the
portable and installer hashes above remain the valid branch-candidate hashes.
