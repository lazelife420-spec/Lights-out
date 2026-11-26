'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const ownId = '12345678-1234-1234-1234-123456789abc';
function provider(replies) {
  const commands = [], file = path.join(__dirname, '..', 'wifiGuard.js'), m = new Module(file, module);
  m.filename = file; m.paths = module.paths;
  m.require = request => request === 'child_process' ? { spawn: (_file, args) => {
    commands.push(args.at(-1)); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const reply = replies.shift() || {};
    queueMicrotask(() => { child.stdout.write(reply.output || ''); child.emit('close', reply.code || 0, null); });
    return child;
  } } : request === './boundedProcess' ? require('../boundedProcess') : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file); return { api: m.exports, commands };
}
test('adapter restoration refuses to select an arbitrary previously disabled adapter', async () => {
  const p = provider([]); assert.equal((await p.api.unblockInternet({ provider: 'adapter' })).success, false); assert.equal(p.commands.length, 0);
});
test('adapter block records its GUID, and restore targets only that GUID', async () => {
  const p = provider([{ output: ownId }, {}, {}]); const result = await p.api.blockInternet({ provider: 'adapter' });
  assert.equal(result.success, true); assert.equal(result.adapterId, ownId);
  assert.equal((await p.api.unblockInternet({ provider: 'adapter', adapterId: result.adapterId })).success, true);
  assert.equal(p.commands.length, 3); assert.ok(p.commands[1].includes(ownId)); assert.ok(p.commands[2].includes(ownId));
  assert.doesNotMatch(p.commands[2], /Status -ne 'Up'/);
});
test('no active adapter is an explicit failed block with no disable request', async () => {
  const p = provider([{}]); assert.equal((await p.api.blockInternet({ provider: 'adapter' })).success, false); assert.equal(p.commands.length, 1);
});
test('a failed disable retains the captured identity for compensation', async () => {
  const p = provider([{ output: ownId }, { code: 5 }]); const result = await p.api.blockInternet({ provider: 'adapter' });
  assert.equal(result.success, false); assert.equal(result.adapterId, ownId);
});
test('an injected adapter identity never reaches PowerShell', async () => {
  const p = provider([]); const result = await p.api.unblockInternet({ provider: 'adapter', adapterId: "'; fixture-command; '" });
  assert.equal(result.success, false); assert.equal(p.commands.length, 0);
});
