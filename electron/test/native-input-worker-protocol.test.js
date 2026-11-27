'use strict';
// The desktop gate's native input worker reads compressed single-line JSON.
// Another app's window title can carry a raw control character (Reality Gate's
// title has a bell, U+0007); that must reach the gate as text, not abort it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { NativeInputWorker } = require('../scripts/native-input-worker');

function readyWorker() {
  const worker = new NativeInputWorker('unused.ps1');
  worker.state = 'starting';
  let ready = null;
  worker.readyResolve = message => { ready = message; };
  worker.readyReject = () => {};
  return { worker, ready: () => ready };
}

test('a raw control character inside a string is read as text', () => {
  const { worker, ready } = readyWorker();
  const bell = String.fromCharCode(7);
  worker.handleLine(`{"type":"ready","windowTitle":"REALITY GATE ${bell} Your projects"}`);
  assert.equal(worker.state, 'ready');
  assert.equal(ready().windowTitle, `REALITY GATE ${bell} Your projects`);
});

test('a line that is not JSON still fails the protocol', () => {
  const { worker } = readyWorker();
  worker.handleLine('not json');
  assert.equal(worker.state, 'terminated');
});
