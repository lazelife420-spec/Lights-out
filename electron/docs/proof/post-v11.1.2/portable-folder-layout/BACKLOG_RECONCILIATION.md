# Current post-v11.1.2 backlog reconciliation

This ledger starts from current source plus the closed Phase A/B/C evidence chain. Closed work is not promoted again merely because an older report names it.

| Candidate | Current classification | Disposition |
|---|---|---|
| GitHub anonymous owner/repository/release visibility (F-01) | **EXTERNAL/BLOCKED** | Account/platform enforcement; not an engineering tranche. |
| Updater discovery through hidden GitHub API (F-02) | **EXTERNAL/BLOCKED** | Client failure reporting is already remediated; endpoint remains external. |
| Verified portable ZIP selection/integrity (F-03) | **HISTORICAL/STALE** | Remediated and covered by current updater policy tests. |
| Live website release truth and deployment (F-04/F-07/F-08) | **DOCUMENTATION/TRUTH** + **EXTERNAL/BLOCKED** | Corrected local site source exists; deployment needs separate authority and is outside this repository. |
| Duplicate authenticated remote start (F-05) | **HISTORICAL/STALE** | Remediated and runtime/physical-device proven. |
| Portable ZIP spills runtime files at archive root (F-06) | **REPRODUCED DEFECT** + **UX/COHERENCE IMPROVEMENT** | Selected. Current source and current local ZIP reproduce it. |
| Android reconnect blank state (F-09) | **HISTORICAL/STALE** | Remediated and physically proven. |
| SmartScreen/MOTW observation (F-19) | **EXTERNAL/BLOCKED** | Requires genuine browser delivery after GitHub visibility returns; no defect invented. |
| Physical camera QR ergonomics (F-20) | **CROSS-DEVICE** | Manual observation remains; manual URL fallback and authenticated control are proven, so it does not outrank a reproduced defect. |
| AGENTS current-release paragraph still names v11.1.0 | **DOCUMENTATION/TRUTH** | Real but agent-facing and low user impact; defer to a dedicated documentation refresh. |
| Electron README says Node 18+ while package engines require 22.13+ | **DOCUMENTATION/TRUTH** | Reproduced documentation mismatch; lower impact than extraction friction and not mixed into this tranche. |
| Dedicated light-surface brand lockup TODO | **UX/COHERENCE IMPROVEMENT** | No current product surface requires it; speculative, not selected. |
| New Night Modes/features | **FEATURE EXPANSION** | No reproduced need; explicitly not selected. |
| Timer/reliability/performance changes | **RELIABILITY** | Current gates are green; no present failure supports reopening them. |

No additional current **RELIABILITY** or **CROSS-DEVICE** defect was reproduced during reconciliation. The selected tranche remains one packaging-ergonomics correction.
