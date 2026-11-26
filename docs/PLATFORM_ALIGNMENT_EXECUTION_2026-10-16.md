# Platform alignment: reviewed plan and evidence ledger

## Verified baseline — 2026-10-16

- Local/main, fetched origin/main and published v11.2.0: `335ba773b364dda45a26e60524cd1b95ed0b7f39`.
- Candidate branch: `codex/lights-out-platform-alignment-20261016`, isolated Git worktree from that exact commit.
- Latest release CI: [38959448381](https://github.com/lazelife420-spec/Lights-out/actions/runs/38959448381), all four jobs succeeded, including publication.
- [v11.2.0](https://github.com/lazelife420-spec/Lights-out/releases/tag/v11.2.0) is published. The supplied handoff's ee92baac/in-progress/v11.1.3 snapshot is superseded.
- Original checkout: no tracked edits; preserve all untracked reports, local files and ignored production artifacts. Two other historical detached worktrees remain untouched. No other active Lights Out Codex chat or running CI was observed; two older open PRs are not part of this tranche.
- Final custody check found 426 tracked changes in the historical temporary
  `lights-out-e2e` worktree. They were treated as foreign work and left intact;
  the original/main and historical release-gate worktrees have zero tracked edits.
- The app's managed-worktree helper returned `Not a git repository` for this chat's old project context. A normal isolated Git worktree was created instead; the main checkout was not switched.

## Inventory and product decisions

| Surface | Classification | Evidence or remaining gap |
|---|---|---|
| Windows Electron product | SHIPPED / TEST-PROVEN | v11.2.0 installer/ZIP; 1,046 units on Linux and Windows, 299 smoke checks, geometry, packaged LAN/firewall and Night Modes, 614 installed/portable files, 60 installed layouts, native six-phase/51-screenshot gate. |
| Windows downloads/provenance | PUBLISHED / TEST-PROVEN | Public downloads independently hashed and matched the qualified CI candidate; tag and manifest name the reviewed SHA. Installer SHA-256 `83c590c3de54b16b26bfeb4961858e44a225dd59c7501e77d72248a5882a37c0`; ZIP `7e855475c3f7a3e65a4921bc7d9237a1a69480514943de597f65ad3cfb273b39`. |
| Standalone native Android | SOURCE-PRESENT / TEST-PROVEN / FIELD-UNPROVEN | 53 unit tests, isolated debug build/lint, ten owned API 35 emulator phases; APK hash bound to the build and 47 application inputs matched source. No new production-signed APK. |
| Optional PC controls | SOURCE-PRESENT / TEST-PROVEN in desktop qualification | Separate remote WebView and pairing protocol; current native Android WebView/notification boundary needs an explicit coverage ledger. Historical physical pairing is not current Android field qualification. |
| Android exact alarms, reboot and WiZ acknowledgement | TEST-PROVEN / FIELD-UNPROVEN | Recent emulator/UDP proof covers permission grant, recurrence, storage-unlock reboot restoration, screen-off scheduled start/finish, duplicate/busy suppression and failed acknowledgements. No physical LAN/background guarantee. |
| Windows invisible-host objective | SOURCE-PRESENT lifecycle / UNKNOWN acceptance | Main process owns timer and tray; source has close interception and a single-instance lock. Separate close/reopen/duplicate-session proof remains a future scoped tranche; do not introduce a daemon. |
| Unified routine/action/receipt model | PLANNED | Desktop and Android own independent formats and executors. Shared schema, migrations and one bounded vertical slice need design and tests. No automatic synchronization. |
| First Light | SOURCE-PRESENT on Windows / PLANNED phone-owned morning path | Windows alarm/sunrise code exists. Phone-only morning automation, Hue/webhook field support and router adapters require separate qualification. |
| Quiet House, School Night, household expansion, Kids Mode, focus scoring, screen-time enforcement, Wake-on-LAN | DEFERRED | Preserve parked scope. |

The immediate product mismatch is documentation positioning: README, roadmap
and agent mission still lead with a Windows-only product despite real standalone
Android source. Release/CI defects from the handoff are already closed.

## Execution dependencies and exact scope

1. **Plan first (this document).** Preserve source custody and record current facts before application edits.
2. **Phase A: platform/documentation alignment.** Edit only `README.md`, `AGENTS.md`, `docs/ROADMAP.md`, and the Unreleased section of `CHANGELOG.md`. Keep one roadmap with Shipped, In-source awaiting qualification, Active next, Blocked on hardware or permissions, and Deferred sections. Keep installer/APK release trains separate and existing navigation unchanged. Link verified release evidence; do not modify the published release history or CI while green.
3. **Phase B: Android evidence and remaining safe qualification.** Add `docs/ANDROID_FIELD_QA.md`; update `companion-android/README.md` with the qualification boundary and reproducible commands. Add a narrow fixture-only lifecycle proof under `electron/scripts/android-standalone-lifecycle-proof.js` for notification denial/grant, offline operation, monotonic countdown across timezone changes, process restart, stale command rejection and screen-off completion. Reuse the existing ten-phase WiZ/calendar/reboot proof rather than repeating it. Use only an owned API 35 emulator, `.debug` package and isolated source/Gradle homes.
4. **Conditional defect repair.** Only if a new test demonstrates a defect, identify its exact native file and add a bounded regression before changing production code; re-run affected debug/unit/runtime gates. No speculative host or scheduler rewrite.
   The coverage audit also identified source-only calendar timezone and early/late
   delivery claims. Extend the same QA harness with an explicit calendar-only
   mode for those and duplicate delivery, using reversible clock changes on the
   owned emulator only. Preserve the six completed lifecycle receipts separately.
5. **C/D design boundary.** Record next acceptance gates in the roadmap; do not implement an invisible-host migration, shared scheduler, new adapters or cross-device synchronization in this tranche.

## Acceptance and safety gates

| Gate | Required result |
|---|---|
| Baseline/ref custody | Fetched source pin, clean tracked original checkout, preserved other worktrees/PRs, no concurrent repair overwritten. |
| Release evidence reuse | Inspect actual CI/artifact manifests and local native/emulator reports tied to the reviewed source; no repeat release or dependency upgrades. |
| Documentation | Windows + standalone Android are explicit; downloads exist; Android debug-only and physical HOLD are visible; planned/deferred features stay distinct. |
| Android native boundary | Bundled HTTPS asset origin owns native bridge; remote PC WebView has no native bridge; timer/service/alarms own execution without desktop protocol calls. |
| Additional Android runtime | Record exact command, exit code, device/API/package/APK hash, observed state and permission/notification outcomes. Timezone/process operations target only the owned emulator and debug app. |
| Build/source equivalence | If application inputs are unchanged, bind existing debug artifact to all current application input hashes; build again only for changed production inputs or an unresolved build concern. |
| Field QA | Checklist has expected observations and actual evidence slots; physical phone/router/bulb reliability remains HOLD until owner-authorized tests. |
| Publishing boundary | This tranche leaves a reviewable uncommitted candidate. No local commit, push, merge, release tag, `[release]` intent, public deployment or production signing. |

Never read protected credential stores, signing properties or production keys.
Never issue real power, router, network-disabling or lamp actions in qualification.
Use dry-run, owned emulator operations, fixture bulbs and isolated packages. Do
not clear/replace the production Android package or silently synchronize data.

## Outcome ledger

### Initial safe tranche (historical)

- **Phase A: PASS, uncommitted candidate.** README/agent mission now describe
  Windows + standalone Android and independent release trains. The single
  roadmap has the five requested status sections. Published v11.2.0, green CI,
  download provenance and earlier failures were verified; no CI/source repair
  or repeat publication was needed. Historical Windows-pillar and July pairing
  details remain available in the [immutable pre-alignment roadmap](https://github.com/lazelife420-spec/Lights-out/blob/335ba773b364dda45a26e60524cd1b95ed0b7f39/docs/ROADMAP.md)
  and existing roadmap archives, rather than retold as forward work.
- **Phase B: automated scope PASS; physical qualification HOLD.** Added the
  guarded lifecycle/calendar QA runner and field checklist. Twelve additional
  API 35 emulator cases passed. No Android product-code change was necessary.
- **Phase C: historical seven-case runtime qualification accepted as reported;
  secondary-startup remediation tracked below.** The reviewed v11.2.0 runtime
  passed the seven lifecycle cases, but its instrumented lock-losing secondary
  briefly created a window. It created no competing timer or receipt. The
  contained correction guards queued readiness; no daemon/service was started.
- **Phase D: PLANNED / design gate.** Existing desktop/phone recurrence and
  occurrence ownership remain independent. No shared schema migration,
  coordination, new adapter or phone-owned First Light implementation was added.

### Initial command and surface matrix (historical, not a fresh rerun)

| Command / evidence | Result | What it actually proves |
|---|---|---|
| `git fetch origin`, live refs/release/CI inspection | Exit 0; main remains the reviewed SHA | Current source, published release and green CI supersede the handoff snapshot. |
| `node --check electron/scripts/android-standalone-lifecycle-proof.js` | Exit 0 | New QA runner parses on supported Node. |
| ESLint with `electron/eslint.config.js`, targeting the new runner | Exit 0, no findings | New QA runner passes repository correctness rules; existing dependencies were reused without upgrades. |
| Lifecycle runner with `--allow-debug-reset` | Exit 0, six cases passed | Permission denial/grant, offline controls, active monotonic timer across timezone change, stale command rejection, sticky service/process restart plus UI reattach, offline screen-off completion with a registered finish notification. |
| Same runner with `--calendar-only --allow-emulator-clock-change --allow-debug-reset` | Exit 0, six cases passed | Rule retained without exact access; grant/reopen reschedules; early delivery does not consume/start; timezone recomputes or cancels a now-past one-shot; real emulator alarm plus duplicate delivery yields one run; late delivery does not consume/replace an active monotonic timer. |
| Source/APK inventory comparison | 51 of 51 exact hashes matched | Existing isolated debug APK matches current Android inputs; no rebuild was needed for documentation/QA-only changes. |
| Published release CI and prior source-bound native/emulator artifacts | Reused, not rerun | Linux/Windows 1,046 units, 299 smoke checks, Android 53 units/lint/debug build, packaged/runtime/artifact checks, native six-phase/51 screenshots and prior ten WiZ/calendar/reboot emulator phases. |
| `git diff --check` and production-path diff guard | Exit 0 | Clean patch formatting and no changes to application inputs, versions, dependencies or release workflow. |

Current debug APK SHA-256:
`becf205a918314f6b9098bd9994750a1e3682963a68f61276849d88d5e36fbfd`.
Device: owned `LightsOut_QA_API35`, `emulator-5582`, API 35. Virtual network,
timezone, clock and automatic-time setting were restored; the owned emulator
was stopped. No production package, physical bulb/router or signing key was
used. No desktop listener was required; a physically powered-off PC is still a
field-test case, not an emulator claim.

The first calendar harness attempt assumed every timezone change produced a
future occurrence. Runtime correctly returned no future time when the one-shot
became past. The harness now asserts cancellation in that case and restoration
when the original zone returns. A Windows AVD-output line-ending issue was also
corrected before app reset. Failed harness attempts are retained alongside the
successful receipts; no application defect was hidden or repaired speculatively.

Exact local invocations, overall exit codes, case observations, APK/source and
executed-runner hashes are recorded in
`review/PLATFORM-ALIGNMENT-20261016/candidate-evidence.json` and the two runtime
reports. Keep raw local/device evidence private. No commit, push, tag, release
intent, new publication, production signing or C/D feature implementation was
performed in this tranche. Original checkout and published artifacts are intact.

### Remaining gates and next tranche

Physical phone/router/bulb/OEM background and human-visible notification
reliability remain HOLD under `ANDROID_FIELD_QA.md`. Current signed-APK pairing
and production distribution need their own owner-controlled qualification.

The next action is **owner review of this isolated candidate** before any local
commit/push. The controlled Windows remediation and fresh Android proof below
supersede the earlier recommendation to begin Host lifecycle qualification.
Unified Calendar Routine Builder remains a separate future design gate.

### Controlled review remediation — 2026-10-16

**READY_FOR_OWNER_COMMIT_REVIEW.** The bounded Windows lifecycle/startup gate
passes locally. This verdict authorizes no commit or publication. v11.2.0 and
its published artifacts remain unchanged. The proposed source scope is ten
files: the original eight alignment files, `electron/main.js`, and
`electron/test/single-instance-startup.test.js`.

Verified `updater.js` and `updaterPolicy.js` use Proof Foundry machine-truth
metadata; corrected README wording. Normalized the roadmap to LF. Added four
focused tests before the correction: primary/focus/recreation passed while
lock-loss failed by executing queued startup subsystems after Quit. A three-line
guard/comment change makes all four pass without changing second-instance focus.

Fresh execution (not the historical receipts above):

| Surface | Result | Scope and limitation |
|---|---|---|
| Electron unit tests | 1,050 passed; zero skipped/failed | Includes four startup regressions. |
| Smoke and lint | 299 smoke passed; lint zero errors, one existing warning | No dependency or workflow changes. |
| Native candidate build | Portable ZIP and 614 runtime hashes verified | Isolated uncommitted QA build, not a release; installer deliberately omitted. |
| Windows instrumented race | 7/7 passed | Fresh unmodified packaged candidate; safety injection at paused main entry. |
| Windows ordinary startup | 7/7 passed | No debugger pause or resume. Separate qualification copy changes only package entry to a safety bootstrap; all 613 other runtime files, including main, match the fresh build. |
| Android lifecycle | 6/6 passed | Actual API 35 emulator execution with the final harness. |
| Android calendar | 6/6 passed | Same final harness; virtual clock changes confined to the owned emulator. |

Both Windows modes observed zero secondary windows/trays, timer starts, startup
service registrations or receipt calls. Close-to-tray, hidden progress and
completion, pause/resume/cancel, intentional Quit, explicit crash recovery and
single receipt authority passed. Test Mode and the independent QA power lock
were active; process-local guards blocked network/system/device effects. No
power command or forbidden side-effect request occurred. Firewall snapshots
matched and all owned roots/inspectors exited. The ordinary safety bootstrap is
test infrastructure, not a shipping architecture change or uninstrumented
production-session claim.

Two Windows harness failures are preserved: an early inspector evaluation
reported a collected promise; a fixed 1.2-second observation was too short under
concurrent emulator load. The final harness waits for observable progress with
a deadline. Neither required another product change.

Android's 51 application input hashes match the existing isolated debug APK;
no product-source/signing change or APK rebuild was necessary. Both fresh modes
used harness SHA-256
`da6cc4ea53306dc49fd8c1d4cac3f4bb7a73fbd27c577600e065d119ec8f0dc3`.
The earlier lifecycle pass used a different harness revision and remains
historical evidence. Fresh commands, full reports and exact source/artifact
hashes are in `review/REMEDIATION-20261016/QUALIFICATION.json` and its portable
review packet. Virtual network, timezone, clock and automatic-time settings were
restored; the debug app was force-stopped and the owned emulator stopped.

Foreign worktree status/index fingerprints remain unchanged, including all 426
deleted tracked paths. This proves preservation during the recorded review
window, not historical byte-level custody before the first detailed snapshot.
No files were staged; no commit, push, merge, tag, publication, signing,
production update or protected credential access occurred. Physical Android,
WiZ/router and production Android distribution remain HOLD. Unified calendar,
new adapters and all deferred features remain outside this candidate.
