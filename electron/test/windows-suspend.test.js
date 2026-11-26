'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createSuspendDispatcher } = require('../windowsSuspend');
const { createDispatcher } = require('../powerActionDispatcher');

function harness(behavior = () => {}, options = {}) {
  const events = [], calls = [], commits = [];
  let child, send, close;
  const dispatch = createSuspendDispatcher({ platform: 'win32', preparationMs: 30, observationMs: 30, helperPath: 'FAKE.exe',
    spawn(file, args, opts) {
      calls.push({ file, args, opts });
      child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.kills = 0; child.kill = () => { child.kills++; close(1); }; child.unref = () => {};
      send = msg => child.stdout.write(JSON.stringify({ requestId: args[2], ...msg }) + '\n');
      // Real ChildProcess 'close' follows delivery of all stdout data.
      close = (code = 0) => queueMicrotask(() => child.emit('close', code, null));
      const result = (status = 'accepted', extra = {}) => send({ type: 'result', result: { status, requested: status !== 'blocked', accepted: status === 'accepted', errorCode: 0, systemOutcome: 'unverified', reason: 'fixture', ...extra } });
      child.stdin.on('data', chunk => { commits.push(chunk.toString()); behavior({ child, send, close, result, phase: 'commit' }); });
      queueMicrotask(() => behavior({ child, send, close, result, phase: 'prepare', ready: () => send({ type: 'ready', version: 1, action: args[1], capabilities: { sleep: true, hibernate: true } }) }));
      return child;
    }, ...options });
  return { events, calls, commits, get child() { return child; },
    run: opts => dispatch({ action: 'sleep', onEvidence: e => events.push(e), ...opts }),
    send: msg => send(msg), close: code => close(code) };
}
const accepted = ({ phase, ready, send, result, close }) => { if (phase === 'prepare') ready(); else { send({ type: 'invoking', api: 'SetSuspendState' }); result(); close(); } };

test('suspend adapter has no implicit executor or unbounded observation', () => {
  assert.throws(() => createSuspendDispatcher(), /Explicit/);
  assert.throws(() => createSuspendDispatcher({ spawn() {}, helperPath: 'x', observationMs: 0 }), /Bounded/);
});
for (const action of ['sleep', 'hibernate']) test(`${action} commits exactly once after intent, and accepts only a valid API result`, async () => {
  const h = harness(accepted); const r = await h.run({ action });
  assert.equal(r.status, 'command_returned_success'); assert.equal(r.nativeAccepted, true); assert.equal(r.systemOutcome, 'unverified');
  assert.equal(h.commits.length, 1); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[1], action); assert.equal(h.calls[0].opts.shell, false);
  assert.deepEqual(h.events.map(e => e.state), ['action_requested', 'command_spawned', 'command_returned_success']);
  assert.ok(h.events.every(e => e.systemOutcome === 'unverified'));
});
for (const reason of ['unsupported-state', 'native-error']) test(`${reason} blocks before API invocation`, async () => {
  const h = harness(({ phase, result, close }) => { if (phase === 'prepare') { result('blocked', { reason, errorCode: 1300 }); close(); } });
  const r = await h.run(); assert.equal(r.status, 'blocked'); assert.equal(r.nativeRequested, false); assert.equal(h.commits.length, 0);
});
test('denied privilege after commit remains a pre-native block with exact Windows code', async () => {
  const h = harness(({ phase, ready, result, close }) => { if (phase === 'prepare') ready(); else { result('blocked', { errorCode: 1300 }); close(); } });
  const r = await h.run(); assert.equal(r.status, 'blocked'); assert.equal(r.nativeRequested, false); assert.equal(r.errorCode, 1300);
});
test('native false is failure even when the helper exits zero', async () => {
  const h = harness(({ phase, ready, send, result, close }) => { if (phase === 'prepare') ready(); else { send({ type: 'invoking', api: 'SetSuspendState' }); result('failed', { errorCode: 1314 }); close(); } });
  const r = await h.run(); assert.equal(r.status, 'command_returned_failure'); assert.equal(r.errorCode, 1314); assert.equal(r.success, false);
});
test('unsupported platform, invalid action, and pre-abort never start a helper', async () => {
  const h = harness(accepted, { platform: 'linux' }); assert.equal((await h.run()).status, 'blocked'); assert.equal(h.calls.length, 0);
  const g = harness(); assert.equal((await g.run({ action: 'shutdown' })).status, 'blocked');
  const c = new globalThis.AbortController(); c.abort(); assert.equal((await g.run({ signal: c.signal })).status, 'cancelled'); assert.equal(g.calls.length, 0);
});
test('cancellation from the persisted intent callback stops the commit', async () => {
  const c = new globalThis.AbortController(), h = harness(accepted);
  const r = await h.run({ signal: c.signal, onEvidence(e) { h.events.push(e); if (e.state === 'action_requested') c.abort(); } });
  assert.equal(r.status, 'cancelled'); assert.equal(h.commits.length, 0); assert.equal(h.child.kills, 1);
});
test('hung preparation is bounded, killed, and cannot report acceptance', async () => {
  const h = harness(); const r = await h.run(); assert.equal(r.reason, 'helper-preparation-timeout'); assert.equal(h.child.kills, 1); assert.equal(h.commits.length, 0);
});
test('zero exit with no structured native result never means success', async () => {
  const h = harness(({ phase, close }) => { if (phase === 'prepare') close(); });
  assert.equal((await h.run()).status, 'blocked');
});
test('wrong request identity and oversized output never commit', async () => {
  for (const oversized of [false, true]) {
    const h = harness(({ phase, child, send }) => { if (phase === 'prepare') { if (oversized) child.stdout.write('x'.repeat(17000)); else send({ type: 'ready', requestId: 'wrong' }); } });
    assert.equal((await h.run()).status, 'blocked'); assert.equal(h.commits.length, 0);
  }
});
test('native pending is unknown, keeps one request in flight, and records a late return', async () => {
  const h = harness(({ phase, ready, send }) => { if (phase === 'prepare') ready(); else send({ type: 'invoking', api: 'SetSuspendState' }); });
  const r = await h.run(); assert.equal(r.status, 'outcome_unverified'); assert.equal(r.success, false); assert.equal(h.child.kills, 0);
  assert.equal((await h.run()).reason, 'suspend-request-in-progress'); assert.equal(h.calls.length, 1);
  h.send({ type: 'result', result: { status: 'accepted', requested: true, accepted: true, errorCode: 0, systemOutcome: 'unverified' } }); h.close();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(h.events.at(-1).state, 'command_returned_success');
});
test('cancellation after commit never claims recall or kills the native helper', async () => {
  const c = new globalThis.AbortController(), h = harness(({ phase, ready }) => { if (phase === 'prepare') ready(); });
  const promise = h.run({ signal: c.signal }); await new Promise(resolve => queueMicrotask(resolve)); c.abort();
  assert.equal((await promise).status, 'outcome_unverified'); assert.equal(h.child.kills, 0); h.close(1);
});
test('helper spawn failure reports the actual error without falling back', async () => {
  const h = harness(accepted, { spawn() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  const r = await h.run(); assert.equal(r.status, 'spawn_failed'); assert.equal(r.errorCode, 'ENOENT');
});
test('outer dispatcher cannot run legacy suspend commands if native adapter is missing', async () => {
  let spawns = 0; const dispatch = createDispatcher({ spawn() { spawns++; } });
  for (const action of ['sleep', 'hibernate']) assert.equal((await dispatch({ action })).status, 'blocked');
  assert.equal(spawns, 0);
});
