# Pre-commit source gate

Date: 2026-07-22 (America/Los_Angeles)

Both passes completed successfully after the v11.1.2 version bump and dependency
security refresh.

| Gate | Pass 1 | Pass 2 |
|---|---:|---:|
| ESLint | pass | pass |
| Entry-point syntax checks | pass | pass |
| Unit tests | 276 passed, 0 failed | 276 passed, 0 failed |
| Desktop smoke | 261 passed, 0 failed | 261 passed, 0 failed |
| Companion smoke | 15 passed, 0 failed | 15 passed, 0 failed |
| Desktop UX native Electron gate | 6 phases / 25 screenshots | 6 phases / 25 screenshots |
| Companion V2 Electron proof | 88 passed, 0 failed, 0 real power actions | 88 passed, 0 failed, 0 real power actions |
| Receipt recovery Electron proof | pass, 0 real power actions | pass, 0 real power actions |
| Existing packaged baseline smoke/truth | pass, 0 power actions | pass, 0 power actions |
| Existing packaged baseline network | pass; listener/firewall cleanup confirmed | pass; listener/firewall cleanup confirmed |
| `npm audit` | 0 vulnerabilities | 0 vulnerabilities |

The packaged checks in this table exercised the pre-existing package only as a
baseline. They are not the definitive v11.1.2 artifact proof. The closure lane
intentionally rebuilds packages only after the source/proof commit, then repeats
the packaged and native gates against that committed build.
