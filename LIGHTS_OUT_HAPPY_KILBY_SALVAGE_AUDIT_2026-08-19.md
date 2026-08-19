# Lights Out — `happy-kilby-a781d0` Salvage Audit

**Date:** 2026-08-19
Read-only audit of one worktree only. Nothing edited, reset, cleaned, staged,
committed, merged, cherry-picked, copied, built, or pushed while gathering
this report.

---

## 1. Exact repo state

```
Path:   C:\Users\KickA\Desktop\Lights Out\.claude\worktrees\happy-kilby-a781d0
Branch: claude/coedex-latest-changes-6415ab
HEAD:   e8dd021  fix(companion-android): auto-recover when the desktop's
                 LAN IP changes (2026-07-10 01:09)
```

`git status --short`:
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

`git diff --stat`: 10 files changed, 226 insertions(+), 28 deletions(-).

**Relation to canonical `origin/feat/steam-shell-phase1` @ `465fc29`:**
`e8dd021` (this worktree's HEAD) **is a direct ancestor of `465fc29`** —
`git merge-base HEAD 465fc29` returns `e8dd021` itself, and
`rev-list --left-right --count HEAD...465fc29` is `0  142`. In plain terms:
this worktree has committed *nothing* unique — its branch tip is just an old
point canonical has since passed. **Everything of interest here is the
uncommitted working-tree diff on top of a base that is 142 commits stale.**
That staleness is the central fact driving every classification below —
canonical has moved a long way in some of these exact files since July 10.

---

## 2 & 3. Changed files — diff summary, classification, protected-surface check

### `companion-android/app/build.gradle`
**Diff:** `versionCode 1 → 2`, `versionName '1.0' → '1.1'`.
**PROVEN CONFLICT — do not port as-is.** Canonical independently bumped
this exact file to `versionCode 2` / `versionName '11.1.1'` on 2026-07-19
(`c051a9a`), then added 37 lines of mandatory release-signing config
(`11af211`, same day). Canonical is already at versionCode 2 under a
different, already-shipped versioning scheme. This worktree's `1 → 2` /
`'1.0' → '1.1'` would not apply cleanly and would be wrong even if it did —
the next real bump needs to be `2 → 3`, not `1 → 2`.
**Protected surface:** packaging/release config — yes, and this is exactly
the part that's obsolete.

### `companion-android/.../CompanionUrlNormalizer.kt`
**Diff:** adds `hostOf(url)` (extract host, null-safe) and
`shouldInvalidateStaleToken(newHost, tokenInUrl, storedTokenHost)` (decides
whether a saved pairing token belongs to a different PC and must not be
reused). Both are pure functions, well-commented, appended after the
existing `buildUrl()`.
**LIKELY safe to port, low risk.** Canonical touched this same file once
since (`31b7a81`, adds `redactForLog()`, inserted *before* `buildUrl()`) —
a different function, in a different part of the file, no textual or
functional overlap with this worktree's two additions. Still unported:
grepped current canonical source, neither `hostOf` nor
`shouldInvalidateStaleToken` exist there today.
**Protected surface:** none — Android-only, no Electron IPC/timer/power
involvement.

### `companion-android/.../MainActivity.kt`
**Diff:** adds a `scanGeneration` counter bumped on every navigation
(`showWeb`, `showSetup`) and on `onPause`; a subnet scan captures the
generation at start and checks it before acting on its result, so a scan
that outlives the screen it was launched for can no longer yank the UI back
or write to paused state. Also wires the new `hostOf`/
`shouldInvalidateStaleToken` helpers into `showWeb()` to drop a stale
cross-host token, and adds a `KEY_TOKEN_HOST` preference to track which
host a saved token belongs to.
**LIKELY still-valid bug fix, RISK on direct application.** Canonical
touched this file 3 times since this worktree's base
(`85953c7` harden pairing recovery / `5442ad1` recover from offline hosts /
`31b7a81` redact credentials) — different concerns (localStorage token
migration, load-timeout handling, log redaction), not the same bug, so
**no functional conflict**. But the file has genuinely drifted: new fields
(`mainHandler`, `loadTimeout`), a new `capturePersistedPageToken()`
function, and more logic packed into `handleLoadFailure()` than existed at
this worktree's base. **A literal patch/cherry-pick will not apply
cleanly** — confirmed by checking current canonical source: it still calls
`SubnetScanner.findCompanion(applicationContext) { foundHost -> ... }` with
the old 2-argument signature, and `KEY_TOKEN_HOST` does not exist there.
The underlying race condition and cross-host-token bugs this worktree fixes
**are still present in canonical today, unfixed by another path** — this
is real, still-needed work, but porting means re-authoring against the
current file, not applying this diff directly.
**Protected surface:** Phone Companion runtime — yes. This is the file to
be most careful with; it's also the one with the clearest evidence of still
being a live, unfixed bug.

### `companion-android/.../SubnetScanner.kt`
**Diff:** two independent fixes. (1) `ownSubnetBase()` now prefers a
network with `TRANSPORT_WIFI` specifically over `cm.activeNetwork`, because
an active VPN or "private DNS as VPN" profile (Google Fi, NextDNS, MDM)
commonly makes `activeNetwork` resolve to the VPN tunnel, causing the scan
to probe the wrong subnet entirely and never find the desktop. (2)
`findCompanion()` gains an `isCancelled: () -> Boolean` parameter, polled
between probes and before the final callback, so a superseded scan can bail
early instead of burning its ~15s/254-host budget and firing stale results.
**LIKELY still-valid, well-engineered fix.** Canonical's current
`findCompanion` signature confirmed to still be the old
`(context, onResult)` — this fix is unported and the bugs it addresses
(VPN breaking LAN discovery, wasted scan work / stale callbacks) are still
live. No canonical commits touched this file at all since the worktree's
base (0 commits, confirmed via `git log e8dd021..465fc29 -- .../SubnetScanner.kt`
scoped to this exact path).
**Protected surface:** Phone Companion runtime — yes, but this file is
untouched by canonical since the fork point, so it's the lowest-conflict-risk
file in the whole set — should apply close to cleanly.

### `companion-android/.../test/CompanionUrlNormalizerTest.kt`
**Diff:** 5 new test cases covering `hostOf()` (valid input, null/blank/
malformed) and `shouldInvalidateStaleToken()` (fresh token always wins,
same-host reconnect is not invalidated, different-host is invalidated, no
stored token is a no-op).
**PROVEN complete and correct** for what it tests — every branch of
`shouldInvalidateStaleToken`'s logic has a dedicated case. No coverage for
the `scanGeneration`/cancellation concurrency logic, but that's expected —
Activity-lifecycle/threading behavior isn't practically unit-testable
without instrumented tests, which this module doesn't otherwise have either.
**Protected surface:** none — test-only.

### `electron/index.html` + `electron/styles.css` (combined — the diff interleaves unrelated changes)

Three distinct changes bundled together:

1. **Sidebar "?" → "HELP" label.** **OBSOLETE — already fixed differently
   and better in canonical.** Current canonical already shows a real SVG
   help-circle icon with the label `"Help"` (title case, not this
   worktree's all-caps `"HELP"`) — a more thorough icon-system change than
   this worktree's plain text swap. Do not port.

2. **Header wordmark moved from absolutely-centered-over-header to its own
   row below the header**, to stop it colliding with the Power/Settings/
   Help menu. **OBSOLETE — already fixed identically, then extended,
   in canonical.** This is the single clearest finding in this whole audit:
   canonical's current CSS comment at `styles.css:5051-5053` reads
   *verbatim identically* to this worktree's version — "its own row below
   .chrome-header (not absolutely centered over it) so it can never overlap
   the Power/Settings/Help menu." Canonical made the exact same fix
   independently, then went further with a compact variant for secondary
   pages that this worktree's version doesn't have. **Do not port — would
   be a regression to the simpler, earlier version of a fix canonical has
   already improved on.** Worth noting: this worktree's own code comment
   assumed the app's "normal/default 520px window width" was real — that
   assumption was itself proven false by this session's own Phase 5H-B/C
   audit (Electron was silently clamping to ~900px the whole time; the real
   default is now 1180px with a 1024px floor). The overlap this worktree
   was defending against may not even reproduce the same way at today's
   real window widths.

3. **Sleep-debt clarity labels** — a `.debt-period` ("ALL-TIME NET") label
   next to the debt-amount figure, and a `.debt-week-heading` ("Last 7
   nights") above the per-night breakdown, so the two different time
   windows shown on that card aren't ambiguous. **LIKELY safe to port,
   genuinely still missing.** Grepped canonical for `debt-period`/
   `debt-week-heading` — neither exists. Small, presentation-only, no
   logic change, no protected surface.

**Protected surface:** none — none of these three are timer/power/IPC/
Companion runtime/schedule/packaging.

### `electron/main.js` + `electron/preload.js` + `electron/renderer.js`
**Diff (one coherent feature across all three):** when the phone companion
triggers `start`/`togglePause`/`snooze`/`cancel`, the desktop now shows an
OS notification *and* an in-app toast saying e.g. "Shutdown started from
your phone (30 min)" — a new `notifyRemoteAction()` helper in `main.js`,
a `remote-action` IPC event bridged in `preload.js`
(`onRemoteAction: (callback) => ipcRenderer.on('remote-action', ...)`), and
a renderer listener (`api.onRemoteAction?.(data => notify(data.message,
'info'))`) that follows the exact same pattern as the existing
`onRealityCheck` handler right above it. The stated intent, in the diff's
own comment, is real and reasonable: "there's no way to tell 'my phone did
this' from 'I did this and forgot.'"

**LIKELY still-valid, genuinely missing feature — RISK is in the `main.js`
application, not the concept.** Grepped canonical for `notifyRemoteAction`/
`remote-action`/`onRemoteAction` — none exist. This capability is not
present in canonical today.
- `preload.js` and `renderer.js`: their insertion anchors
  (`onBrowserWarning:` in preload, `api.onRealityCheck?.(...)` in renderer)
  are **unchanged** in canonical — these two hunks would very likely apply
  or port cleanly.
- `main.js`: **this is the file needing the most care.** Canonical's
  `handleCompanionMessage()` has structurally evolved past this worktree's
  base — the `'start'` case now reads the desktop's own persisted
  `appSettings.dryRun` and stamps `source: 'remote'` (a deliberate
  authority-hardening change: "Desktop remains authoritative over Dry Run
  ... rather than trusting the client"), and there's an entire new
  `'startNightMode'` case this worktree's version has no knowledge of. A
  literal patch will not apply — the notification calls would need to be
  re-added by hand to each current case (`start`, `startNightMode`,
  `togglePause`, `snooze`, `cancel`), not pasted in from this diff.

**Protected surface: yes, directly** — `main.js` and `preload.js` are
exactly the IPC/main-process surface this session has treated as protected
all along. The *feature* is additive (new notification calls layered onto
existing start/pause/snooze/cancel calls, not a change to what those calls
actually do), but it still touches the file governing real Phone Companion
command execution, so it deserves the same scrutiny any other main.js
change on this repo gets — full lint/smoke/test/build validation and
explicit review of the ported diff, not a blind copy.

---

## 4. Android Companion section

**What's intended:** three real, independent bug fixes plus one already-
released version bump: (1) VPN/private-DNS profiles making subnet discovery
scan the wrong network entirely, (2) a stale async subnet-scan callback
able to yank the UI back to a connection screen the user has already
navigated away from, or fire against a paused Activity, (3) a saved pairing
token from PC A being wrongly reused when auto-reconnecting/rescanning for
PC B.

**Completeness:** All three fixes read as complete, not partial — each has
a clear mechanism, is wired into every call site that needed it, and (for
the token-invalidation logic) has full test coverage. The `versionCode`/
`versionName` bump is stale and should be dropped, not treated as part of
"the fix."

**Tests:** Yes, thorough, for `CompanionUrlNormalizer`'s new functions (5
cases, all branches). No test coverage for the `scanGeneration`
cancellation logic — expected, not a gap specific to this diff (this
module has no instrumented/Activity-lifecycle test infrastructure at all).

**Recommendation for this section:** two of the three fixes
(`SubnetScanner.kt`'s Wi-Fi-transport preference and cancellation support,
`CompanionUrlNormalizer.kt`'s new functions + tests) look portable with
light effort — the files are close to canonical's current shape.
`MainActivity.kt`'s fix is conceptually still needed and still unfixed in
canonical, but needs to be re-authored against the current file rather than
patched. The `build.gradle` version bump should be discarded outright.

## 5. Electron section

**What's intended:** surface phone-triggered timer actions to the person
at the PC (notification + toast), plus two small, unrelated UI items
bundled into the same working tree (sleep-debt clarity labels — still
useful; a Help-label/wordmark-position pair — both already superseded by
independent canonical fixes).

**Are `main`/`preload` changes privileged or risky?** `preload.js`'s
addition is a straightforward one-way event bridge, same shape as the
existing `onBrowserWarning`/`onRealityCheck` pattern — low risk in
isolation. `main.js`'s changes only *add* notification calls after existing
`startTimer`/`pauseTimer`/`resumeTimer`/`snoozeTimer`/`cancelTimer` calls —
they do not change what those calls do, gate them differently, or bypass
any existing dry-run/safety check. The risk here is entirely about
**textual/structural drift** (the switch statement this worktree edited has
grown a case and gained new logic since), not about the feature being
unsafe in concept.

**Do renderer/index/styles changes conflict with current Quick Controls or
timer-preset work?** No overlap found. This session's own recent commits
touched: chip/number-key duration-selection semantics
(`60766d5`), media-pause disclosure (`92f59eb`), the Home glance grid
(`ef26a4f`), the Schedule Start button (`b83f874`), and the
`--card-border` fix (`3229290`) on top of the separately-landed Quick
Controls drawer (`35a2a49`). None of those touch the sidebar Help label,
the header wordmark, the sleep-debt card, or `handleCompanionMessage` —
zero file/region overlap with this worktree's Electron changes.

**What should be ported?** Only the sleep-debt labels (trivial, presentation-
only) and the phone-action-notification feature (needs `main.js` re-authored
by hand against the current `handleCompanionMessage`, `preload.js`/
`renderer.js` likely portable close to as-is). The Help-label and
wordmark-position changes should not be ported — they'd be regressions
against work canonical has already done better.

## 6. Salvage recommendation

**Port specific hunks — do not merge or copy the worktree wholesale.**

Proposed safe commit split, if/when this is actually done (not done here):

1. **`fix(companion-android): VPN-safe subnet detection`** —
   `SubnetScanner.kt`'s `TRANSPORT_WIFI` preference only. Lowest risk,
   zero canonical drift in this file, no protected Electron surface at all.
2. **`fix(companion-android): cancel stale subnet scans + cross-host token guard`** —
   `SubnetScanner.kt`'s `isCancelled` support, `CompanionUrlNormalizer.kt`'s
   two new functions + their 5 tests, and `MainActivity.kt`'s
   `scanGeneration`/`KEY_TOKEN_HOST` wiring — but **`MainActivity.kt` needs
   to be manually re-applied against its current shape**, not patched.
   Version bump excluded (handle separately, `2 → 3` against the real
   current versioning scheme, not `1 → 2`).
3. **`feat(companion): notify desktop when phone triggers an action`** —
   `preload.js` + `renderer.js` as close to directly as their unchanged
   anchors allow, `main.js`'s notification calls **manually re-added** to
   every current case of `handleCompanionMessage` (`start`,
   `startNightMode`, `togglePause`, `snooze`, `cancel`), full lint/smoke/
   test/build validation given it touches protected main-process code.
4. **`style(stats): clarify sleep-debt time windows`** — `.debt-period`/
   `.debt-week-heading` only. Trivial, independent of everything else.

**Explicitly discard, do not port:** `build.gradle`'s version bump, the
`"?"→"HELP"` sidebar label change, the header-wordmark positioning change.
All three are superseded by work canonical has already done, and porting
any of them would be a regression, not a fix.

**Preserve the branch/worktree itself** until the above is actually acted
on — it's the only record of this diff, and nothing here should be deleted
based on a read-only audit alone.

**No implementation performed.** This document is the audit only.
