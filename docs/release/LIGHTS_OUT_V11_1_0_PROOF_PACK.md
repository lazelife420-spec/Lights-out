# Lights Out v11.1.0 Proof Pack

Date: 2026-07-16  
Release: Night Modes Library  
Desktop surface: `electron/`  
Android companion: unchanged and outside this release proof

## Release claim

v11.1.0 adds a declarative Night Modes Library with four ready presets: Quick
Sleep, Lights Down, Movie Wind-Down, and Full Shutdown. Quiet House and School
Night remain visibly unavailable with honest capability reasons.

Selecting **Use Tonight** arms canonical values in the lobby and never starts a
timer. The Electron main process owns mode resolution and ritual selection;
receipts preserve canonical mode ID, title, and version. Night Modes cannot add
arbitrary script or shell execution paths.

## Real Electron proof

`npm run test:night-modes-runtime` launches the real `main.js` with:

- isolated temporary `userData`;
- real `index.html`, preload bridge, IPC handlers, and main-process modules;
- `--minimized --no-auto-start`;
- Dry Run forced on;
- a clock accelerator confined to the proof process.

The eight checks verify:

1. Real renderer and preload bridge load with the timer idle.
2. Six catalogue entries cross renderer → preload → IPC → main.
3. Quick Sleep arms through the real DOM without starting.
4. Quick Sleep reaches `dry_run_completed` with canonical receipt identity.
5. Lights Down enters the standard ritual, starts one canonical countdown, and
   records cancellation.
6. Movie Wind-Down does the same.
7. Full Shutdown does the same while remaining Dry Run—no shutdown command.
8. Selecting unavailable Quiet House clears a prior ready selection and leaves
   **Not Available** disabled.

Final result was reproduced twice consecutively: **8 passed, 0 failed; zero
real power actions**.

## Verification ledger

| Gate | Result |
|---|---|
| ESLint | Pass, zero errors |
| Syntax | 49 shipped JavaScript files pass `node --check` |
| Unit tests | 214 passed, 0 failed |
| Smoke | 239 passed, 0 failed |
| Night Modes source proof | 20 passed, 0 failed |
| Night Modes real Electron proof | 8 passed, 0 failed, reproduced twice |
| Window geometry runtime | Pass at canonical 900×640 normal minimum and 260×320 Mini Mode request |
| `npm audit` | 0 vulnerabilities |
| Production package | Portable and NSIS builds pass |
| Packaged runtime smoke | 11 passed, 0 failed |

## Local release-candidate artifacts

These hashes identify the locally verified Windows artifacts and the exact
files uploaded to the GitHub release. GitHub Actions was disabled at the
account level (`HTTP 422: Actions has been disabled for this user`), so the tag
workflow could not perform its normal rebuild/publish path. Manual publication
is limited to these already gated, hash-matched artifacts; the binaries were
not edited after `electron-builder` produced them.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `LightsOut.exe` | 96,361,574 | `12deb2b8a99b72e4b3d913d453ab3cf3a915e10a133e1af6edfbb7dfcccabfc5` |
| `Lights.Out.Setup.11.1.0.exe` | 96,622,192 | `4cf143fdb892cb793f4976f3f81c92170b500ae3d8497d7a7aa434a0c9c5a9bb` |

`electron-builder` produced the local file as `Lights Out Setup 11.1.0.exe`;
GitHub normalized the published asset name to `Lights.Out.Setup.11.1.0.exe`
without changing its bytes or digest. `SHA256SUMS.txt` uses the published name.

## Safety boundaries retained

- Default launch remains idle.
- Login startup remains minimized and idle.
- Force shutdown is never selected implicitly.
- Wind-down system actions remain off by default.
- Remote/companion control cannot force shutdown, log out, or hibernate.
- Unavailable Night Modes cannot execute.
- Smart-light hardware behavior is not claimed as runtime-proven.

## Family Profiles decision

The next candidate is scoped separately in `docs/FAMILY_PROFILES_V1_SCOPE.md`
as a local-only household identity layer. LAN synchronization, remote profile
mutation, authentication, and parental-control enforcement are out of scope.
