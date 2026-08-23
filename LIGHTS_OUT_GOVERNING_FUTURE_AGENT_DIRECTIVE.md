# LIGHTS OUT — GOVERNING FUTURE-AGENT DIRECTIVE

**Status:** GOVERNING / FROZEN INTERPRETIVE RULESET  
**Purpose:** Tell any future agent how to research, reconcile, discuss, salvage, compare, or extend Lights Out work without corrupting the established historical record or current product truth.

This directive lives alongside `AGENTS.md`.  
- `AGENTS.md` is the live day-to-day source of truth for build verification, safe defaults, and code behavior.  
- This file is the interpretive rule set for handling historical material, frozen records, evidence-grade claims, and scope discipline.

---

## 1. Governing disposition

The current disposition is:

> **CURRENT-PRODUCT ELECTRON + ANDROID IN ACTIVE DEVELOPMENT; HISTORICAL POWERSHELL/WINFORMS LINEAGE PRESERVED BUT NOT AUTHORITATIVE.**

What we know:

- Active branch: `feat/steam-shell-phase1`
- HEAD: `fa0b5d8e67ef97bb27f20891f91fe193317c`
- Electron package version: `11.1.2` (`electron\package.json`)
- Android companion version: `11.1.1` (`companion-android\app\build.gradle`, `versionName '11.1.1'`)
- Latest reachable Git tag: `v11.1.0`
- The primary app surface is `electron\`.
- The optional Android companion is `companion-android\`.
- `AGENTS.md` is the live source of truth for safe defaults and verification.
- `docs\release\` contains frozen shipping receipts and proof packs.

Do **not** treat this directive as authorization to resume archaeology, salvage, integration, release, migration, or implementation work unless explicitly scoped.

---

## 2. Current product authority versus historical lineage

### Current product authority

The present-tense product is:

- **Electron v11.1.2** (`electron\package.json`)
- **Android v11.1.1** (`companion-android\app\build.gradle`, `versionName '11.1.1'`)
- Source of truth files: `electron\main.js`, `electron\renderer.js`, `electron\preload.js`, `electron\index.html`, `electron\styles.css`, and the per-feature modules listed in `electron\package.json` `build.files`.
- `AGENTS.md` is the live handoff document for day-to-day work.

Use the current canonical repositories, `package.json`, tests, runtime evidence, and current product ledgers for present-tense claims.

### Historical lineage

The PowerShell/WinForms `v5.2.0` lineage describes a real earlier Lights Out implementation based on:

- `SleepTimer-Tonight.ps1`
- `LightsOut.*.psm1`
- `SleepTimer.exe`
- The historical `CoolTimer` settings lineage

This material is valuable for:

- ancestry reconstruction;
- old feature recovery;
- historical product comparison;
- identifying concepts that may have survived into later versions.

It is **not** authority for current product behavior. Do not allow the PowerShell handbook to overwrite the current Electron/Android product truth. If recovering a feature from v5.2 into the current product, classify the task as **historical feature recovery or lineage-informed implementation**, not as “fixing missing canonical behavior” unless `AGENTS.md` or current records explicitly say so.

---

## 3. Three governing rules

### Rule A — Extend without reopening

New evidence may **extend, refine, qualify, or correct** the historical record.

New evidence does **not** automatically:

- reopen a frozen phase;
- invalidate a previously correct disposition;
- authorize new implementation work;
- import historical code into the current product;
- alter modern release-candidate provenance;
- replace current product authority with older documentation.

If new evidence materially conflicts with a frozen record:

1. Preserve the original record.
2. Create an additive correction or superseding evidence note.
3. State exactly what changed and what did not.
4. Do not rewrite history silently.
5. Do not reopen implementation work unless explicitly authorized.

### Rule B — Evidence-grade without mythologizing

Do not inflate historical systems beyond what the evidence proves.

Do not diminish real implementations merely because they were incomplete, abandoned, lost, untracked, or never integrated.

Use the strongest defensible classification supported by evidence.

Guiding examples:

- Chat discussion alone does not prove implementation.
- Source code proves source existence, not runtime.
- Tests prove tested behavior within their scope, not deployment.
- Runtime evidence proves execution in the tested environment, not release.
- A package proves packaging, not adoption.
- Similar names do not prove shared identity.
- Similar architecture does not prove integration.
- A lost implementation may still have been substantive if surviving evidence proves it.
- A component with zero consumers must not be described as integrated.

### Rule C — Judge by relationship type and evidence strength

Do not force the ecosystem into either of these false models:

1. “Everything was one perfectly integrated monolith.”
2. “Everything was disconnected scraps and abandoned ideas.”

The governing model is:

> **A substantial modular software ecosystem containing direct integrations, shared contracts, embedded compatibility implementations, partially realized systems, abandoned branches, lost code, experiments, independent products, and concepts that later re-emerged in Lights Out.**

For every claimed relationship, identify its actual type and supporting evidence.

### 3.1 Conflict-precedence clause

`AGENTS.md` is the live day-to-day source of truth for build verification, safe defaults, and code behavior. This directive is the interpretive rule set for historical material, frozen records, evidence-grade claims, and scope discipline.

When this directive makes a current-state factual claim that conflicts with freshly verified canonical source, Git, test, or runtime evidence, the freshly verified evidence wins. Treat the conflict as an additive correction: preserve the original directive text, document the new evidence, and update the claim. Do not let this file override a stronger, current evidence layer.

---

## 4. Required evidence hierarchy

When making historical or current-state claims, distinguish the evidence layer explicitly.

Recommended hierarchy (stronger to weaker):

1. Canonical/frozen disposition records
2. Source-backed implementation evidence
3. Tests and deterministic proof artifacts
4. Runtime evidence
5. Packaged/build evidence
6. Release/publication evidence
7. Architecture/design documentation
8. Chat-derived design intent or historical statements
9. Inference

Higher-numbered evidence can still be valuable, but it must not be silently promoted to a stronger category.

A claim should say what is actually proved. Preferred phrasing:

- `SOURCE-BACKED`
- `SOURCE + TEST BACKED`
- `RUNTIME-PROVEN`
- `PACKAGED`
- `RELEASED`
- `CHAT-VERIFIED DESIGN INTENT`
- `UNRESOLVED`
- `LOST IMPLEMENTATION — SURVIVING PROOF ARTIFACTS`
- `NO VERIFIED CONSUMER`
- `CONCEPTUAL LINK ONLY`

Avoid vague words such as “basically,” “apparently,” “probably integrated,” or “seems canonical” when a more precise classification is possible.

---

## 5. Relationship taxonomy

When mapping two entities, use one or more explicit relationship types.

- **Direct integration:** source/runtime evidence shows one system actually consuming, calling, loading, importing, executing, or depending on another.
- **Shared contract:** systems implement the same protocol, API, schema, interface, format, or contract, but direct runtime integration is not proved.
- **Embedded compatibility implementation:** one project contains its own implementation of a common architecture or protocol rather than consuming a shared standalone package.
- **Shared infrastructure:** multiple systems demonstrably rely on a common service, library, trust root, event mechanism, or storage layer.
- **Lineage / evolution:** one product, module, or concept evolved into, was absorbed by, or directly influenced another. Preserve aliases and historical names.
- **Conceptual relationship:** chats/design documents connect systems but source/runtime evidence does not prove implementation.
- **Name/branding relationship:** rebranding, aliasing, or naming continuity without necessarily proving code continuity.
- **Independent / adjacent:** entities belong to the same broader ecosystem but no stronger technical relationship is proved.
- **Unresolved:** evidence conflicts or remains insufficient.

Never upgrade a relationship type merely because the stronger relationship would make the ecosystem story cleaner.

---

## 6. Frozen phases and records

The following records and phases are treated as frozen. Do not silently reopen, merge, or alter their dispositions without an additive correction:

- Release `v11.0.1` branch (`release/v11.0.1`)
- Electron UX redesign checkpoint `1fc30a3` on `feat/devices-control-center-1a` (do not resume broad Tonight/Modes/Schedule/Devices/Proof layout redesign)
- Desktop companion Easy Connect proof (`4a4fd18`)
- Night Modes library and declarative resolution model
- Ritual native acceptance / overlay proof
- Companion Android APK delivery artifacts
- `docs\release\` shipping receipts and proof packs

A frozen or closed phase means its disposition is historical fact unless later evidence produces an **additive correction**.

Do not use phrases such as:

- “we should reopen this because we found something interesting”;
- “this changes everything”;
- “the old audit was wrong”;

unless the evidence actually requires that conclusion.

Instead ask:

1. Does the new evidence contradict the old record?
2. Does it merely add a previously unknown branch/component?
3. Does it change historical classification?
4. Does it affect modern provenance?
5. Does it create a new optional salvage candidate?
6. Does it require action now?

Often the correct answer will be:

> Historical record extended; implementation state unchanged.

---

## 7. Safe defaults (intentional product constraints)

These are not bugs. Do not casually remove them.

- Default open behavior should be idle, not auto-start.
- Preview paths should prefer `DryRun` when possible.
- Force shutdown should be explicit and discoverable, not hidden behind the normal launcher.
- “Run at login” wording must stay aligned with actual behavior: minimized and idle.
- The app must never change the user’s desktop theme.
- All wind-down system actions (Night Light, media pause, lockout) default OFF.
- Remote/companion control may never force a shutdown, log out, or hibernate.

See `AGENTS.md` for the full, live safe-defaults list.

---

## 8. Files and directories to treat carefully

- `dist\` — Electron build output. Do not hand-edit.
- `dist-native\` — native build output. Do not hand-edit.
- `LightsOut.exe` in the repo root — **does not exist**. The only valid portable build is `dist\LightsOut.exe`.
- `archive\`, `system-tune-backup-*` — historical backups. Do not edit unless explicitly asked.
- `companion-android\keystore.properties` and `~/.android/lightsout-companion-release.jks` — signing identity; no recovery path.
- `docs\release\` — frozen shipping receipts. Treat as historical fact, not scratch space.

---

## 9. Verification checklist

A Lights Out change is not done until:

1. It landed in `electron\` or the appropriate canonical tree.
2. The safest default behavior still makes sense.
3. Verification was actually run for the surface you changed.
4. Smoke/unit suites were updated if the changed behavior should be regression-guarded.
5. Docs or launcher text were updated if user-facing behavior changed.

Default lanes (run the ones that touch your change):

- `cd electron && npm run lint`
- `node --check electron\main.js`
- `node --check electron\renderer.js`
- `node --check electron\preload.js`
- `cd electron && npm test`
- `cd electron && npm run smoke`
- `cd electron && npm run build`

Do not claim a lane was run unless it actually was. Lower-effort mode does not override the requirement to verify the surface you changed.

---

## 10. Current-product work must remain current-product work

When asked to improve a current product:

1. Load current canonical product context first (`AGENTS.md`, current branch, `package.json`, frozen records).
2. Verify current branch/version/repository authority.
3. Treat historical documents only as secondary lineage input unless explicitly requested otherwise.
4. Do not revive historical architectures automatically.
5. Preserve current tests, UX freezes, release gates, and safety rules.
6. Keep historical archaeology separate from current execution.

This is especially important for Lights Out because its history contains both a substantial current Electron product and a real but separate PowerShell/WinForms lineage.

---

## 11. Required workflow for future historical research

When a new historical file, repository, archive, chat corpus, package, or executable appears:

1. **Preserve scope** — identify exactly what was found; do not expand without reason.
2. **Inventory** — record exact path/name, timestamps, Git identity, hashes, package/build identity, aliases, and related names.
3. **Classify evidence** — chat, design, source, test, runtime, package, release, custody, or security evidence.
4. **Determine entity identity** — do not merge similar names automatically; preserve aliases until identity is proved.
5. **Determine maturity** — conceptual, source-backed, partially implemented, test-backed, runtime-proven, packaged, released, lost implementation, abandoned, absorbed/evolved, stranded IP, unresolved.
6. **Determine relationships** — use the relationship taxonomy.
7. **Compare against frozen truth** — confirm, extend, correct, conflict with, or do not affect the existing record.
8. **Produce additive correction if required** — never silently overwrite.
9. **Check modern impact separately** — historical importance and modern implementation impact are separate questions.
10. **Stop at disposition** — do not automatically convert research findings into implementation work.

---

## 12. Required workflow for salvage proposals

Historical discovery does not equal salvage authorization.

Before proposing salvage, establish:

1. surviving source exists;
2. legal/security/custody status is acceptable;
3. behavior is understood;
4. dependencies are understood;
5. tests can be created or recovered;
6. target modern product is identified;
7. actual product value exists;
8. implementation would not violate current architecture or provenance constraints;
9. opportunity cost is justified.

Then classify the candidate:

- **SALVAGE NOW**
- **SALVAGE LATER**
- **REFERENCE ONLY**
- **HISTORICAL ONLY**
- **QUARANTINE**
- **DO NOT SALVAGE**
- **UNRESOLVED**

Do not salvage because something is merely “cool,” old, complicated, or branded as Lights Out.

---

## 13. Common-sense checks

Before making a strong claim, ask:

- Would a skeptical engineer agree the evidence proves this?
- Am I confusing existence with integration?
- Am I confusing tests with runtime?
- Am I confusing package existence with release?
- Am I confusing historical documentation with current authority?
- Am I collapsing aliases too early?
- Am I turning a design aspiration into an implementation fact?
- Am I dismissing a real implementation merely because it was never released?
- Am I inventing a cleaner architecture than the one that actually existed?
- Am I reopening work when the evidence only requires an additive record update?

If yes, correct the claim.

---

## 14. Language requirements

Prefer precise disposition language.

Good:

> SOURCE-BACKED NATIVE COMPONENT; CONSUMPTION UNPROVEN; RUNTIME UNPROVEN.

Good:

> HISTORICAL RECORD ADDITIVELY EXTENDED; MODERN LINE UNAFFECTED.

Good:

> SHARED CONTRACT PROVEN; DIRECT INTEGRATION UNPROVEN.

Good:

> LOST IMPLEMENTATION; MATURITY SUPPORTED BY SURVIVING TEST/PROOF ARTIFACTS.

Good:

> HISTORICAL LINEAGE ONLY; CURRENT PRODUCT AUTHORITY LIES ELSEWHERE.

Bad:

> It was all connected.

Bad:

> None of it was real.

Bad:

> This was definitely the universal runtime.

Bad:

> The modern app comes from this because the concepts look similar.

Bad:

> We found old code, so it should be merged.

---

## 15. Stop conditions

Stop and report rather than expanding scope when:

- a newly discovered defect belongs to a different gate;
- evidence creates a security concern;
- provenance becomes uncertain;
- a frozen record would need material correction;
- a proposed action would affect modern RC/MVP state;
- a historical import would cross into current product code;
- required source is missing;
- evidence cannot distinguish two identities;
- a task would require reopening a closed phase;
- explicit authorization is absent.

A correct stop is a successful outcome when scope boundaries require it.

---

## 16. Authorization rule

Unless explicitly authorized, this directive permits:

- reading;
- inventory;
- comparison;
- evidence classification;
- lineage reconstruction;
- additive documentation;
- non-destructive verification.

It does **not** authorize:

- source modification;
- merging;
- deleting;
- rewriting frozen records;
- rebuilding;
- publishing;
- tagging;
- releasing;
- pushing;
- importing historical code into modern products;
- lifting security quarantine;
- reopening closed phases.

---

## 17. Autonomous execution mode

When the user gives a task that is already within an authorized scope, **execute it autonomously from start to finish**.

Do not repeatedly ask for confirmation between ordinary steps.

The agent should:

1. Read the governing records and current canonical context first.
2. Determine the task boundary from the user’s instruction and the frozen rules.
3. Make reasonable, evidence-based decisions inside that boundary using common sense.
4. Perform necessary inventory, searches, comparisons, verification, analysis, documentation, testing, or other already-authorized work without waiting for step-by-step approval.
5. Follow discovered evidence wherever necessary **within the authorized scope**.
6. Correct its own intermediate assumptions when stronger evidence appears.
7. Produce and preserve required receipts, ledgers, hashes, test results, or additive records when the task calls for them.
8. Continue until the task reaches a defensible disposition, completion condition, or mandatory stop boundary.
9. Report the final state clearly, including what was completed, what evidence supports it, what remains unresolved, and whether new authorization is required.

### Do not confuse autonomy with unlimited authority

Autonomous execution means:

> **Do everything reasonably necessary to complete the authorized task without unnecessary user interruption.**

It does **not** mean:

- broaden the project beyond the requested task;
- reopen frozen phases;
- bypass quarantine;
- silently alter canonical records;
- merge or release without authorization;
- import historical code into modern products without authorization;
- perform destructive operations merely because they would be convenient;
- invent evidence to eliminate uncertainty;
- continue past an explicit stop condition.

### Ambiguity rule

If a minor implementation or research choice is not specified but can be resolved safely from governing records, current canonical state, established project conventions, existing evidence, and common engineering sense, resolve it autonomously and continue.

Do **not** interrupt the user for trivial choices.

Ask or stop only when the missing decision would materially change:

- scope;
- product direction;
- security posture;
- provenance;
- destructive impact;
- release/publication state;
- canonical architecture;
- a frozen disposition.

### Discovery rule

If work inside the authorized task reveals additional relevant evidence, inspect and classify it when doing so is necessary to finish the task correctly.

Do not treat every discovery as permission to start a new project or gate.

If a discovery belongs outside the authorized scope:

1. record it;
2. preserve the evidence;
3. classify its importance;
4. stop expansion into that area;
5. report it as a follow-up candidate.

### Completion rule

Do not stop merely because one planned sub-step succeeded.

Continue autonomously through the remaining authorized verification and closure work until one of these is true:

- the requested task is complete;
- the governing acceptance criteria are satisfied;
- evidence proves the task cannot safely continue;
- a mandatory stop condition in this directive is reached;
- new authorization is genuinely required.

A successful autonomous run ends with a **clear disposition**, not merely a narration of activity.

---

## 18. Governing mental model

Use this as the default interpretation:

> Lights Out is a real, substantial product with both a current Electron/Android line and a real but separate PowerShell/WinForms ancestry. Its history includes directly integrated components, shared architectural contracts, locally embedded compatibility implementations, partially realized systems, independent products, abandoned branches, source-backed experiments, lost implementations, design-only concepts, and ideas that later re-emerged. Every relationship must be classified by type and evidence strength. Historical discoveries extend the record without automatically reopening frozen work or altering modern provenance.

---

## 19. Final agent instruction

When uncertain, choose the **most precise claim the evidence supports**, preserve unresolved distinctions, and stop before converting historical discovery into unauthorized implementation.

Do not make the story cleaner than the evidence.

Do not make the history smaller than the evidence.

**Preserve truth, provenance, lineage, scope, and safe defaults.**
