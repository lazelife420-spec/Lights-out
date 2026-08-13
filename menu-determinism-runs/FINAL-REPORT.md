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
