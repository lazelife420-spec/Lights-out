# Definitive desktop artifact metadata

Source commit:
`28c00605c9f9fe5f12670b6de0abaf4bc71b9342`

Build command: `cd electron && npm run build`

Build date: 2026-07-23 (America/Los_Angeles)

| Artifact | Bytes | File version | Product version | Built (UTC-07:00) | SHA-256 | Authenticode |
|---|---:|---|---|---|---|---|
| `dist/win-unpacked/Lights Out.exe` | 225,784,832 | 11.1.2 | 11.1.2.0 | 2026-07-23 00:37:49.7311934 | `4c62eab9f46176d0170ef4b97c65ca6cd24aeab3c77a43bf382c35eaa1048135` | NotSigned |
| `dist/LightsOut.exe` | 96,224,142 | 11.1.2 | 11.1.2 | 2026-07-23 00:39:19.3488618 | `2d52b292a049f2780be072e86be2860d6b6b95a7aeb58f3e77218c09ff808f2c` | NotSigned |
| `dist/Lights Out Setup 11.1.2.exe` | 96,484,754 | 11.1.2 | 11.1.2 | 2026-07-23 00:39:21.1916095 | `1a26c6041de02c590cff49a13874a61c27c0597e5acd2eb97314dc6dc2ea287c` | NotSigned |

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

## Installer validation

With no pre-existing registered installation:

1. Silent fresh per-user install exited 0 and registered `Lights Out 11.1.2`.
2. Running the same installer again as an in-place upgrade exited 0.
3. The installed executable reported file version 11.1.2 and product version
   11.1.2.0. Its SHA-256 matched the definitive unpacked executable before and
   after upgrade.
4. The installed copy passed the complete six-phase desktop UX gate.
5. Silent uninstall exited 0; the install directory and uninstall registry
   entry were both removed.

Windows Authenticode is truthfully `NotSigned` for the portable, installer, and
unpacked executable. No signing claim is made.
