'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { NativeInputWorker } = require('../scripts/native-input-worker');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.writes = [];
    this.exitCode = null;
    this.killed = false;
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.writes.push(chunk.toString());
        callback();
      }
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  exit(code, signal = null) {
    this.exitCode = code;
    this.emit('exit', code, signal);
  }

  kill() {
    this.killed = true;
    queueMicrotask(() => this.exit(null, 'SIGTERM'));
    return true;
  }
}

function createHarness(overrides = {}) {
  const child = new FakeChild();
  const worker = new NativeInputWorker('worker.ps1', {
    spawnProcess: () => child,
    readyTimeoutMs: 100,
    requestTimeoutMs: 30,
    stopTimeoutMs: 10,
    ...overrides
  });
  return { child, worker };
}

async function startReady(harness) {
  const started = harness.worker.start();
  harness.child.send({ type: 'ready', processId: 123 });
  await started;
}

function lastRequest(child) {
  return JSON.parse(child.writes.at(-1));
}

async function waitForRequest(child, count = 1) {
  for (let attempt = 0; attempt < 20 && child.writes.length < count; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(child.writes.length >= count, `expected ${count} worker request write(s)`);
  return lastRequest(child);
}

test('normal worker response resolves and clears request state and timer', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer' });
  const request = await waitForRequest(harness.child);
  harness.child.send({ type: 'result', requestId: request.requestId, ok: true, value: { accepted: true } });
  assert.deepEqual(await response, { accepted: true });
  assert.equal(harness.worker.pending.size, 0);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(harness.worker.state, 'ready');
  await harness.worker.stop();
});

test('request timeout rejects, clears pending work, and terminates the worker', async () => {
  const harness = createHarness({ requestTimeoutMs: 10 });
  await startReady(harness);
  await assert.rejects(harness.worker.request({ kind: 'pointer' }), { code: 'NATIVE_WORKER_REQUEST_TIMEOUT' });
  assert.equal(harness.worker.pending.size, 0);
  assert.equal(harness.worker.state, 'terminated');
  assert.equal(harness.child.killed, true);
});

test('malformed response rejects pending work and terminates the worker', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer' });
  await waitForRequest(harness.child);
  harness.child.stdout.write('not-json\n');
  await assert.rejects(response, { code: 'NATIVE_WORKER_PROTOCOL_ERROR' });
  assert.equal(harness.worker.pending.size, 0);
  assert.equal(harness.worker.state, 'terminated');
});

for (const code of [1, 0]) {
  test(`worker exit ${code} rejects pending work`, async () => {
    const harness = createHarness();
    await startReady(harness);
    const response = harness.worker.request({ kind: 'pointer' });
    await waitForRequest(harness.child);
    harness.child.exit(code);
    await assert.rejects(response, { code: 'NATIVE_WORKER_EXITED' });
    assert.equal(harness.worker.pending.size, 0);
    assert.equal(harness.worker.state, 'terminated');
  });
}

test('unusable result response rejects pending work', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer' });
  await waitForRequest(harness.child);
  harness.child.send({ type: 'result', requestId: 'wrong-type', ok: true });
  await assert.rejects(response, { code: 'NATIVE_WORKER_PROTOCOL_ERROR' });
  assert.equal(harness.worker.pending.size, 0);
});

test('requests are prevented after worker termination', async () => {
  const harness = createHarness();
  await startReady(harness);
  harness.child.exit(0);
  await assert.rejects(harness.worker.request({ kind: 'pointer' }), /terminated/);
});

test('stop clears pending request timers and leaves the worker terminated', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer' });
  await waitForRequest(harness.child);
  const rejected = assert.rejects(response, /stopped with pending requests/);
  const stopped = harness.worker.stop();
  harness.child.send({ type: 'stopped', requestId: lastRequest(harness.child).requestId });
  harness.child.exit(0);
  await Promise.all([rejected, stopped]);
  assert.equal(harness.worker.pending.size, 0);
  assert.equal(harness.worker.state, 'terminated');
});

// PR43 cursor-custody environment instrumentation (native-input-worker.ps1)
// narrow observability tests. The class under test here never inspects or
// filters payload/errorData contents -- it is a transparent JSON relay -- so
// these tests pin that transparency explicitly for the new fields
// (selector, nativeEnvironment) rather than relying on it only being implied
// by the generic tests above.

test('arbitrary request payload fields (e.g. selector) are transmitted verbatim, unmodified', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer', action: 'click', selector: '#ns-play-btn', targetRect: { x: 1, y: 2, width: 3, height: 4 } });
  const request = await waitForRequest(harness.child);
  assert.equal(request.selector, '#ns-play-btn');
  assert.deepEqual(request.targetRect, { x: 1, y: 2, width: 3, height: 4 });
  harness.child.send({ type: 'result', requestId: request.requestId, ok: true, value: { accepted: true } });
  await response;
  await harness.worker.stop();
});

test('a failed request issues exactly one stdin write for that request -- no automatic retry', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer', action: 'click' });
  const request = await waitForRequest(harness.child);
  const writesBeforeResponse = harness.child.writes.length;
  harness.child.send({ type: 'result', requestId: request.requestId, ok: false, error: 'actual cursor exceeded the one-pixel readback bound of the intended physical point', errorData: { nativeEnvironment: { selector: '#ns-play-btn' } } });
  await assert.rejects(response, /one-pixel readback bound/);
  await new Promise(resolve => setImmediate(resolve));
  // No second request for the same failed gesture: exactly one write total.
  assert.equal(harness.child.writes.length, writesBeforeResponse);
  await harness.worker.stop();
});

test('nested errorData (nativeEnvironment, selector) survives onto the rejected Error unmodified and at full depth', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer', action: 'click' });
  const request = await waitForRequest(harness.child);
  const errorData = {
    selector: '#ns-play-btn',
    dx: -220,
    dy: -333,
    nativeEnvironment: {
      selector: '#ns-play-btn',
      cursorBeforeSetCursorPos: { x: 1377, y: 385 },
      setCursorPos: { requested: { x: 1597, y: 718 }, win32Return: true, win32LastErrorDiagnosticOnly: 203 },
      clipCursorBeforeSetCursorPos: { available: true, left: 0, top: 0, right: 2752, bottom: 1152 },
      virtualScreenMetrics: { available: true, virtualWidth: 2752, virtualHeight: 1152 },
      dpiAwareness: { available: true, rawValue: 0, label: 'unaware' }
    }
  };
  harness.child.send({ type: 'result', requestId: request.requestId, ok: false, error: 'actual cursor exceeded the one-pixel readback bound of the intended physical point', errorData });
  await assert.rejects(response, error => {
    assert.deepEqual(error.nativeInput, errorData);
    assert.equal(error.nativeInput.nativeEnvironment.dpiAwareness.label, 'unaware');
    return true;
  });
  await harness.worker.stop();
});

test('wrong foreground error rejects request before gesture execution', async () => {
  const harness = createHarness();
  await startReady(harness);
  const response = harness.worker.request({ kind: 'pointer', action: 'click' });
  const request = await waitForRequest(harness.child);
  harness.child.send({
    type: 'result',
    requestId: request.requestId,
    ok: false,
    error: 'current app window does not own foreground custody',
    errorData: { gesture: null, selector: '[data-ns-tab="modes"]' }
  });
  await assert.rejects(response, error => {
    assert.match(error.message, /does not own foreground custody/);
    assert.equal(error.nativeInput.gesture, null);
    return true;
  });
  await harness.worker.stop();
});

