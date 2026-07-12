const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemVolumeCommand } = require('../media');

function upwardSteps(command) {
  const match = command.match(/if \((\d+) -gt 0\) \{ 1\.\.(\d+)/);
  assert.ok(match, 'volume command should guard its volume-up range');
  assert.equal(match[1], match[2], 'guard and range must use the same step count');
  return Number(match[1]);
}

test('system volume command converts percentage to two-percent key steps', () => {
  assert.equal(upwardSteps(buildSystemVolumeCommand(50)), 25);
  assert.equal(upwardSteps(buildSystemVolumeCommand(100)), 50);
});

test('system volume command clamps unsafe or out-of-range input', () => {
  assert.equal(upwardSteps(buildSystemVolumeCommand(-20)), 0);
  assert.equal(upwardSteps(buildSystemVolumeCommand(500)), 50);
  assert.equal(upwardSteps(buildSystemVolumeCommand('not-a-number')), 0);
});

test('zero volume never emits an unguarded descending 1..0 range', () => {
  const command = buildSystemVolumeCommand(0);
  assert.equal(upwardSteps(command), 0);
  assert.doesNotMatch(command, /; 1\.\.0 \|/);
});
