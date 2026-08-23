# Evidence Ledger: LIGHTS_OUT_GOVERNING_FUTURE_AGENT_DIRECTIVE.md

**Status:** CUSTODY EVIDENCE — ADDITIVE DOCUMENTATION

## 1. What was done

A Lights Out-specific governing future-agent directive was authored and placed in the repository root. It was produced from:

- `AGENTS.md` (live handoff rules)
- `electron\package.json` (version `11.1.2`, build config)
- `companion-android\app\build.gradle` (versionName `11.1.1`)
- current Git state (branch `feat/steam-shell-phase1`, HEAD `fa0b5d8e67ef97bb27f20891f91fe193317c`, latest tag `v11.1.0`)
- `docs\release\` receipts as frozen record references

This evidence record implements the applicable inventory/custody portions of Section 11 of the Lights Out governing directive.

## 2. Artifact inventory

- **Artifact:** `LIGHTS_OUT_GOVERNING_FUTURE_AGENT_DIRECTIVE.md`
- **Path:** `C:\Users\KickA\Desktop\Lights Out\LIGHTS_OUT_GOVERNING_FUTURE_AGENT_DIRECTIVE.md`
- **Size:** 21,796 bytes
- **SHA-256:** `563eb152fd38ce761738ae8f5bcc21bc8c684ebf7e1248a0216dc24a5eecf673`
- **Last modified:** `2026-08-23`
- **Git status:** `??` (untracked)
- **Author:** Cascade
- **Agent date (UTC-07:00):** 2026-08-23

## 3. Evidence classification

- **Type:** custody / provenance
- **Grade:** SOURCE-BACKED + INVENTORY BACKED (generated from live `AGENTS.md`, `electron\package.json`, `companion-android\app\build.gradle`, and Git state)
- **Maturity:** additive documentation
- **Modern impact:** none; this is a governance record, not product source

## 4. Source inputs

| Source | Evidence grade | What it contributes |
|---|---|---|
| `AGENTS.md` | SOURCE-BACKED | live safe defaults, verification checklist, files to treat carefully |
| `electron\package.json` | SOURCE-BACKED | version `11.1.2`, build files, scripts |
| `companion-android\app\build.gradle` | SOURCE-BACKED | versionName `11.1.1` (line 43) |
| `git status` / `git branch` / `git rev-parse` / `git describe` | REPOSITORY-STATE PROOF | branch, HEAD, latest tag; proves repository state, not application runtime |
| `docs\release\` receipts | DOCUMENTARY / HISTORICAL RECORD | frozen shipping receipts and release assertions; verify against actual build artifacts where independent proof is required |

## 5. Relationship taxonomy

- **Lights Out directive** → **`AGENTS.md`**: `Shared contract` (both govern agent behavior; `AGENTS.md` is the live detailed handoff, this file is the interpretive rule set).
- **Lights Out directive** → **NE governing directive**: `Lineage / evolution` (this file adapts the structure and principles of the NE directive to Lights Out; content is scoped to Lights Out).
- **This ledger** → **Lights Out directive**: `Custody / provenance record for` (this ledger documents the directive's creation, custody, and canonical inputs; it is not a code dependency).

## 6. Authorized scope

Per the Lights Out governing directive Section 16, this evidence record is an exercise of the additive-documentation / inventory permission only. No source modification, merging, releasing, or importing of historical code into the current product has occurred.

## 7. Stop conditions met

None. This task is a single documentation step and does not trigger any mandatory stop condition.

## 8. Note

Both the directive and this ledger are untracked pending explicit user authorization to commit or merge.

## 9. Evidence ledger self-custody

- **Artifact:** `LIGHTS_OUT_GOVERNING_DIRECTIVE_EVIDENCE.md`
- **Path:** `C:\Users\KickA\Desktop\Lights Out\LIGHTS_OUT_GOVERNING_DIRECTIVE_EVIDENCE.md`
- **Content body size:** 3343 bytes
- **SHA-256 (content body; computed before appending this self-custody section):** `b9d8736d0e673e468da774f32262d764ea1c53ad731370eae67f0d601666f939`
- **How to verify:** remove the `## 9` section from this file, save, and recompute SHA-256. The result should match the recorded body hash.
