'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Every rejection must happen before ADB or filesystem proof setup. The
// deliberately nonexistent executable makes an accidental ADB call visible.
const script = path.resolve(__dirname, '../scripts/android-standalone-lifecycle-proof.js');
const baseline = {
  adb: 'lightsout-must-never-run-adb.exe', serial: 'emulator-5582',
  avd: 'LightsOut_QA_API35', apk: 'unused.apk',
  'source-inventory': 'unused.json', 'proof-root': 'must-not-be-created',
  'allow-debug-reset': true, 'adb-server-port': '5039'
};
for (const [name, change] of [
  ['physical serial', { serial: 'R58PHYSICAL' }],
  ['unowned AVD', { avd: 'Owners_Phone' }],
  ['missing debug-reset acknowledgment', { 'allow-debug-reset': undefined }],
  ['out-of-range ADB port', { 'adb-server-port': '65536' }],
  ['non-numeric ADB port', { 'adb-server-port': '5039;anything' }]
]) {
  test('Android proof refuses ' + name + ' before invoking ADB', () => {
    const args = Object.entries({ ...baseline, ...change })
      .filter(([, value]) => value !== undefined)
      .flatMap(([key, value]) => value === true ? ['--' + key] : ['--' + key, value]);
    const result = spawnSync(process.execPath, [script, ...args], {
      windowsHide: true, encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AssertionError/);
    assert.doesNotMatch(result.stderr, /ENOENT|must-never-run-adb|spawn /);
  });
}
