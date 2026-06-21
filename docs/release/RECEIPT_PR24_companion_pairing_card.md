# Receipt: PR #24 - In-page companion pairing card

**PR:** https://github.com/Z3r0DayZion-install/lights-out/pull/24
**Title:** feat(companion): in-page pairing card instead of window.prompt
**Status:** Merged to `main`
**Merge commit:** `1f25b3c`
**Feature commit:** `f3abcaa`
**Base:** `522abd5` (after PR #23, the QR pairing feature)

## What changed

Replaced the native `window.prompt` cold-start fallback on the phone companion
(`electron/companion.html`) with a themed in-page **Pair this phone** card.

- Removed the blocking `window.prompt` in `resolveToken()`; it is now a pure
  URL -> `localStorage` lookup.
- Added an in-page pairing card (input + **Pair** button, Enter-to-submit,
  inline empty-state error), shown only when no token is present.
- Added an "Enter pairing code" re-pair link to the disconnected state so a
  wrong or stale token is recoverable instead of a dead end.

## What did NOT change

- Happy path is intact: a QR code / link carrying `?t=` still auto-pairs and
  strips the token from the URL/history on first visit.
- No change to the bedtime timer, shutdown behavior, or any power action.
- WebSocket pairing-token enforcement (server side) is unchanged.

## Verification

- Inline companion JS syntax-checked (extracted script block + `node --check`): OK.
- `npm run smoke`: **41/41 PASS**.
- CI on PR #24, all green:
  - Lint & Smoke: **pass** (~20-21s)
  - Package (Windows): **pass** (~2m12s-2m29s) - validates the packaged bundle
  - Publish Release: skipped (expected on a non-tag PR)
- Post-merge: local `main` fast-forwarded to `origin/main` (`1f25b3c`),
  clean working tree, merged branch deleted.

## Notes

- Not captured: a live full-app screenshot of the card. The preview-overlay
  capture wedged in a prior pass; the card is plain in-page markup gated by
  `display`, so the DOM/control logic was verified directly instead. A live
  manual screenshot remains an optional post-merge check.
- The earlier divergent local work is preserved (untouched) on the local-only
  branch `wip/local-divergent-companion` (`aa1fbd9`). It contains a stale,
  IPC-incompatible duplicate QR implementation and is kept as insurance only,
  not as product direction.
