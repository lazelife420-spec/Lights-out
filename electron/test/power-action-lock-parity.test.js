'use strict';

// fix(power): execute lock action -- regression coverage.
//
// The v11.2 "explicit Tonight's Plan" UX slice (see
// tonights-plan-contract.test.js) made Lock a first-class, user-selectable
// action in the manual timer UI, wired straight to canonical state.action.
// That exposed a pre-existing gap: main.js's executePowerAction() had no
// `case 'lock':`, so selecting Lock and hitting Start (with Dry Run off)
// would fail at execution with "Unknown action: lock" -- the visible plan
// promised Lock, but Start could not deliver it.
//
// Same source-extraction + vm sandbox approach as
// tonights-plan-contract.test.js, adapted for main.js: executePowerAction
// and formatAction are pulled out by exact source text and run in a
// sandbox with a MOCKED child_process.spawn. The real spawn from
// require('child_process') is never reachable from this file -- the
// sandbox's `spawn` binding is 100% the mock defined below, so it is
// structurally impossible for any test here to lock, sleep, restart,
// hibernate, or shut down the machine running the suite.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createDispatcher, commandForAction } = require('../powerActionDispatcher');

const mainPath = path.join(__dirname, '..', 'main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const indexHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Same balanced-brace extractor as tonights-plan-contract.test.js.
function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found in main.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  if (source[i] !== '{') throw new Error(`function ${name}: no body found after parameter list`);
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

const executePowerActionSource = extractFunction(mainSource, 'executePowerAction');
const formatActionSource = extractFunction(mainSource, 'formatAction');

// Objects/arrays returned by code executed inside a vm context carry that
// context's own Object/Array prototypes, distinct from this file's host
// realm -- assert/strict's deepEqual (== deepStrictEqual) treats that as a
// structural mismatch even when every field matches. Copying into a plain
// host-realm object/array first (same technique either side of the
// comparison) sidesteps that without weakening what's actually asserted.
const plain = value => (Array.isArray(value) ? [...value] : { ...value });

// Builds a sandbox containing the real executePowerAction/formatAction
// bodies, with child_process.spawn replaced by a tracked mock that never
// spawns a real process. Returns the async executePowerAction plus
// inspectable call logs.
function createPowerActionSandbox({ desktopUxProof = false, qaPowerLock = desktopUxProof, initialReceiptId = 'receipt-1', suspend } = {}) {
  const spawnCalls = [];
  const emitCalls = [];
  const receiptUpdates = [];

  const sandbox = {
    console,
    AbortController: globalThis.AbortController,
    completionGuardController: null,
    DESKTOP_UX_PROOF: desktopUxProof,
    QA_POWER_LOCK: qaPowerLock,
    realPowerActionLog: [],
    activeReceiptId: initialReceiptId,
    spawn: (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      // Mimic the shape executePowerAction relies on (chained .unref()) --
      // this is the ONLY spawn implementation reachable from this sandbox.
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null); child.emit('close', 0, null); });
      return child;
    },
    emitTimerUpdate: (type, data) => { emitCalls.push({ type, data }); },
    runReceipts: {
      updateRunReceipt: (id, patch) => { receiptUpdates.push({ id, patch }); },
      recordActionEvent: (id, event) => { receiptUpdates.push({ id, patch: { result: event.state } }); return { persistence: { saved: true } }; }
    }
  };
  sandbox.dispatchPowerAction = createDispatcher({ spawn: sandbox.spawn, suspend });
  sandbox.writeStartupLog = () => {};
  sandbox.showNativeNotification = () => {};

  const context = vm.createContext(sandbox);
  vm.runInContext(
    `${formatActionSource}\n${executePowerActionSource}\nthis.__power = { executePowerAction, formatAction };`,
    context
  );

  return {
    sandbox,
    spawnCalls,
    emitCalls,
    receiptUpdates,
    executePowerAction: context.__power.executePowerAction,
    formatAction: context.__power.formatAction
  };
}

test('canonical "lock" reaches the main-process action dispatcher (no longer "Unknown action")', async () => {
  const { executePowerAction, spawnCalls } = createPowerActionSandbox();

  const result = await executePowerAction({ action: 'lock', dryRun: false });

  assert.equal(result.status, 'command_returned_success');
  assert.equal(result.systemOutcome, 'unverified');
  assert.equal(spawnCalls.length, 1, 'exactly one process must be spawned for a real Lock dispatch');
});

test('Dry Run blocks the real lock operation', async () => {
  const { executePowerAction, spawnCalls, emitCalls, receiptUpdates } = createPowerActionSandbox();

  const result = await executePowerAction({ action: 'lock', dryRun: true });

  assert.deepEqual(plain(result), { success: true, dryRun: true });
  assert.equal(spawnCalls.length, 0, 'Dry Run must never invoke the mocked spawn for Lock');
  assert.deepEqual(
    emitCalls.map(c => ({ type: c.type, data: plain(c.data) })),
    [{ type: 'dryrun', data: { action: 'lock', message: 'Test Mode: Lock skipped' } }]
  );
  assert.equal(receiptUpdates.length, 1);
  assert.equal(receiptUpdates[0].patch.result, 'dry_run_completed');
});

test('real Lock dispatch invokes only the intended Windows lock mechanism', async () => {
  const { executePowerAction, spawnCalls } = createPowerActionSandbox();

  await executePowerAction({ action: 'lock', dryRun: false });

  assert.equal(spawnCalls.length, 1);
  const [call] = spawnCalls;
  assert.equal(call.cmd, 'rundll32.exe');
  assert.deepEqual(plain(call.args), ['user32.dll,LockWorkStation']);
  assert.equal(call.opts.detached, true);
  assert.equal(call.opts.stdio, 'ignore');
  // Must not be reinterpreted as any other action's mechanism.
  assert.doesNotMatch(JSON.stringify(call), /shutdown\.exe|powrprof\.dll|SetSuspendState|\/s\b|\/r\b/);
});

test('Shutdown / Restart dispatch and force opt-in remain unchanged', async () => {
  const cases = [
    { action: 'shutdown', options: { forceShutdown: false }, cmd: 'shutdown.exe', args: ['/s', '/t', '0'] },
    { action: 'shutdown', options: { forceShutdown: true }, cmd: 'shutdown.exe', args: ['/s', '/f', '/t', '0'] },
    { action: 'restart', options: { forceShutdown: false }, cmd: 'shutdown.exe', args: ['/r', '/t', '0'] },
    { action: 'restart', options: { forceShutdown: true }, cmd: 'shutdown.exe', args: ['/r', '/f', '/t', '0'] }
  ];

  for (const { action, options, cmd, args } of cases) {
    const { executePowerAction, spawnCalls } = createPowerActionSandbox();
    const result = await executePowerAction({ action, dryRun: false, ...options });

    assert.equal(result.status, 'command_returned_success', `${action} must observe the fake command return`);
    assert.equal(result.systemOutcome, 'unverified');
    assert.equal(spawnCalls.length, 1, `${action} should spawn exactly once`);
    assert.equal(spawnCalls[0].cmd, cmd, `${action} command must be unchanged`);
    assert.deepEqual(plain(spawnCalls[0].args), args, `${action} args must be unchanged`);
  }
});

for (const action of ['sleep', 'hibernate']) test(`${action} main path uses native adapter with accurate user-visible result`, async () => {
  let calls = 0;
  const h = createPowerActionSandbox({ suspend({ action: requested, signal, onEvidence }) {
    calls++; assert.equal(requested, action); assert.equal(signal.aborted, false);
    onEvidence({ state: 'command_returned_success', api: 'SetSuspendState', nativeAccepted: true });
    return { success: true, status: 'command_returned_success', systemOutcome: 'unverified' };
  } });
  const r = await h.executePowerAction({ action }); assert.equal(r.systemOutcome, 'unverified');
  assert.equal(calls, 1); assert.equal(h.spawnCalls.length, 0); assert.equal(h.sandbox.completionGuardController, null);
  assert.match(h.emitCalls.at(-1).data.message, /accepted.*physical power state unverified/);
});

test('Sleep preparation can be cancelled through the main emergency-cancel controller', async () => {
  const h = createPowerActionSandbox({ suspend({ signal }) { return new Promise(resolve => signal.addEventListener('abort', () => resolve({ status: 'cancelled', success: false }))); } });
  const pending = h.executePowerAction({ action: 'sleep' });
  assert.ok(h.sandbox.completionGuardController); h.sandbox.completionGuardController.abort();
  assert.equal((await pending).status, 'cancelled'); assert.equal(h.spawnCalls.length, 0);
});

test('unsupported or denied Sleep result is visible as blocked rather than timer success', async () => {
  const h = createPowerActionSandbox({ suspend({ onEvidence }) {
    onEvidence({ state: 'blocked', api: 'SetSuspendState', reason: 'native-error', errorCode: 1300 });
    return { success: false, status: 'blocked' };
  } });
  const r = await h.executePowerAction({ action: 'sleep' }); assert.equal(r.success, false);
  assert.match(h.emitCalls.at(-1).data.message, /blocked.*1300.*no native power request/);
});

test('Test Mode never reaches the native suspend adapter', async () => {
  let calls = 0;
  for (const action of ['sleep', 'hibernate']) {
    const h = createPowerActionSandbox({ suspend() { calls++; throw Error('must not call'); } });
    assert.equal((await h.executePowerAction({ action, dryRun: true })).dryRun, true);
  }
  assert.equal(calls, 0);
});

test('unknown actions still fail closed (no spawn, explicit error)', async () => {
  const { executePowerAction, spawnCalls } = createPowerActionSandbox();

  const result = await executePowerAction({ action: 'defenestrate', dryRun: false });

  assert.equal(result.success, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error, 'Unknown action: defenestrate');
  assert.equal(spawnCalls.length, 0, 'an unrecognized action must never reach spawn');
});

test('formatAction() has a real Lock label (dry-run message accuracy, mirrors renderer actionLabel)', () => {
  const { formatAction } = createPowerActionSandbox();
  assert.equal(formatAction('lock'), 'Lock');
  // Unaffected actions keep their existing labels.
  assert.equal(formatAction('shutdown'), 'Shutdown');
  assert.equal(formatAction('sleep'), 'Sleep');
});

test('Tonight\'s Plan Lock selection corresponds to an actually-executable action (UI/main.js parity)', () => {
  // The manual action selector's chip vocabulary (index.html) ...
  const chipsRowMatch = indexHtmlSource.match(/<div class="action-chips-row"[\s\S]*?<\/div>/);
  assert.ok(chipsRowMatch, 'action-chips-row markup must exist in index.html');
  const chipActions = [...chipsRowMatch[0].matchAll(/data-action="([a-z]+)"/g)].map(m => m[1]);
  assert.ok(chipActions.includes('lock'), 'manual selector must still offer Lock');

  // ...must be a subset of what executePowerAction can actually dispatch.
  const dispatchableActions = [...commandForAction.toString().matchAll(/case '([a-z]+)':/g)].map(m => m[1]);
  for (const action of chipActions) {
    assert.ok(
      dispatchableActions.includes(action),
      `manual selector offers "${action}" but executePowerAction has no case for it -- visible plan would promise an action Start cannot execute`
    );
  }
});

test('QA power lock blocks every real action: no spawn, blocked receipt, explicit result', async () => {
  for (const action of ['shutdown', 'restart', 'sleep', 'hibernate', 'lock', 'logout']) {
    const { executePowerAction, spawnCalls, emitCalls, receiptUpdates } = createPowerActionSandbox({ qaPowerLock: true });
    const result = await executePowerAction({ action, dryRun: false, forceShutdown: true });

    assert.deepEqual(plain(result), { success: false, blocked: true, error: 'QA power lock' }, `${action} must be refused under the QA lock`);
    assert.equal(spawnCalls.length, 0, `${action} must never reach spawn under the QA lock`);
    assert.equal(emitCalls.length, 1);
    assert.equal(emitCalls[0].type, 'dryrun');
    assert.match(emitCalls[0].data.message, /^QA power lock: .+ blocked$/);
    assert.equal(receiptUpdates.length, 1);
    assert.equal(receiptUpdates[0].patch.result, 'blocked');
  }
});

test('Desktop UX proof mode records the attempt AND blocks it (never power-cycles the proof host)', async () => {
  const { executePowerAction, spawnCalls, sandbox } = createPowerActionSandbox({ desktopUxProof: true });
  const result = await executePowerAction({ action: 'shutdown', dryRun: false });

  assert.equal(sandbox.realPowerActionLog.length, 1, 'the gate must still see the attempted real action');
  assert.equal(sandbox.realPowerActionLog[0].action, 'shutdown');
  assert.equal(result.blocked, true);
  assert.equal(spawnCalls.length, 0);
});

test('main.js derives QA_POWER_LOCK from the proof flag or an explicit env opt-in only', () => {
  assert.match(
    mainSource,
    /const QA_POWER_LOCK = DESKTOP_UX_PROOF \|\| process\.env\.LIGHTS_OUT_QA_POWER_LOCK === '1';/
  );
  const lockIndex = executePowerActionSource.indexOf('if (QA_POWER_LOCK)');
  const dispatchIndex = executePowerActionSource.indexOf('dispatchPowerAction(');
  assert.ok(lockIndex > 0 && lockIndex < dispatchIndex, 'the QA lock must run before any dispatch');
});

test('safety invariant: no test in this file triggers a real spawn -- every executePowerAction call here runs against the mocked spawn only', () => {
  // Structural proof, not a runtime count: this sandbox factory always
  // injects its own `spawn` mock into the vm context, and the extracted
  // executePowerAction source references the bare identifier `spawn` (never
  // `require('child_process').spawn` or `child_process.spawn`), so within
  // this file's sandboxes the real Node child_process.spawn is never in
  // scope and cannot be reached, regardless of which action is dispatched.
  assert.doesNotMatch(
    executePowerActionSource,
    /require\(\s*['"]child_process['"]\s*\)/,
    'executePowerAction must keep relying on the module-level `spawn` binding, not re-require child_process (which would bypass this sandbox\'s mock)'
  );
});
