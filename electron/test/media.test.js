const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const Module = require('module');

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

function makeFakeSpawn(commands) {
  return (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    commands.push({ cmd, args });
    setImmediate(() => child.emit('close', 0));
    return child;
  };
}

async function withStubbedChildProcess(commands, fn) {
  const originalLoad = Module._load;
  const mediaPath = require.resolve('../media');

  delete require.cache[mediaPath];

  Module._load = function (request, parent, isMain) {
    if (request === 'child_process') {
      return { spawn: makeFakeSpawn(commands) };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    const media = require('../media');
    return await fn(media);
  } finally {
    Module._load = originalLoad;
    delete require.cache[mediaPath];
  }
}

test('pauseAllMedia sends VK_MEDIA_PLAY_PAUSE ([char]179) and not [char]174', async () => {
  const commands = [];
  await withStubbedChildProcess(commands, async ({ pauseAllMedia }) => {
    await pauseAllMedia();
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].cmd, 'powershell.exe');
  assert.equal(commands[0].args[3], '-Command');
  const command = commands[0].args[4];
  assert.ok(command, 'spawn must receive a PowerShell command');
  assert.match(command, /\[char\]179/, 'pause command must contain [char]179');
  assert.doesNotMatch(command, /\[char\]174/, 'pause command must not contain [char]174');
});

test('resumeAllMedia sends VK_MEDIA_PLAY_PAUSE ([char]179) and not [char]174', async () => {
  const commands = [];
  await withStubbedChildProcess(commands, async ({ resumeAllMedia }) => {
    await resumeAllMedia();
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].cmd, 'powershell.exe');
  assert.equal(commands[0].args[3], '-Command');
  const command = commands[0].args[4];
  assert.ok(command, 'spawn must receive a PowerShell command');
  assert.match(command, /\[char\]179/, 'resume command must contain [char]179');
  assert.doesNotMatch(command, /\[char\]174/, 'resume command must not contain [char]174');
});
