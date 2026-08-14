# v11.1.2 Menu Determinism Final Evidence Report

## Status

**REVIEW CANDIDATE — NOT MERGED / NOT TAGGED / NOT RELEASED**

Canonical V10 is accepted as the release-canonical behavioral proof for the
implementation identified below. This report records that evidence; it does not
establish a release freeze or authorize integration, tagging, or publication.

## Source identity and scope

- Authoritative branch: `test/v11.1.2-native-menu-determinism-clean-v3`
- Canonical implementation SHA: `83d6803fa82041a3a9d313ee75059a482dcfce18`
- Canonical implementation parent: `5de68ad92f1a0a48e77d826979da14df0cef9869`
- Product surface exercised: the Electron desktop application in `electron/`
- Proof scope: deterministic native-input custody for the desktop release gate,
  top-menu behavior, reused-process warm execution, packaged runtime behavior,
  and fail-closed evidence custody

Relevant late ancestry, oldest to newest:

| SHA | Attribution | Purpose |
| --- | --- | --- |
| `b63b139…` | Harness | Last pre-P1/P2 candidate; retained strong historical application evidence but superseded as the canonical candidate. |
| `09ac20d6fdbc244643a00441f08435cf53eadde3` | Harness/test | Reject invalid warm-matrix iteration counts. |
| `0d84e13319cd8536237f4d88451a7e0af4493a49` | Harness/test | Fail closed on native-worker timeout, malformed output, and worker loss. |
| `5de68ad92f1a0a48e77d826979da14df0cef9869` | Diagnostic harness/test | Preserve foreground, focus, pointer-event, and post-move menu diagnostics. |
| `83d6803fa82041a3a9d313ee75059a482dcfce18` | Package-test harness | Resolve packaged tests against the authoritative native package output. |

The final hardening sequence changed proof, diagnostic, and package-test
machinery. It did not change production application code. The byte-identical
production executable recorded below is consistent with that attribution.

## P1 — warm-iteration acceptance integrity

Commit `09ac20d…` made an explicitly supplied warm iteration count fail closed
unless it is a finite integer in the supported bounded range. It removed the
possibility that a supplied value such as zero could produce a successful but
empty warm result. Focused coverage includes zero, negative, decimal, `NaN`,
`Infinity`/non-numeric input, empty input, upper-bound overflow, and valid
values.

The final warm proof requested five iterations and the report recorded exactly
five completed iterations.

## P2 — native-worker liveness and fail-closed behavior

Commit `0d84e13…` gave every pending native-worker request a bounded timeout and
rejects unresolved work when the worker exits, including exit zero with pending
requests. Malformed or unusable responses reject, request timers are cleared on
all terminal paths, and requests after worker termination are prevented.
Focused coverage includes normal response, timeout, malformed response,
nonzero exit, zero exit with pending work, unusable response, termination, and
cleanup.

P1 and P2 remained intact through all later diagnostic and package-test work.

## Settings-menu investigation

Historical intermittent Settings-menu closure was observed twice before
instrumentation, remained formally unresolved as to its original trigger, and
was subsequently not reproduced in 10/10 consecutive controlled instrumented
Q3 cases with verified child-process exit custody.

The two historical failures are not erased or reclassified as never having
occurred. They did not demonstrate a production defect, and the preserved
evidence was insufficient to distinguish definitively among the adjudication
buckets. No production menu correction was therefore justified.

Commit `5de68ad…` added diagnostic observation only. It preserved five-stage
worker foreground chronology, continuous browser focus/blur and visibility
tracing, move correlation IDs, before/after menu geometry and state,
post-move `elementFromPoint()` ancestry, and pointer/mouse event traces. The
existing Settings-open assertion and foreground/input behavior were not
weakened or changed.

### Q1, Q2, and Q3 custody history

- **Q1: invalid and uncounted.** Its report contained useful passing application
  evidence, but the orphaned gate child's actual operating-system exit code was
  not recovered. The case did not satisfy the evidence-custody contract.
- **Q2: invalid and uncounted.** The external launcher split the space-containing
  gate-script path and Node attempted to execute an incomplete path. Electron
  never launched; no menu or native-input behavior was exercised. Cases 02–10
  were not started.
- **Q3: 10/10 controlled quarantine pass.** Before use, the external wrapper was
  validated with a harmless script whose path contained spaces. Each Q3 case
  then independently persisted child PID, actual child exit code zero, complete
  wrapper custody, and a passing report. Settings remained open after the
  submenu move in all ten cases, foreground samples were stable at the critical
  moves, retries and numeric power actions were zero, and cleanup was complete.

Q1 and Q2 remain preserved launcher/evidence failures and are not rewritten as
product failures or counted as passing quarantine cases.

## Packaged-output and smoke-contract correction

The native Windows pipeline intentionally produces:

`dist-native\win-unpacked\Lights Out.exe`

The packaged smoke scripts still contained obsolete `dist/` artifact
resolution. Commit `83d6803…` introduced one shared resolver used by packaged
smoke/truth paths. The resolver defaults to the authoritative `dist-native`
executable, preserves supported explicit overrides, handles paths containing
spaces, reports a clear missing-artifact failure, and does not silently fall
back to a stale `dist` executable. The native package layout and production
runtime were not changed.

## Fresh pre-matrix on the canonical implementation

The complete pre-matrix was rerun from clean immutable HEAD `83d6803…` after the
package-test correction. Recorded results:

| Gate | Result |
| --- | --- |
| `npm ls --all` | PASS |
| `npm audit` | PASS, zero vulnerabilities |
| `npm audit --omit=dev` | PASS, zero vulnerabilities |
| Lint | PASS |
| Syntax inventory | 94/94 PASS |
| Packaged-artifact resolver | 6/6 PASS |
| Harness/targeting focused tests | 102/102 PASS |
| Complete Node tests | 421/421 PASS |
| Desktop smoke | 261/261 PASS |
| Companion smoke | 15/15 PASS |
| Fresh native package build | PASS |
| Packaged smoke and packaged truth | PASS |
| Native packaged truth | PASS |
| Packaged network proof | PASS |
| Companion v2 runtime proof | PASS |
| Night Modes runtime proof | PASS |
| Receipt-recovery runtime proof | PASS |
| Window-geometry runtime proof | PASS |

Packaged smoke/truth launched and exercised the freshly built authoritative
native executable; it did not merely test file presence.

## Fresh package custody

The package inventory records source SHA `83d6803…`, parent `5de68ad…`, the
authoritative branch, and a clean tree.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist-native\win-unpacked\Lights Out.exe` | 225,784,320 | `2A630319C42CC33074B10EEBADBCDFEECCA13FA1EEFCAE746442ED52693E5E87` |
| `dist-native\Lights-Out-Portable-v11.1.2-win-x64.zip` | 153,892,898 | `663DF2DD2BB044A42547F9ECA620AC41F194023904194CDAD1600E6A0E1957A6` |

The executable hash remained unchanged across the late harness-only work.

## Canonical V10

Canonical V10 ran against exact clean HEAD `83d6803…` using the validated
external child-exit custody mechanism and a read-only foreground observer.
Every case was accepted only after the wrapper recorded the exact child exit,
the gate report passed, the report was copied into the external evidence
archive, and the process/firewall/tree baseline was clean.

### Cold matrix

- Ten independently launched cases: **10/10 PASS**
- Child operating-system exit code: zero in every case
- Wrapper custody: complete in every case
- Report status: passed in every case
- Canonical implementation SHA: exact in every report

### Warm matrix

- One continuous reused-process invocation
- Requested iterations: 5
- Completed iterations: **5/5 PASS**
- `processReused`: true
- Restarts: 0
- Ritual modes exercised: `movie-wind-down` and `full-shutdown`
- Ending `armedNightMode`: null for every iteration

### Aggregate acceptance

| Measure | Result |
| --- | ---: |
| Total behavioral cases | **15/15 PASS** |
| Valid native-input records | 960 |
| Native-input retries | 0 |
| Same-fingerprint reactivations | 0 |
| Numeric real-power actions | 0 |
| Partial native input batches | 0 |
| Process leaks after completion | 0 |
| App-owned firewall-rule leaks after completion | 0 |
| Final worktree changes | 0 |

The final independent evidence audit found eleven archived reports (ten cold
and one five-iteration warm report), all passing at the exact implementation
SHA. It inspected all 960 native-input records and found no retries or partial
`SendInput` batches. The external canonical runner finished with status
`complete`, exit zero, ten accepted cold cases, and five accepted warm
iterations.

## Known non-blocking historical evidence

- V6 remains supporting historical evidence at 15/15; its five warm iterations
  were actually observed. It is not the final release-canonical proof after the
  P1/P2 harness defects were discovered.
- V7 stopped on a foreground abort.
- V8 stopped on an invalid preflight/foreground condition.
- V9 was superseded before canonical execution by discovery of P1/P2.
- The two pre-instrumentation Settings closures remain acknowledged and
  formally unresolved as to their original trigger.
- Q1 and Q2 remain preserved invalid custody/launcher attempts, not product
  outcomes.
- Q3 and Canonical V10 provide the accepted current controlled evidence. They
  do not support a claim that the historical closures never occurred.

## Adjudication

Canonical V10 is **ACCEPTED** as the release-canonical behavioral proof for
`83d6803fa82041a3a9d313ee75059a482dcfce18`.

No production-code correction was required in the final harness-hardening
sequence. The accepted changes were limited to warm-count validation,
native-worker fail-closed behavior, evidence-preserving instrumentation, and
the packaged-output/smoke artifact contract.

This remains a review candidate. The report HEAD must pass its own clean
validation and independent immutable-head review before any later authorized
integration can establish a frozen source checkpoint.

## Independent-review observability addendum

### Independent review — first attempt

- COLD completed **10/10 PASS** at report HEAD `895278057…`.
- WARM failed before iteration 1 completed while measuring `#ns-play-btn`.
- `validateRect` established only that width was `<= 2` and/or height was
  `<= 2`; the exact raw geometry was not persisted.
- The formal classification remains **UNRESOLVED**.
- No production defect was demonstrated.

That failed WARM attempt remains preserved as a failed independent review. It
was not retroactively converted into a pass by later diagnostic evidence.

### Follow-up diagnostic

Diagnostic commit `bdc663a365bdc2ed08cc503c71722ebc84977f3d` added
pre-validation geometry, style, ancestor, renderer-state, viewport, and
failure-screenshot observability without changing production behavior or the
`validateRect` acceptance contract. The same change was integrated onto this
PR branch as a separate test-only commit.

One custody-controlled, instrumented reused-process WARM diagnostic then
completed **5/5 PASS** with 160 valid native-input records. Its first Start
measurement was `234.025 x 37.600` CSS pixels; `#ns-play-btn` resolved once and
was connected, the route was `lib`, the renderer was idle, Dry Run was true,
and the hero was visible. Retries, numeric real-power actions, process leaks,
and app-owned firewall-rule leaks were all zero.

The original geometry failure was not reproduced. It remains acknowledged and
formally unresolved; the diagnostic pass supplies no retroactive acceptance
credit.

## Independent review — second attempt, and the cursor-settlement investigation

### Final independent review attempt 1

- COLD-01: **PASS**
- COLD-02: **PASS**
- COLD-03: **ABORT** — external foreground custody loss to Antigravity IDE.
  Expected foreground: Lights Out. Actual foreground at the failed request:
  Antigravity IDE. No gesture was issued, no `SendInput` occurred, cursor did
  not move, retries were zero. This was the safety guard behaving correctly,
  not a product, native-input, or targeting defect.
- COLD-04 through COLD-10: not started.
- WARM: not started.

Attempt 1 was preserved as-is and not resumed.

### Final independent review attempt 2

- COLD-01: **FAIL**
  - requested: `(1597,718)`
  - immediate readback: `(1377,385)`
  - delta: `(-220,-333)`
  - the readback exactly equaled the previously-observed cursor position
    (an apparent complete non-move)
  - `actualStrictInterior`: `false`
  - foreground custody was not implicated: `foregroundChronology` was empty
    for this request by instrumentation design (chronology sampling was, at
    the time, wired only for pointer `move` requests, not `click`), not
    because no foreground evidence existed
  - specific historical cause: **UNRESOLVED**
- COLD-02 through COLD-10: not started.
- WARM: not started.

Attempt 2 was stopped at COLD-01 per the standing failure policy: no retry,
no code change, evidence preserved for adjudication.

### Cursor-custody environment characterization

Read-only adjudication of the COLD-01 failure, using diagnostic-only
instrumentation added to `native-input-worker.ps1`/`native-input-targeting.js`
(cursor-before-`SetCursorPos`, `SetCursorPos` `GetLastWin32Error`,
`GetClipCursor` before/after, virtual-screen and per-point monitor
geometry/DPI, worker process DPI-awareness, session identity, and broadened
foreground-chronology sampling to cover `click` requests) established:

- The dx/dy sign convention (`actual − intended`) was confirmed correct from
  source; not a diagnostic/logging defect.
- A subsequent instrumented COLD run hit a *different* cursor-custody
  rejection at a different control (`#modal-close`): requested `(2275,327)`,
  readback `(2277,329)`, delta `(+2,+2)`, `actualStrictInterior: true` (the
  miss stayed inside the real 28×28px button). Foreground, `ClipCursor`,
  monitor, and DPI evidence were all clean for this occurrence.
- An **external, out-of-repo, non-Electron Win32 probe**
  (`cursor-probe.ps1`, not part of this repository) characterized raw
  `SetCursorPos` → `GetCursorPos` behavior on this exact desktop/session
  directly, independent of Electron or the native worker:
  - 40 measured target moves: **39 exact, 1 large transitional readback**
    (immediate sample landed at essentially the pre-move position, then
    visibly migrated toward and past the requested target over the
    following ~47ms of sampling), 0 stable ±1/±2-pixel results.
  - A corroborating staging-move anomaly showed the same in-flight-read
    shape on a separate occasion.
  - This demonstrates that an immediate `GetCursorPos` right after a
    successful `SetCursorPos` can, on this exact machine, occasionally
    return a stale/in-flight position that only converges over the
    following tens of milliseconds — not that Windows legitimately settles
    a permanent multi-pixel displacement away from the requested point.
  - This does **not** retroactively prove what caused the specific COLD-01
    `-220,-333` event. It establishes that a demonstrated local mechanism
    exists that is consistent with that class of event. COLD-01's specific
    historical cause remains **UNRESOLVED**.

### Settlement-gate harness correction

- **Initial implementation**: `1d84abb` (cursor-environment observability,
  cherry-picked from diagnostic commit `89a3b4c40a5ce2e06e8d4c5b10ebf0d6efa03750`),
  `0d83abd` (bounded cursor-custody settlement gate replacing the single
  immediate `GetCursorPos` readback with a bounded poll for a stable run of
  samples, cherry-picked from diagnostic commit `b2c2de7c8ea638ba769d25addb763a1791c1908f`).
- **Live proof of `0d83abd` found a real defect**: the settlement loop
  qualified a sample by its step distance from the *previous* sample only,
  which permitted cumulative drift away from the original `SetCursorPos`
  target to accumulate and still be accepted — silently disagreeing with the
  pre-existing, unchanged, redundant JS-side `assertCursorCustody` check,
  which has always measured distance from the original requested point.
  Classified **SG1 — SETTLEMENT-GATE ACCEPTANCE CONTRACT DEFECT**. Not a
  reproduction of COLD-01, not foreground theft, not a production defect.
- **Correction**: `89ede81` (cherry-picked from diagnostic commit
  `05840fb418136bf81646ff113f4f078715670e79`). Every sample is now required
  to independently satisfy the exact same absolute
  `abs(sample − requestedPoint) ≤ 1px` contract `assertCursorCustody`
  enforces (never distance from the previous sample alone), on top of the
  existing strict-interior/foreground/consecutive-stability requirements. A
  structural consistency test (`evaluateCursorSettlement` acceptance always
  also passes `assertCursorCustody` unchanged) guards against the two
  disagreeing again. `assertCursorCustody` itself was not modified. Tolerance
  was not widened at any point (`±1px` unchanged throughout).

Final corrected contract: exactly one `SetCursorPos` call; a bounded
(250ms) poll requiring 3 consecutive samples each independently within
±1px of the original requested point, strict-interior of the target, with
foreground custody intact; an immediate final pre-`SendInput` re-check
against the same criteria; fail-closed on timeout or foreground loss; no
position retry, ever.

### Corrected live diagnostic (development evidence, not independent acceptance)

One controlled COLD run of the desktop UX functional gate against the
corrected settlement gate: **PASS** — all 6 phases (`startup`, `top-menu`,
`shared-start`, `use-tonight`, `settings`, `active-run`) completed.

- native inputs: 80
- settlement-chronology-tracked requests: 67
- immediate settlements: 67/67
- delayed settlements: 0
- streak resets: 0
- transient (>±1 from requested point) samples: 0
- maximum observed settlement duration: ~55ms (bounded at 250ms)
- position retries: 0
- real power actions: 0
- process/firewall leaks after completion: 0
- worktree: clean

This diagnostic run is development/regression evidence for the settlement
correction. It is **not** an independent-review acceptance run and carries
no acceptance credit toward the 15-case COLD/WARM matrix.
