'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createDispatcher, commandForAction } = require('../powerActionDispatcher');
const { AbortController } = globalThis;

function harness(behavior, extra = {}) {
  const events = [], calls = [], diagnostics = [];
  let unreferences = 0;
  const child = new EventEmitter();
  child.pid = 1234;
  child.unref = () => { unreferences++; };
  const dispatch = createDispatcher({ observationMs: 15, ...extra, spawn(file, args, options) {
    calls.push({ file, args, options });
    behavior?.(child, events);
    return child;
  } });
  return { child, events, calls, diagnostics, unreferences: () => unreferences,
    run: options => dispatch({ action: 'shutdown', onEvidence: event => events.push(event), onDiagnostic: d => diagnostics.push(d), ...options }) };
}
const later = fn => queueMicrotask(fn);
const states = h => h.events.map(event => event.state);

test('dispatcher requires an explicitly injected executor; no built-in power capability', () => {
  assert.throws(() => createDispatcher(), /explicit command executor/);
  const source = fs.readFileSync(path.join(__dirname, '../powerActionDispatcher.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?child_process/);
});

test('non-suspend Windows commands and force opt-in arguments are preserved', () => {
  const expected = {
    shutdown: ['shutdown.exe', ['/s', '/t', '0']], restart: ['shutdown.exe', ['/r', '/t', '0']],
    lock: ['rundll32.exe', ['user32.dll,LockWorkStation']], logout: ['shutdown.exe', ['/l']]
  };
  for (const [action, [file, args]] of Object.entries(expected)) assert.deepEqual(commandForAction(action), { file, args });
  assert.deepEqual(commandForAction('shutdown', true).args, ['/s', '/f', '/t', '0']);
  assert.deepEqual(commandForAction('restart', true).args, ['/r', '/f', '/t', '0']);
  assert.equal(commandForAction('other'), null);
  assert.equal(commandForAction('sleep'), null);
  assert.equal(commandForAction('hibernate'), null);
});

test('synchronous executor throw is a launch failure after the pre-dispatch record', async () => {
  const h = harness(() => { throw Object.assign(new Error('fake failure'), { code: 'EACCES' }); });
  const r = await h.run();
  assert.deepEqual(states(h), ['action_requested', 'spawn_failed']);
  assert.equal(r.errorCode, 'EACCES');
  assert.equal(r.success, false);
  assert.equal(r.systemOutcome, 'unverified');
});

test('asynchronous spawn error is observed and never reports power executed', async () => {
  const h = harness(child => later(() => child.emit('error', Object.assign(new Error('fake ENOENT'), { code: 'ENOENT' }))));
  const r = await h.run();
  assert.equal(r.status, 'spawn_failed');
  assert.deepEqual(states(h), ['action_requested', 'spawn_failed']);
});

for (const [code, signalName, expected] of [[0, null, 'command_returned_success'], [5, null, 'command_returned_failure'], [null, 'SIGTERM', 'outcome_unverified']]) {
  test(`subprocess exit ${code}/${signalName} records ${expected}; Windows outcome remains unverified`, async () => {
    const h = harness(child => later(() => {
      for (const name of ['error', 'spawn', 'exit', 'close']) assert(child.listenerCount(name) > 0, name + ' listener attached before events');
      assert.equal(h.unreferences(), 0, 'do not discard observation immediately');
      child.emit('spawn'); child.emit('exit', code, signalName); child.emit('close', code, signalName);
      child.emit('error', new Error('duplicate late error must be absorbed'));
    }));
    const r = await h.run();
    assert.equal(r.status, expected);
    assert.deepEqual(states(h), ['action_requested', 'command_spawned', expected]);
    assert.equal(h.unreferences(), 1);
    assert(h.events.every(event => event.systemOutcome === 'unverified'));
  });
}

test('missing exit and close ends bounded observation as unknown; it never invents failure or success', async () => {
  const h = harness(child => later(() => child.emit('spawn')));
  const r = await h.run();
  assert.equal(r.status, 'outcome_unverified');
  assert.match(r.reason, /observation-window/);
  assert.deepEqual(states(h), ['action_requested', 'command_spawned', 'outcome_unverified']);
});

test('no events at all is unknown, with no invented spawn event', async () => {
  const h = harness();
  const r = await h.run();
  assert.equal(r.status, 'outcome_unverified');
  assert.equal(r.commandSpawned, false);
  assert.deepEqual(states(h), ['action_requested', 'outcome_unverified']);
});

test('close-only observation reports the command return, without inventing spawn or Windows outcome', async () => {
  const h = harness(child => later(() => child.emit('close', 0, null)));
  const r = await h.run();
  assert.equal(r.status, 'command_returned_success');
  assert.equal(r.commandSpawned, false);
  assert.equal(r.systemOutcome, 'unverified');
});

test('cancel before dispatch, including during the synchronous proof boundary, invokes zero executors', async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    if (before) controller.abort();
    const h = harness();
    const r = await h.run({ signal: controller.signal, onEvidence(event) { h.events.push(event); if (event.state === 'action_requested') controller.abort(); } });
    assert.equal(r.status, 'cancelled');
    assert.equal(r.systemOutcome, 'not_requested');
    assert.equal(h.calls.length, 0);
  }
});

test('cancellation after dispatch cannot promise to recall a Windows command', async () => {
  const controller = new AbortController();
  const h = harness(child => later(() => { child.emit('spawn'); controller.abort(); child.emit('exit', 0, null); }));
  const r = await h.run({ signal: controller.signal });
  assert.equal(r.status, 'outcome_unverified');
  assert.match(r.reason, /cannot be recalled/);
  assert.equal(h.calls.length, 1);
});

test('proof-store exceptions are diagnosed without silently suppressing the user command', async () => {
  const h = harness(child => later(() => { child.emit('spawn'); child.emit('exit', 0, null); }));
  const r = await h.run({ onEvidence() { throw Object.assign(new Error('fake disk full'), { code: 'ENOSPC' }); } });
  assert.equal(h.calls.length, 1);
  assert.equal(r.status, 'command_returned_success');
  assert.equal(r.systemOutcome, 'unverified');
  assert.equal(h.diagnostics.length, 3);
});

test('unknown action is blocked without invoking even the injected executor', async () => {
  const h = harness();
  const r = await h.run({ action: 'unsupported' });
  assert.equal(r.status, 'blocked');
  assert.equal(h.calls.length, 0);
});
