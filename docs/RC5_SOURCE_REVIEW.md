# RC5 source review — draft only

This branch captures the already-qualified Windows `11.2.1-rc.5` source for
review. It does not merge, publish, sign, install or rebuild the candidate.
The prior `v11.2.0` public release remains unchanged.

The restored development anchor is
`0b0b69826847b5d749db5858062ec82411bef8ef`. The branch retains that existing
history, including work not yet merged into public `main`. Its new commit copies
only 135 hash-pinned RC5 application, build, documentation and regression-test
files from the qualification chain. Unrelated dirty Android edits and other
untracked development files are excluded.

## Product behavior

- Supported Windows Sleep/Hibernate uses the native helper's capability and
  privilege checks, readiness/commit protocol and documented `SetSuspendState`
  API. Unsupported or denied states block safely. Receipts distinguish accepted
  requests from physical outcomes, which remain unverified.
- The restored cockpit and living lamp remain. Idle shows local time; running
  shows countdown plus current time; paused countdowns retain a live clock.
- Test Mode timer/ritual sessions suppress their automatic external effects.
  Manual device controls and independent alarms remain separate live features.
- New Wi-Fi blocking is disabled by the candidate's immutable policy. This
  prevents new orphaned blocks; durable recovery of older blocks is unfinished.
- A portable-only startup marker binds both direct EXE and launcher entries to
  sibling `user-data` before feature modules load. Invalid/conflicting paths fail
  safely. Source/installed editions remain unmarked and keep existing behavior.
- Existing receipt persistence and expanded credential protection are retained.
  Older-build credential compatibility remains a promotion consideration.

## Frozen artifact and source identity

| Identity | Value |
| --- | --- |
| Qualified ZIP SHA-256 | `ff80345ffe9c9e16dfff9dc7dee68569542b1df5cd50adb9ffa4de577a7a78e0` |
| Qualified EXE SHA-256 | `5becfb21039014cfd9f24e8d37fd70d8b571c2818e02954079a13cd3bc69e1ec` |
| Packaged application tree SHA-1 | `c9168852b47507cd105239d5bd4c291761c4caac` |
| Packaged input digest SHA-256 | `e5c2cf4cdc8ac13a1861114d41240521d38bfa3fae3f5da3640dfe9eb5dd784d` |
| Locked Electron | `43.7.11` |

[`rc5/source-custody.json`](rc5/source-custody.json) pins all 101 application
inputs, the dependency lock/graph, native helper and supporting qualified source
files. Its sole application build transform adds
`lightsOutDistribution: "portable"` to the staged `package.json`; the source
package stays distribution-neutral. The archived package's original provenance
correctly says it was built from uncommitted source. This later source commit
does not rewrite that archive or claim a new clean-commit binary rebuild.

Run the non-actuating source check from the repository root:

```sh
node electron/scripts/verify-rc5-source.cjs
```

It hashes the qualified source and applies the declared package transform only
in memory to verify the exact frozen application tree. It does not run a timer,
compile a helper, access a user profile, or create another candidate.

## Qualification reused

The existing engineering records cover the power protocol, clock, rehearsal
side-effect boundaries, Wi-Fi interdiction and portable startup. They are kept
as historical tranche records; their then-current publication restrictions and
candidate numbers do not describe a new release.

RC5 subsequently passed nine guarded Sandbox cases and eight guarded Windows
host checks. Its installed Desktop shortcut/profile launch passed, followed by
one native-UI-started two-second Test Mode timer. That timer saved exactly one
`dry_run_completed` receipt in RC5's isolated profile, with no native power
request, no delegated actuation and clean teardown. The prior host acceptance
receipt's payload and signature were independently verified through Reality
Gate; the later Desktop checks are separately observed local evidence, not new
signed Reality Gate receipts. Raw logs, profiles and screenshots remain local.

No completed suites or packaging were repeated for source publication. The
commit uses `[skip ci]` to avoid automatically repeating the full release-style
pipeline for this draft. The existing Windows workflow accepts stable numeric
versions and is not a qualified prerelease publication pipeline. It is unchanged.

## Remaining gates

Physical Sleep/Hibernate/Shutdown, wake/First Light, real device behavior and
overnight reliability remain unverified. No current approval permits those
actions. Public release, merge, signing, nightly replacement and history
migration require separate decisions. Source custody alone does not close them.

The working nightly application, its original history, shortcuts and rollback
were not accessed or modified while preparing this branch. Local source and
qualification evidence are preserved.
