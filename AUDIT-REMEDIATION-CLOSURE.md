# Audit Remediation Closure Report

**Product**: Lights Out — Windows Bedtime Shutdown App (Electron)
**Audit Base**: `AUDIT-ADJUDICATION-REPORT.md` (superseding `AUDIT-REPORT.md`)
**Remediation Branch**: `fix/audit-remediation-p2p3`
**Base Commit**: `268e6b0074c0d4ca310aab8eec775b851897ca05`
**Final Commit**: `45203f4` (HEAD of remediation branch)
**Date**: 2026-09-14

---

## 1. Remediation Summary

| Defect ID | Severity | Status | Commit | Fix Description |
|-----------|----------|--------|--------|-----------------|
| DEF-002 | P2 | **FIXED** | `9444568` | `routerIp` validated with `net.isIP()` at `sanitizeWifiGuard` trust boundary |
| DEF-006 | P2 | **FIXED** | `c8ca614` | Write-tmp-verify-rename persistence with `.bak` recovery |
| NEW-001 | P2 | **FIXED** | `c34c6c6` | Timer tick derives `remainingSeconds` from `endsAt` wall-clock |
| DEF-001 | P3 | **FIXED** | `599decd` | MAC regex validation in `sanitizeWifiGuard`; `deviceIps` validated with `net.isIP()` |
| DEF-003 | P3 | **FIXED** | `599decd` | `hueBridgeIp` validated with `net.isIP()` in `smartLights.loadConfig` |
| DEF-005 | P3 | **FIXED** | `599decd` | Companion `innerHTML` → `textContent`/`createElement` for server data |
| DEF-008 | P3 | **FIXED** | `599decd` | Import handler uses `ALLOWED_SECTIONS` allowlist |
| NEW-002 | P3 | **FIXED** | `599decd` | Deny-by-default `setPermissionRequestHandler` / `setPermissionCheckHandler` |
| NEW-003 | Info | **FIXED** | `599decd` | CSP comment corrected to reflect `textContent`/`createElement` usage |
| DEF-004 | Info | **NO ACTION** | — | Not a defect (adjudication disproven) |
| DEF-007 | N/A | **RETRACTED** | — | Not a defect (adjudication retracted) |
| DEF-009 | Info | **NO ACTION** | — | Not a defect (confirmed safe) |
| DEF-010 | Info | **NO ACTION** | — | Not a defect (confirmed safe) |

### Informational (no fix, documented only)

| Item | Status |
|------|--------|
| 8 duplicate `executePS` functions | ARCHITECTURAL_DEBT — refactor deferred. Each copy has minor differences suited to its caller. |

---

## 2. Regression Test Inventory

| Test File | Tests | Covers |
|-----------|-------|--------|
| `routerIp-destination-validation.test.js` | 21 | DEF-002: IP validation positive/negative, import compat, provider isolation |
| `settings-durability.test.js` | 11 | DEF-006: save/backup, zero-byte/truncated/invalid recovery, first run, stale .tmp, encryption |
| `timer-wallclock-derivation.test.js` | 11 | NEW-001: source-level proof, formula validation, wake scenarios, completion, pause/resume |
| `import-schema-allowlist.test.js` | 5 | DEF-008: allowlist presence, gate check, prototype pollution, type protection |

**Total new regression tests**: 48
**Total test suite**: 619 pass, 0 fail
**Smoke suite**: 261 pass, 0 fail
**Lint**: Clean (0 errors)

---

## 3. Adjudication Test Disposition

The three original adjudication proof tests were:

| Original File | Superseded By | Disposition |
|---------------|---------------|-------------|
| `adjudication-def002.js` | `routerIp-destination-validation.test.js` | Deleted (untracked); proper regression test committed |
| `adjudication-def006.js` | `settings-durability.test.js` | Deleted (untracked); proper regression test committed |
| `adjudication-def008.js` | `import-schema-allowlist.test.js` | Deleted (untracked); proper regression test committed |

The superseding tests preserve all defect-detecting assertions from the adjudication probes.
Forensic logging and probe-only machinery was removed; behavioral assertions were retained.

---

## 4. Files Changed

```
electron/capabilityTruth.js         +15 -2   (DEF-001, DEF-002: net.isIP, MAC regex)
electron/companion.html             +64 -6   (DEF-005: innerHTML → createElement)
electron/companion.js                +6 -6   (NEW-003: CSP comment)
electron/main.js                    +15 -4   (NEW-001: wall-clock, NEW-002: permissions, DEF-008: allowlist)
electron/settings.js                +77 -6   (DEF-006: write-rename-backup)
electron/smartLights.js              +3 -1   (DEF-003: hueBridgeIp validation)
electron/test/ (4 new files)       +613       (regression tests)
```

**Total**: 10 files changed, 758 insertions, 35 deletions.

---

## 5. Custody Chain

```
AUDIT_REPORT_SHA256        = 8996BFBE06E549C994CC9D18722C7A19A0B0B55E04CBBD8794323915AB9F0A89
REMEDIATION_BASE_HEAD      = 268e6b0074c0d4ca310aab8eec775b851897ca05
REMEDIATION_BASE_TREE      = 56e6bc37de45749eabe3ea56b13671213bdb7f4b
REMEDIATION_BRANCH         = fix/audit-remediation-p2p3
OWNER_CHANGES_PRESERVED    = git stash@{0} (sharp ^0.35.3→0.35.4 + lockfile)
OWNER_CHANGES_PATCH_SHA256 = 356B9FAB337377C30ED1732A29B99511A63989585A2F2B8D872EEBA7F205A2B4
```

---

## 6. Verification Record

```
LINT:    CLEAN
SYNTAX:  7 modules checked (main.js, renderer.js, preload.js, settings.js, companion.js, capabilityTruth.js, smartLights.js)
UNIT:    619 pass, 0 fail
SMOKE:   261 pass, 0 fail
```

---

## 7. Remaining Work

| Item | Priority | Notes |
|------|----------|-------|
| `executePS` consolidation | Low | 8 copies with minor differences; refactor when a behavioral change is needed |
| Tag / release | Deferred | Per user instruction: do not tag, publish, or create a release |
| Merge to main | Owner decision | Branch is ready for review/merge |
| Restore sharp bump | Post-merge | `git stash pop` to restore the pre-existing `sharp ^0.35.3→0.35.4` change |

---

## 8. Second-Order Scan Results

No second-order defects were introduced by the remediation. Specific checks:

- **DEF-002**: Users with hostname-based `routerIp` will see WiFi Guard disabled with a clear error message guiding them to use an IP address. This is correct — the old behavior silently accepted hostnames that could exfiltrate credentials.
- **DEF-006**: `.bak` and `.tmp` files are created in the same `userData` directory. No file watchers or external consumers are affected.
- **NEW-001**: NTP backward jumps temporarily show more remaining time (self-correcting). This is far preferable to the 10-minute sleep drift scenario.
- **NEW-002**: Electron's native `Notification` API is unaffected by browser permission denial. All app notifications use the native API.
- **DEF-005**: `innerHTML = ''` for container clearing is safe (no user data). All server-provided text now flows through `textContent`.
- **Duration label typo**: A leading space in the companion meta `' Duration'` was caught and fixed in the second-order scan.
