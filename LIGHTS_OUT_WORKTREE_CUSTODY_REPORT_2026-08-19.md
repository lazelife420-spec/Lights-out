# Lights Out — Worktree Custody Report

**Date:** 2026-08-19
Read-only audit. Nothing edited, deleted, reset, cleaned, pulled, pushed, merged,
or built while gathering this report.

---

## 1. Canonical checkout

```
C:\Users\KickA\Desktop\Lights Out
branch: feat/steam-shell-phase1
HEAD:   3229290  fix(quick-controls): use real CSS tokens instead of undefined --card-border
clean, 0 ahead / 0 behind origin/feat/steam-shell-phase1
```

All future Lights Out work should start here. This is the repo the other 25
worktrees below hang off, and the one this session has been committing to.

## 2. Secondary clone — duplicate, not canonical

```
C:\Users\KickA\Projects\Active\Lights Out
branch: feat/steam-shell-phase1
HEAD:   3229290  (same commit as canonical, confirmed by direct fetch)
clean, 0 ahead / 0 behind origin/feat/steam-shell-phase1
```

This is a **fully independent clone** (its own `.git`, not a worktree of the
canonical repo) that happens to track the same branch on the same remote.
This is the exact setup that let the `feat(shell): add quick controls
drawer` commit (`35a2a49`) land here on 2026-08-19 without going through
this session's review — some tool or session working in this clone
committed and pushed it directly, and the canonical checkout only picked it
up on its next fetch/pull. Currently in sync, but the underlying risk
(two full, independently-writable copies of the same branch) is unchanged.
**Do not use this path for future work unless explicitly chosen.**

## 3. All registered worktrees of the canonical repo

25 worktrees, all sharing `origin` (`https://github.com/lazelife420-spec/Lights-out.git`).
"No origin/&lt;branch&gt;" means the branch was never pushed — expected for
local-only task branches, not an error.

| Path (relative to repo root unless noted) | Branch | HEAD | Dirty count | Remote tracking | dist artifacts |
|---|---|---|---|---|---|
| *(repo root)* | `feat/steam-shell-phase1` | `3229290` | 0 | synced, 0/0 | dist-native |
| `.claude/worktrees/about-focus-restoration-3476f5` | `claude/about-focus-restoration-3476f5` | `56e6bc3` | **2** | no origin branch | none |
| `.claude/worktrees/audio-chime-crackle` | `fix/audio-opt-in-media-session` | `150c4f3` | 0 | no origin branch | dist |
| `.claude/worktrees/cold04-p1-correction` | `test/v11.1.2-native-menu-determinism-clean-v3` | `b42db57` | 0 | synced, 0/0 | dist-native |
| `.claude/worktrees/happy-kilby-a781d0` | `claude/coedex-latest-changes-6415ab` | `e8dd021` | **10** | no origin branch | dist |
| `.claude/worktrees/harness-ordering-determinism-8fa028` | *(detached)* | `201190f` | 0 | N/A | none |
| `.claude/worktrees/lights-out-msix-click-test-e461d6` | `fix/msix-launch-at-login` | `8fa2080` | 0 | no origin branch | dist-native |
| `.claude/worktrees/lights-out-msix-inspection-5a1d66` | `claude/lights-out-cleanup-verify-1c9a81` | `268e6b0` | 0 | no origin branch | none |
| `.claude/worktrees/msix-firewall-lifecycle` | `fix/msix-firewall-lifecycle` | `7f50be7` | 0 | no origin branch | none |
| `.claude/worktrees/msix-notifications` | `fix/msix-notifications` | `595c116` | 0 | no origin branch | dist-native |
| `.claude/worktrees/msix-r2-launch-login-527eff` | `claude/antigravity-ui-fixes-a7bf1c` | `268e6b0` | 0 | no origin branch | none |
| `.claude/worktrees/nice-knuth-8a62fc` | `claude/signed-apk-release-proof-867718` | `b530462` | **1** | no origin branch | dist |
| `.claude/worktrees/pc-shutdown-timer-issue-ea5e84` | `claude/cold-04-cursor-readback-aa8b18` | `201190f` | **1** | no origin branch | dist-native, dist |
| `.claude/worktrees/pc-shutdown-timer-issue-ea5e84/electron/.claude/worktrees/modest-borg-03baaf` *(nested)* | *(detached)* | `4c3aecf` | 0 | N/A | none |
| `.claude/worktrees/peaceful-matsumoto-fe7c9f` | `claude/peaceful-matsumoto-fe7c9f` | `cd9fd7d` | **3** | no origin branch | dist |
| `.claude/worktrees/pr43-independent-review` | *(detached)* | `8952780` | 0 | N/A | dist-native |
| `.claude/worktrees/pr43-warm-start-geometry-diagnostic` | `diagnostic/pr43-warm-start-geometry` | `bdc663a` | 0 | no origin branch | none |
| `.claude/worktrees/stupefied-mcclintock-a918bf` | `claude/nervous-carson-c5be01` | `4c3aecf` | **2** | no origin branch | none |
| `.kilo/worktrees/liberating-haze` | `liberating-haze` | `2d911f1` | **1** | no origin branch | none |
| `Desktop\audit-v11.2-slice2-settings` | *(detached)* | `268e6b0` | 0 | N/A | none |
| `Desktop\fix-v11.2-dry-run-state-integrity` | `fix/v11.2-dry-run-state-integrity` | `2fc07e2` | 0 | synced, 0/0 | none |
| `Desktop\Lights-Out-phase3-review` | *(detached)* | `0b0cbe6` | 0 | N/A | dist-native |
| `Desktop\msix-packaging-pilot` | `investigate/v11.2-msix-packaging-pilot` | `00ace32` | 0 | no origin branch | dist-native |
| `Desktop\pr43-cursor-custody-environment` | `diagnostic/pr43-cursor-custody-environment` | `05840fb` | 0 | no origin branch | none |
| `Desktop\ux-v11.2-explicit-tonights-plan` | `ux/v11.2-explicit-tonights-plan` | `6ed2245` | 0 | synced, 0/0 | none |
| `Desktop\ux-v11.2-navigation-foundation` | `ux/v11.2-navigation-foundation` | `ef11af1` | 0 | synced, 0/0 | none |
| `REPORTS_ARCHIVE\...\incomplete-menu-harness-readonly` | *(detached)* | `071efd2` | 0 | N/A | none |

## 4. Dirty worktrees — detail, not modified

### `.claude/worktrees/about-focus-restoration-3476f5` — 2 untracked files
```
?? msix-packaging-pilot-report.html
?? settings-decompression-audit.html
```
**Classification: generated report/output artifacts**, not source. Same
category as the earlier CacheVault false-alarm this session already
resolved (report/output HTML, not repo contamination). Low priority —
likely safe to discard, but not deleted here.

### `.claude/worktrees/happy-kilby-a781d0` — 10 modified files
```
 M companion-android/app/build.gradle
 M companion-android/app/src/main/java/com/lightsout/companion/CompanionUrlNormalizer.kt
 M companion-android/app/src/main/java/com/lightsout/companion/MainActivity.kt
 M companion-android/app/src/main/java/com/lightsout/companion/SubnetScanner.kt
 M companion-android/app/src/test/java/com/lightsout/companion/CompanionUrlNormalizerTest.kt
 M electron/index.html
 M electron/main.js
 M electron/preload.js
 M electron/renderer.js
 M electron/styles.css
```
```
 10 files changed, 226 insertions(+), 28 deletions(-)
```
**Classification: real, substantial source changes** — spans both the
Android companion app and Electron main/renderer/preload. This is the one
worktree in this list that touches `main.js`/`preload.js` (the protected
timer/power/IPC surface per this session's standing rules) with real
insertions, not just formatting. Worth a deliberate look before any
decision — this reads like genuine in-progress feature work, not noise.

### `.claude/worktrees/nice-knuth-8a62fc` — 1 untracked entry
```
?? companion-mobile/
```
**Classification: untracked new directory** (a `companion-mobile/` tree,
not yet added to git). Unknown size/scope from status alone — worth a
`git status` inside the directory before any decision, not evaluated
further here per the read-only constraint.

### `.claude/worktrees/pc-shutdown-timer-issue-ea5e84` — 1 untracked entry
```
?? dist-native/
```
**Classification: build artifact directory**, same kind of output this
session's own `npm run build` produces. Not source — regeneratable, safe
to ignore.

### `.claude/worktrees/peaceful-matsumoto-fe7c9f` — 3 changes
```
 D "Lights Out.lnk"
 M electron/package.json
 M electron/renderer.js
```
```
 Lights Out.lnk        | Bin 1802 -> 0 bytes
 electron/package.json |  34 +++-------------------------------
 electron/renderer.js  |   6 +++++-
 3 files changed, 8 insertions(+), 32 deletions(-)
```
**Classification: mixed.** The deleted `Lights Out.lnk` is a Windows
shortcut file (binary, 1.8KB) — likely accidental tracking/cleanup, not
meaningful content. `package.json` lost 34 lines net -32/+2 — a real
config change worth understanding before assuming it's safe (could be a
legitimate script cleanup or an accidental truncation). `renderer.js`'s
6-line change is small. Not evaluated further here per the read-only
constraint.

### `.claude/worktrees/stupefied-mcclintock-a918bf` — 2 modified files
```
 M electron/renderer.js
 M electron/scripts/night-modes-electron-proof.js
```
```
 2 files changed, 12 insertions(+)
```
**Classification: small source change**, additions only (no deletions) —
reads like a small in-progress fix plus a matching proof-script update.

### `.kilo/worktrees/liberating-haze` — 1 deleted file
```
 D "Lights Out.lnk"
```
**Classification: trivial** — same shortcut-file deletion as
`peaceful-matsumoto-fe7c9f` above. Two separate worktrees independently
removing the same tracked `.lnk` file suggests it plausibly shouldn't be
tracked in git at all, but that's a canonical-repo decision, not something
to infer from a stale worktree.

## 5. Non-git leftover directories

```
C:\Users\KickA\Desktop\Lights-Out-pr37-menu-diagnostic
```
**No `.git` present.** Contains only an `electron\` folder dated 2026-07-24.
Not a checkout — a diagnostic export left behind, disconnected from any
repo history.

## 6. Recommendation

- **All future Lights Out work should start from `C:\Users\KickA\Desktop\Lights Out`.**
  It's the canonical checkout this session has been using, it's clean, and
  it's synced with origin.
- **Do not use `C:\Users\KickA\Projects\Active\Lights Out`** unless
  explicitly and deliberately chosen for a specific reason — it's a fully
  separate, independently-writable clone of the same branch, which is
  exactly how the unreviewed `35a2a49` commit happened.
- **Do not treat any `.claude/worktrees/*` or `.kilo/worktrees/*` directory
  as canonical.** They're isolated task worktrees, several with real
  uncommitted work sitting in them.
- **Before deleting any dirty worktree**, archive or review its diff —
  `happy-kilby-a781d0` in particular looks like real feature work touching
  protected `main.js`/`preload.js`, not disposable scratch output.
- **Cleanup (removing stale worktrees, deciding what to do with dirty
  changes) should be planned as its own separate pass** — this report is
  custody/inventory only, not a cleanup plan.
