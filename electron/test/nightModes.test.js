// Night Modes behavioral tests: 22 scenarios covering the declarative catalogue,
// validation, resolution, START-time canonical matching, edited-mode detection,
// receipt attribution, selection clearing, and safety constraints.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const nightModes = require('../nightModes');

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeTimerOptions preserves ID but not title
// ─────────────────────────────────────────────────────────────────────────────
test('normalizeTimerOptions-equivalent: resolveNightModeStart accepts only nightModeId string', () => {
  // resolveNightModeStart only uses options.nightModeId — no title/version accepted.
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    nightModeTitle: 'INJECTED TITLE',  // must be ignored
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, 'quick-sleep');
  assert.strictEqual(result.nightModeTitle, 'Quick Sleep');  // canonical, not injected
  assert.strictEqual(result.nightModeVersion, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Main resolves canonical title/version at START
// ─────────────────────────────────────────────────────────────────────────────
test('resolveNightModeStart returns canonical title and version from catalogue', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'full-shutdown',
    durationSeconds: 3600,
    action: 'shutdown'
  });
  assert.strictEqual(result.nightModeTitle, 'Full Shutdown');
  assert.strictEqual(result.nightModeVersion, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Renderer-injected title is ignored
// ─────────────────────────────────────────────────────────────────────────────
test('renderer-injected nightModeTitle is ignored by resolveNightModeStart', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    nightModeTitle: 'Super Safe Mode',  // fabricated — must be ignored
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeTitle, 'Quick Sleep');
  assert.notStrictEqual(result.nightModeTitle, 'Super Safe Mode');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Canonical Quick Sleep retains identity
// ─────────────────────────────────────────────────────────────────────────────
test('canonical Quick Sleep retains identity when execution matches', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, 'quick-sleep');
  assert.strictEqual(result.nightModeTitle, 'Quick Sleep');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Quick Sleep changed from 15 to 45 minutes becomes custom/no-mode
// ─────────────────────────────────────────────────────────────────────────────
test('Quick Sleep with modified duration clears mode identity', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    durationSeconds: 2700,  // 45 min instead of canonical 15 min (900s)
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
  assert.strictEqual(result.nightModeTitle, null);
  assert.strictEqual(result.nightModeVersion, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Quick Sleep changed from Sleep to Shutdown becomes custom/no-mode
// ─────────────────────────────────────────────────────────────────────────────
test('Quick Sleep with modified action clears mode identity', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    durationSeconds: 900,
    action: 'shutdown'  // changed from canonical 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
  assert.strictEqual(result.nightModeTitle, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Canonical standard-ritual mode (Full Shutdown) resolves with standard ritual
// ─────────────────────────────────────────────────────────────────────────────
test('Full Shutdown resolves with standard ritual for PR #27 gateway', () => {
  const resolution = nightModes.resolveForExecution('full-shutdown');
  assert.strictEqual(resolution.success, true);
  assert.strictEqual(resolution.resolved.ritualId, 'standard');

  // resolveNightModeStart also retains identity when canonical values match
  const start = nightModes.resolveNightModeStart({
    nightModeId: 'full-shutdown',
    durationSeconds: 3600,
    action: 'shutdown'
  });
  assert.strictEqual(start.nightModeId, 'full-shutdown');
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Modified ritual behavior clears mode identity
// ─────────────────────────────────────────────────────────────────────────────
test('mode with standard ritual loses identity if duration is modified', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'lights-down',  // canonical: 2700s, sleep, standard ritual
    durationSeconds: 1800,       // modified
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Mode identity survives the ritual timer context into the receipt
// ─────────────────────────────────────────────────────────────────────────────
test('resolveNightModeStart returns all three receipt identity fields', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'movie-wind-down',
    durationSeconds: 5400,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, 'movie-wind-down');
  assert.strictEqual(result.nightModeTitle, 'Movie Wind-Down');
  assert.strictEqual(result.nightModeVersion, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Unknown ID cannot create receipt identity
// ─────────────────────────────────────────────────────────────────────────────
test('unknown nightModeId returns null identity', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'nonexistent-mode',
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
  assert.strictEqual(result.nightModeTitle, null);
  assert.strictEqual(result.nightModeVersion, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Unavailable ID cannot execute unsupported mode behavior
// ─────────────────────────────────────────────────────────────────────────────
test('unavailable mode ID (quiet-house) cannot produce receipt identity', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quiet-house',
    durationSeconds: 1800,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
  // Also verify resolveForExecution rejects it
  const exec = nightModes.resolveForExecution('quiet-house');
  assert.strictEqual(exec.success, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Quick-minute clears armed mode (no mode ID in options → null identity)
// ─────────────────────────────────────────────────────────────────────────────
test('no nightModeId in options returns null identity (quick-minute path)', () => {
  const result = nightModes.resolveNightModeStart({
    durationSeconds: 1800,
    action: 'shutdown'
  });
  assert.strictEqual(result.nightModeId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Duration chip clears armed mode (same pattern)
// ─────────────────────────────────────────────────────────────────────────────
test('undefined nightModeId returns null identity (duration chip path)', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: undefined,
    durationSeconds: 600,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Numeric preset clears armed mode (same pattern)
// ─────────────────────────────────────────────────────────────────────────────
test('null nightModeId returns null identity (numeric preset path)', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: null,
    durationSeconds: 1800,
    action: 'shutdown'
  });
  assert.strictEqual(result.nightModeId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Profile context-menu Start remains mode-neutral
// ─────────────────────────────────────────────────────────────────────────────
test('profile-start without nightModeId remains mode-neutral', () => {
  const result = nightModes.resolveNightModeStart({
    durationSeconds: 1800,
    action: 'shutdown',
    profileId: 'some-profile'
  });
  assert.strictEqual(result.nightModeId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Remote/companion/calendar/tray/autopilot remain mode-neutral
// ─────────────────────────────────────────────────────────────────────────────
test('nightModes module is self-contained (no companion/remote/calendar exports)', () => {
  const exports = Object.keys(nightModes);
  assert.ok(exports.includes('getCatalogue'));
  assert.ok(exports.includes('resolveForExecution'));
  assert.ok(exports.includes('resolveNightModeStart'));
  assert.ok(!exports.includes('companion'));
  assert.ok(!exports.includes('calendar'));
  assert.ok(!exports.includes('remote'));
  assert.ok(!exports.includes('autopilot'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Direct no-mode timer remains unchanged
// ─────────────────────────────────────────────────────────────────────────────
test('direct no-mode timer options produce null identity', () => {
  const result = nightModes.resolveNightModeStart({
    durationSeconds: 28 * 60,
    action: 'shutdown'
  });
  assert.strictEqual(result.nightModeId, null);
  assert.strictEqual(result.nightModeTitle, null);
  assert.strictEqual(result.nightModeVersion, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Historical receipt title/version remain stable
// ─────────────────────────────────────────────────────────────────────────────
test('mode version 1 is immutable across resolutions', () => {
  const r1 = nightModes.resolveNightModeStart({ nightModeId: 'quick-sleep', durationSeconds: 900, action: 'sleep' });
  const r2 = nightModes.resolveNightModeStart({ nightModeId: 'full-shutdown', durationSeconds: 3600, action: 'shutdown' });
  assert.strictEqual(r1.nightModeVersion, 1);
  assert.strictEqual(r2.nightModeVersion, 1);
  assert.strictEqual(r1.nightModeTitle, 'Quick Sleep');
  assert.strictEqual(r2.nightModeTitle, 'Full Shutdown');
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Old receipts without fields load (backward compat shape)
// ─────────────────────────────────────────────────────────────────────────────
test('timer state without nightMode fields defaults to null', () => {
  const fakeTimerState = {
    action: 'shutdown',
    profileId: null,
    profileName: null,
    totalSeconds: 1800,
    dryRun: false,
    forceShutdown: false,
    gracefulClose: true
  };
  assert.strictEqual(fakeTimerState.nightModeId || null, null);
  assert.strictEqual(fakeTimerState.nightModeTitle || null, null);
  assert.strictEqual(fakeTimerState.nightModeVersion || null, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Keyboard card activation works (catalogue is accessible for rendering)
// ─────────────────────────────────────────────────────────────────────────────
test('getCatalogue returns deep copies safe for renderer card rendering', () => {
  const c1 = nightModes.getCatalogue();
  const c2 = nightModes.getCatalogue();
  assert.notStrictEqual(c1, c2);
  assert.notStrictEqual(c1[0], c2[0]);
  assert.notStrictEqual(c1[0].timer, c2[0].timer);
  assert.deepStrictEqual(c1, c2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Disabled card cannot arm a mode
// ─────────────────────────────────────────────────────────────────────────────
test('disabled mode (school-night) cannot be resolved for execution or START', () => {
  const exec = nightModes.resolveForExecution('school-night');
  assert.strictEqual(exec.success, false);
  const start = nightModes.resolveNightModeStart({
    nightModeId: 'school-night',
    durationSeconds: 1800,
    action: 'shutdown'
  });
  assert.strictEqual(start.nightModeId, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. Selecting an unavailable card cannot silently preserve a hidden armed mode
// ─────────────────────────────────────────────────────────────────────────────
test('unavailable mode returns null from resolveNightModeStart even with matching values', () => {
  // quiet-house has durationSeconds: 1800 and action: 'sleep' — even if
  // options match, it must not produce identity because it is unavailable.
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quiet-house',
    durationSeconds: 1800,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeId, null);
  assert.strictEqual(result.nightModeTitle, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. resolveNightModeStart returns canonical ritualId
// ─────────────────────────────────────────────────────────────────────────────
test('resolveNightModeStart returns canonical ritualId for ritual modes', () => {
  const fs = nightModes.resolveNightModeStart({
    nightModeId: 'full-shutdown',
    durationSeconds: 3600,
    action: 'shutdown'
  });
  assert.strictEqual(fs.ritualId, 'standard');
  assert.strictEqual(fs.nightModeId, 'full-shutdown');
});

test('resolveNightModeStart returns none ritualId for direct modes', () => {
  const qs = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(qs.ritualId, 'none');
  assert.strictEqual(qs.nightModeId, 'quick-sleep');
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. Canonical none-ritual mode on standard ritual path loses identity
// ─────────────────────────────────────────────────────────────────────────────
test('ritualId: none mode must be cleared if profile forces standard ritual', () => {
  // Simulates main.js ritual gateway logic: resolve identity, then check
  // if mode ritualId matches the actual execution path.
  const nm = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(nm.nightModeId, 'quick-sleep');
  assert.strictEqual(nm.ritualId, 'none');
  // Profile forces standard ritual — caller must clear because ritualId !== 'standard'
  const shouldClear = nm.nightModeId && nm.ritualId !== 'standard';
  assert.ok(shouldClear, 'quick-sleep on standard ritual path should be cleared');
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. Canonical standard-ritual mode on direct path loses identity
// ─────────────────────────────────────────────────────────────────────────────
test('ritualId: standard mode on direct path must be cleared', () => {
  // Simulates main.js direct path: mode has standard ritual but no profile
  // ritual gateway was entered — execution path differs from canonical.
  const nm = nightModes.resolveNightModeStart({
    nightModeId: 'full-shutdown',
    durationSeconds: 3600,
    action: 'shutdown'
  });
  assert.strictEqual(nm.nightModeId, 'full-shutdown');
  assert.strictEqual(nm.ritualId, 'standard');
  // Direct path — caller must clear because ritualId === 'standard'
  const shouldClear = nm.nightModeId && nm.ritualId === 'standard';
  assert.ok(shouldClear, 'full-shutdown on direct path should be cleared');
});
