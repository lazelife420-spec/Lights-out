'use strict';

// M7 (2026-11-27 audit): "Import all data" applied a file with no preview, so
// a shared or crafted backup could turn on forced, unattended, real shutdowns
// (autopilot + force + Test Mode off, or calendar auto-start). A backup may
// now only make those settings safer; turning them on stays a local choice.

const assert = require('node:assert/strict');
const test = require('node:test');
const settings = require('../settings');

test('an imported app section cannot arm or escalate unattended real actions', () => {
  const patch = settings.importableSection('app', {
    forceShutdown: true,
    autopilotEnabled: true,
    globalQuickStartShortcuts: true,
    dryRun: false,
    bedtime: '23:15',
    durationSeconds: 1800
  });
  for (const key of ['forceShutdown', 'autopilotEnabled', 'globalQuickStartShortcuts', 'dryRun']) {
    assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, `${key} keeps this PC's value`);
  }
  assert.equal(patch.bedtime, '23:15', 'ordinary preferences still import');
  assert.equal(patch.durationSeconds, 1800);
});

test('an imported app section may still make those settings safer', () => {
  const patch = settings.importableSection('app', {
    forceShutdown: false, autopilotEnabled: false, globalQuickStartShortcuts: false, dryRun: true
  });
  assert.equal(patch.forceShutdown, false);
  assert.equal(patch.autopilotEnabled, false);
  assert.equal(patch.globalQuickStartShortcuts, false);
  assert.equal(patch.dryRun, true);
});

test('non-boolean values for those keys never get through', () => {
  const patch = settings.importableSection('app', { forceShutdown: 'yes', autopilotEnabled: 1, dryRun: 0 });
  assert.equal('forceShutdown' in patch, false);
  assert.equal('autopilotEnabled' in patch, false);
  assert.equal('dryRun' in patch, false);
});

test('an imported calendar cannot turn on auto-start from events', () => {
  const on = settings.importableSection('calendar', { autoStartFromEvents: true, syncIntervalMin: 45 });
  assert.equal('autoStartFromEvents' in on, false);
  assert.equal(on.syncIntervalMin, 45);
  const off = settings.importableSection('calendar', { autoStartFromEvents: false });
  assert.equal(off.autoStartFromEvents, false);
});

test('the armed Autopilot fire time is still never imported', () => {
  const patch = settings.importableSection('app', { autopilotNextFireAt: '2026-11-28T05:00:00.000Z' });
  assert.equal('autopilotNextFireAt' in patch, false);
});
