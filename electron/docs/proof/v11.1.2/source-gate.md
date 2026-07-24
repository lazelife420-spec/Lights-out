# Post-remediation source gate

Date: 2026-07-24 (America/Los_Angeles)

Both source-gate passes completed successfully after the narrow `tar` lockfile
remediation and desktop UX functional-gate stabilization.

| Gate | Pass 1 | Pass 2 |
|---|---:|---:|
| ESLint | pass | pass |
| Entry-point syntax checks | pass | pass |
| Unit tests | 290 passed, 0 failed | 290 passed, 0 failed |
| Desktop smoke | 261 passed, 0 failed | 261 passed, 0 failed |
| Companion smoke | 15 passed, 0 failed | 15 passed, 0 failed |
| Packaged smoke | 12 passed, 0 failed | 12 passed, 0 failed |
| Desktop UX native Electron gate | pass, 6 phases / 25 screenshots | pass, 6 phases / 25 screenshots |
| Companion V2 Electron proof | 88 passed, 0 failed, 0 real power actions | 88 passed, 0 failed, 0 real power actions |
| Receipt recovery Electron proof | 11/0 + 2/0, 0 real power actions | 11/0 + 2/0, 0 real power actions |
| Packaged truth | pass; cleanup confirmed | pass; cleanup confirmed |
| Packaged network | pass; listener/firewall cleanup confirmed | pass; listener/firewall cleanup confirmed |
| `npm audit` | 0 vulnerabilities | 0 vulnerabilities |

All proof scenarios remained Dry Run-only with zero real power actions. These
checks exercised the pre-existing packaged baseline; the definitive v11.1.2
artifact still requires rebuilding from a reviewed merge before native install,
Authenticode truth, and final hashes are considered.
