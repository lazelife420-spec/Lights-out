# Lights Out PC — Visual Northstar

**Branch:** `feature/lights-out-visual-northstar`
**Status:** In progress — Last Light slice first
**Reference:** Three approved mockups (uploaded 2026-06-24)
**Constraints:** No timer logic changes. No shutdown behavior changes. No tag. No release. Smoke must stay green.

---

## 1. Three target screens

### Screen 1 — Lobby / Tonight's Run (main dashboard, idle state)

**What the mockup shows:**
- Fixed left icon sidebar: icon logo top-left, then LIB / SCH / SET nav icons, HELP and STATS at bottom, version label
- Top center header: crescent+star icon · "Lights Out PC" wordmark · "Bedtime Mode for Windows" subtitle
- Hero card (full-width, rounded): "TONIGHT'S RUN" amber label, large bold text "Weeknight · 24 min · Shutdown", clearance/ending/proof metadata row in accent colors, PLAY button (blue pill), clock ring preview (amber, right side)
- Trust-badge row (4 pills): LOCAL ONLY / FINAL CONFIRM ON / EMERGENCY CANCEL / NO CLOUD
- "Choose tonight's mode" section: horizontal card grid with icon, name, duration·action, descriptors; selected card has blue border + checkmark

**What exists today:**
- Top menubar (Power / Settings / Help) — no sidebar
- Central ring hero (full-width, with analog/digital clock face)
- Setup controls (±input, START, chips)
- Saved Profiles grid
- Session + Power Status cards
- Tabs section below

**Gap / migration plan:**
- Add left sidebar shell (CSS only, collapsed to icon-width; no routing changes yet)
- Refactor profiles grid into the "Choose tonight's mode" card style (icon + name + duration·action + descriptor)
- Add "TONIGHT'S RUN" hero card above the ring that surfaces the active/selected profile summary
- Trust-badge bar is new — add as static HTML below the hero card
- Clock ring in mockup is preview-only and amber-tinted — existing ring can be adapted
- This is the **second slice** (after Last Light)

---

### Screen 2 — Morning Proof / Mission Complete (post-session state)

**What the mockup shows:**
- Full hero card replaces the timer ring area: sunrise landscape background image (full bleed), "MORNING PROOF" amber label, "Mission complete · 11:32 PM" headline, stat pills (Action / Streak / Snoozes), DONE pill button
- Motivational copy: "Great job. You kept your promise. / Rest well. You've got tomorrow."
- Three actions: PLAY TONIGHT AGAIN (blue pill) / VIEW LEDGER / DISMISS
- Trust-badge row (same 4 pills as Lobby screen)
- Mode selector grid below (same as Lobby)

**What exists today:**
- `#morning-proof-section` is a compact card (`display:none` until triggered): small proof-icon + "Morning Proof" label + proof-body rows + View Receipts / Copy Proof buttons
- No hero replacement behavior; it sits above the tabs section

**Gap / migration plan:**
- Expand `morning-proof-section` to a full hero card that replaces the ring+setup area when visible
- Add sunrise background image treatment (CSS `background-image` with overlay gradient; no external asset dependency)
- Upgrade stat display to pills: Action / Streak / Snoozes
- Add motivational copy block
- Replace "View Receipts / Copy Proof" with "PLAY TONIGHT AGAIN / VIEW LEDGER / DISMISS"
- This is the **third slice** (after Lobby)

---

### Screen 3 — Last Light / Final Confirm (cinematic wind-down overlay)

**What the mockup shows:**
- Full-screen dark overlay with faint city skyline background texture
- "» EXIT THE GRID «" small amber label (sequence name)
- "LAST LIGHT" massive display text (white, heavy tracking)
- SVG ring countdown: blue arc, `00:05` inside, "TO DISCONNECT" sub-label, crescent icon below
- Left panel: "GRID HOLD WEAKENING" amber label + flavor text + progress bar
- Right panel: "99% GRID STABILITY" stat
- Large blue UNPLUG button (pill, full width, power icon)
- "CONFIRM FINAL DISCONNECTION" sub-label under button
- "⚠ EMERGENCY CANCEL  Ctrl+Shift+S" footer

**What exists today:**
- `#last-light-overlay` is a full-screen overlay with `.ll-stage` centered
- Has `.ll-title`, `.ll-headline`, `.ll-line`, `.ll-stamp` — text only, no ring, no UNPLUG button, no background texture, no flavor panels
- No countdown ring inside the overlay
- Sequence name and flavor text are rendered via `lastLight.js`

**Gap / migration plan — this is Slice 1:**
1. Add countdown ring SVG inside `#last-light-overlay` (reuse existing ring SVG pattern)
2. Add UNPLUG / EMERGENCY CANCEL button structure (the confirm action already exists as `applyAction()` in `main.js`; just needs a visual trigger wired to existing IPC — no logic change)
3. Add left flavor panel (sequence name badge + flavor text + progress bar)
4. Add right stat panel (grid stability % as ambient flavor)
5. Add city skyline CSS background layer (pure CSS radial/gradient treatment, no image asset)
6. Wire the ring to tick from `lastLight.js` sequence duration (already has step timing)

---

## 2. Implementation order

| Slice | Screen | Scope | Status |
|---|---|---|---|
| 1 | Last Light overlay | CSS + HTML structure only inside existing overlay; no timer/IPC logic change | **In progress** |
| 2 | Lobby / Tonight's Run | Left sidebar shell + hero card + trust badges + mode card refactor | Pending |
| 3 | Morning Proof | Hero expansion of existing proof-card | Pending |

---

## 3. CSS variables to add

```css
--ns-sidebar-width: 96px;
--ns-hero-radius: 16px;
--ns-trust-badge-bg: rgba(255,255,255,0.04);
--ns-amber: #f5a623;
--ns-amber-dim: rgba(245,166,35,0.15);
--ns-grid-bg: radial-gradient(ellipse at 50% 120%, #0a1628 0%, #050810 60%);
```

---

## 4. Asset needs

| Asset | Status | Notes |
|---|---|---|
| Sidebar nav icons (LIB/SCH/SET/HELP/STATS) | Missing | Can use Unicode/SVG inline for now; dedicated SVGs in Slice 2 |
| Sunrise background for Morning Proof | Missing | CSS gradient approximation in Slice 3; replace with real photo later |
| City skyline for Last Light | Missing | CSS radial gradient approximation in Slice 1 |
| Crescent+star logo at top center | Exists | `assets/brand/lights-out-icon.svg` — already used in header |

---

## 5. Smoke contract

All slices must pass `npm run smoke` (currently 72/72) before PR.
No IPC handlers added or removed.
No timer state changes.
`#btn-start`, `#btn-stop`, `#btn-pause`, `#btn-snooze`, `#btn-mini` must remain present.
`#last-light-overlay` must remain present with same id.
`#morning-proof-section` must remain present with same id.
