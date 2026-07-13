// Unit tests for the pure parts of profiles.js: normalize (validation +
// sanitization of arbitrary profile data), getHint, formatDuration, and
// apply (duration/timerOptions computation). These don't touch disk --
// createProfile/updateProfile/etc. call saveProfilesToDisk(), which needs
// app.getPath('userData') from a real Electron runtime, so they're out of
// scope for a plain `node --test` run and are covered by manual/smoke
// verification instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../profiles');

test('normalize fills in defaults for a minimal profile', () => {
  const p = profiles.normalize({ name: 'Movie Night' });
  assert.equal(p.name, 'Movie Night');
  assert.equal(p.action, 'shutdown');
  assert.equal(p.mode, 'duration');
  assert.equal(p.seconds, 1800);
  assert.equal(p.notes, '');
  assert.equal(p.pinned, false);
  assert.equal(p.autoStart, false);
  assert.equal(p.kind, 'timer');
  assert.equal(p.avatar, '');
  assert.ok(p.id);
  assert.ok(p.createdAt);
});

test('normalize preserves safe family identity metadata', () => {
  const p = profiles.normalize({ name: ' Alex ', kind: 'family', avatar: '  A  ' });
  assert.equal(p.kind, 'family');
  assert.equal(p.avatar, 'A');

  const legacy = profiles.normalize({ name: 'Movie Night', kind: 'unknown', avatar: '\u0000Moon\u007f' });
  assert.equal(legacy.kind, 'timer');
  assert.equal(legacy.avatar, 'Moon');
});

test('normalize returns null for missing/blank name', () => {
  assert.equal(profiles.normalize({ name: '' }), null);
  assert.equal(profiles.normalize({ name: '   ' }), null);
  assert.equal(profiles.normalize({}), null);
  assert.equal(profiles.normalize(null), null);
});

test('normalize rejects unknown action/mode values, falling back to safe defaults', () => {
  const p = profiles.normalize({ name: 'X', action: 'nuke-everything', mode: 'telepathy' });
  assert.equal(p.action, 'shutdown');
  assert.equal(p.mode, 'duration');
});

test('normalize clamps seconds to a 60s floor', () => {
  assert.equal(profiles.normalize({ name: 'X', seconds: 5 }).seconds, 60);
  assert.equal(profiles.normalize({ name: 'X', seconds: -100 }).seconds, 60);
  assert.equal(profiles.normalize({ name: 'X', seconds: 'not a number' }).seconds, 1800);
});

test('normalize trims and length-caps notes, and defaults to empty', () => {
  assert.equal(profiles.normalize({ name: 'X' }).notes, '');
  assert.equal(profiles.normalize({ name: 'X', notes: '  Pack light. Early flight.  ' }).notes, 'Pack light. Early flight.');
  const long = 'a'.repeat(400);
  assert.equal(profiles.normalize({ name: 'X', notes: long }).notes.length, 280);
  // Non-string notes never reach the hosts-file/PowerShell-adjacent code paths
  // elsewhere in the app, but should still coerce safely here rather than throw.
  assert.equal(profiles.normalize({ name: 'X', notes: 12345 }).notes, '12345');
  assert.equal(profiles.normalize({ name: 'X', notes: null }).notes, '');
});

test('normalize truncates name to 32 chars', () => {
  const p = profiles.normalize({ name: 'a'.repeat(50) });
  assert.equal(p.name.length, 32);
});

test('normalize preserves an existing id/createdAt (update path) but always refreshes updatedAt', () => {
  const first = profiles.normalize({ name: 'X' });
  const again = profiles.normalize({ ...first, name: 'X renamed' });
  assert.equal(again.id, first.id);
  assert.equal(again.createdAt, first.createdAt);
  assert.equal(again.name, 'X renamed');
});

test('normalize defaults lastUsedAt to null and preserves it across re-normalization', () => {
  const fresh = profiles.normalize({ name: 'X' });
  assert.equal(fresh.lastUsedAt, null);
  const used = profiles.normalize({ ...fresh, lastUsedAt: '2026-07-09T12:00:00.000Z' });
  assert.equal(used.lastUsedAt, '2026-07-09T12:00:00.000Z');
});

test('getHint formats duration, clock, and calendar modes', () => {
  assert.equal(profiles.getHint({ action: 'shutdown', mode: 'duration', seconds: 1800 }), 'Shutdown in 30m');
  assert.equal(profiles.getHint({ action: 'sleep', mode: 'clock', clock: '23:30' }), 'Sleep at 23:30');
  assert.equal(profiles.getHint({ action: 'shutdown', mode: 'calendar', calendarEventTitle: 'Book Club' }), 'Shutdown - Book Club');
  assert.equal(profiles.getHint(null), '');
});

test('formatDuration renders hours+minutes or minutes-only', () => {
  assert.equal(profiles.formatDuration(90 * 60), '1h 30m');
  assert.equal(profiles.formatDuration(45 * 60), '45m');
  assert.equal(profiles.formatDuration(0), '0m');
});
