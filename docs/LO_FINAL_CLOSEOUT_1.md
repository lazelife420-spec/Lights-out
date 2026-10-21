# LO-FINAL-CLOSEOUT-1 — 11.2.1-rc.3

Status: READY_FOR_GUARDED_ACCEPTANCE. PUBLIC_RELEASE_HOLD.

RC2 remains the frozen power + clock integration reference. This successor changes only the audited timer safety boundaries, credential persistence, version/provenance and distribution wrapper. The native suspend API, dispatcher, preload, clock formatters, lamp assets and cockpit styling are retained.

## Implemented behavior

- Test Mode timer/ritual sessions skip automatic light dim/off/restore, Night Light, app closing, media pause/resume, router/adapter blocking, content blocking and partner notifications. Emergency overrides are silent externally too. Rehearsals neither consume nor create real-session snooze debt. In-app scenes, timer controls and explicitly marked receipts remain. Manual device controls and independent alarms/schedules remain live and are disclosed in Settings.
- A timer-owned Wi-Fi transaction captures its provider/configuration, serializes block then restore, and orders old cleanup before a new block. Completion waits for restoration. Failed or uncertain restoration records a blocked receipt and dispatches no Windows power request. Cancellation handles a late block; the existing Restore internet control retries the captured transaction. A concurrent manual block is refused during power preparation. The explicit keep-blocked option remains a deliberate exception after a successful block; its captured configuration is retained for a later manual restore.
- Adapter restoration targets only the GUID captured before this run's disable request. No fallback selects another previously disabled adapter. Missing identity fails safely. PowerShell calls and router HTTP requests are bounded.
- Settings protect the current providers' credential URLs, router credentials, webhook headers/body, private calendar URL and partner-array webhook credentials, in addition to existing tokens. Custom values use the existing Windows safeStorage encryption. Public built-in defaults are not treated as secrets. New credential edits fail if encryption fails; no plaintext fallback is written. Unavailable ciphertext survives unrelated saves. Explicit clears remain possible. Legacy values migrate on the next successful save, including the recoverable backup. Credential edits roll back in memory if persistence fails.
- Internal application version is 11.2.1-rc.3; Windows file version is 11.2.1.0 and product version includes the RC identifier. The portable contains its runtime, launchers, short usage note, relative manifest and provenance. Engineering patches/evidence and private development paths remain outside it. No QA settings seed is shipped. Fresh launch is idle with normal onboarding and the existing 28-minute default.

## Qualification

172 focused tests pass, 0 fail; scoped lint has 0 errors/warnings. Extracted-package qualification passes 11 focused checks, including actual Windows keystore protection of synthetic credentials, all-enabled rehearsals, guided ritual, real debt preservation, delayed/failed restoration, manual recovery, late cancellation and intercepted native Sleep/Hibernate requests. A separate two-check lane verifies empty-profile onboarding/defaults and the visible rehearsal disclosure. Launcher arguments/data preservation pass with a harmless executable recorder. No full power matrix was repeated.

Independent denial was installed before the first product statement: immutable native process, device network and outside-QA filesystem boundaries. No physical power, live lighting/router/adapter/firewall/hosts mutation or overnight test occurred. Native-helper qualification is reused by unchanged binary/source hashes; packaged power requests use protocol fixtures. Windows API acceptance is never a physical-outcome receipt.

## Limits and release gates

This is an unsigned, uncommitted release candidate. A clean reviewed source commit and signing remain separate owner gates. Exact source snapshots, delta and manifests provide review custody; they do not substitute for a committed release. Physical power/resume, real router/adapter behavior, First Light wake and overnight operation remain unverified.

Wi-Fi sequencing/recovery here is an in-process guarantee. Forced termination, crash or machine loss can discard the captured transaction; durable cross-restart recovery remains unfinished and must be qualified before advertising Wi-Fi Guard as generally reliable. Provider acknowledgements do not measure end-to-end internet connectivity.

Credential migration has an older-build rollback limitation: prior builds do not decrypt the newly covered fields. Restoring the previous executable/shortcuts preserves history, but those optional integrations may require separate recovery or reconfiguration. Do not decrypt them automatically or restore an old whole-profile snapshot over newer history. Resolve/accept this compatibility gate before production promotion.

The nightly installation, original profile, shortcuts, rollback, RC1 and RC2 remain protected. No commit, push, signing, release, production promotion, scheduled task or Windows power configuration change is authorized or performed.

Electron's safeStorage security scope and availability are documented at https://www.electronjs.org/docs/latest/api/safe-storage . Windows encryption protects stored credentials from other user accounts; it is not a security boundary against other software running as the same user.

Full local hashes, exact changed files, test logs and promotion/rollback plan are in F:\LightsOutQA\LO-FINAL-CLOSEOUT-1-20261019.
