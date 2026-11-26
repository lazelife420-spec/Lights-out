'use strict';
// v11.3 audit: a timer-owned Wi-Fi block must survive a crash, forced quit or
// power loss as a durable, credential-free recovery record, so the PC (or the
// child's device) is never left offline with nobody owning the restore.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { createLifecycle, createFileJournal, RECOVERY_SCHEMA } = require('../wifiGuardLifecycle');

const GUID = '12345678-1234-1234-1234-123456789abc';

function tempJournal(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-wifi-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wifi-guard-recovery.json');
  return { file, journal: createFileJournal({ getFilePath: () => file }) };
}

function fakeJournal({ failRecord = false } = {}) {
  const log = [];
  let state = null;
  return {
    log,
    get state() { return state; },
    record(entry) { log.push(['record', { ...entry }]); if (failRecord) return false; state = { ...entry }; return true; },
    clear() { log.push(['clear']); state = null; return true; },
    read() { return state; }
  };
}

test('the recovery file holds only provider, adapter GUID and the keep-blocked choice', t => {
  const { file, journal } = tempJournal(t);
  assert.equal(journal.read(), null, 'no file means nothing to recover');
  journal.record({ provider: 'tplink', adapterId: null, retainedByChoice: false, routerPass: 'synthetic-secret', routerUser: 'synthetic-user' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('synthetic-secret'), false, 'credentials never reach the recovery record');
  assert.equal(raw.includes('synthetic-user'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['active', 'adapterId', 'provider', 'recordedAt', 'retainedByChoice', 'schema']);
  assert.equal(JSON.parse(raw).schema, RECOVERY_SCHEMA);
  assert.deepEqual({ ...journal.read(), recordedAt: null }, { provider: 'tplink', adapterId: null, retainedByChoice: false, recordedAt: null });
  journal.record({ provider: 'adapter', adapterId: GUID });
  assert.equal(journal.read().adapterId, GUID);
  journal.record({ provider: 'adapter', adapterId: "'; injected; '" });
  assert.equal(journal.read().adapterId, null, 'a non-GUID identity is never kept');
  journal.clear();
  assert.equal(journal.read(), null);
});

test('a corrupt or foreign recovery file is ignored rather than acted on', t => {
  const { file, journal } = tempJournal(t);
  fs.writeFileSync(file, '{ not json');
  assert.equal(journal.read(), null);
  fs.writeFileSync(file, JSON.stringify({ schema: RECOVERY_SCHEMA, active: true, provider: 'firewall' }));
  assert.equal(journal.read(), null, 'unknown providers are refused');
  fs.writeFileSync(file, JSON.stringify({ schema: 'other/v1', active: true, provider: 'adapter', adapterId: GUID }));
  assert.equal(journal.read(), null);
});

test('a block is never requested unless its recovery record is on disk first', async () => {
  const order = [];
  const journal = fakeJournal();
  const realRecord = journal.record.bind(journal);
  journal.record = entry => { order.push('record'); return realRecord(entry); };
  const lifecycle = createLifecycle({ journal, block: async () => { order.push('block'); return { success: true }; }, unblock: async () => ({ success: true }) });
  const session = lifecycle.begin();
  await lifecycle.block(session, { provider: 'tplink', routerPass: 'synthetic' });
  assert.equal(order[0], 'record');
  assert.ok(order.indexOf('block') > 0);
  assert.equal(journal.state.provider, 'tplink');
  assert.equal(JSON.stringify(journal.log).includes('synthetic'), false, 'the lifecycle never passes credentials to the record');
});

test('if the record cannot be saved, no provider is called and nothing is left pending', async () => {
  const journal = fakeJournal({ failRecord: true });
  let blocked = 0;
  const statuses = [];
  const lifecycle = createLifecycle({ journal, block: async () => { blocked++; return { success: true }; }, unblock: async () => ({ success: true }), onStatus: s => statuses.push(s) });
  const session = lifecycle.begin();
  const result = await lifecycle.block(session, { provider: 'adapter' });
  assert.equal(blocked, 0);
  assert.equal(result.code, 'WIFI_RECOVERY_UNSAVED');
  assert.equal(result.mutationAttempted, false);
  assert.equal(lifecycle.hasPending(), false);
  assert.equal(statuses.at(-1).recoveryRequired, false);
  assert.match(statuses.at(-1).error, /could not save its recovery record/);
});

test('the adapter GUID is recorded before the adapter is disabled, and cleared after a confirmed restore', async () => {
  const journal = fakeJournal();
  const lifecycle = createLifecycle({
    journal,
    block: async (config, hooks) => {
      await hooks.beforeMutation({ adapterId: GUID });
      assert.equal(journal.state.adapterId, GUID, 'GUID is durable before the disable command');
      return { success: true, provider: 'adapter', adapterId: GUID };
    },
    unblock: async config => ({ success: config.adapterId === GUID })
  });
  const session = lifecycle.begin();
  await lifecycle.block(session, { provider: 'adapter' });
  assert.equal(journal.state.adapterId, GUID);
  const done = await lifecycle.finish(session, { reason: 'complete' });
  assert.equal(done.success, true);
  assert.equal(journal.state, null, 'record cleared only after restore');
});

test('an unconfirmed restore keeps the record for the next launch', async () => {
  const journal = fakeJournal();
  const lifecycle = createLifecycle({ journal, block: async () => ({ success: true }), unblock: async () => ({ success: false }) });
  const session = lifecycle.begin();
  await lifecycle.block(session, { provider: 'asus' });
  await lifecycle.finish(session, { reason: 'complete' });
  assert.equal(journal.state.provider, 'asus');
  assert.equal(journal.state.retainedByChoice, false);
});

test('a deliberate keep-blocked cancel is recorded as the user’s choice', async () => {
  const journal = fakeJournal();
  const lifecycle = createLifecycle({ journal, block: async () => ({ success: true }), unblock: async () => ({ success: true }) });
  const session = lifecycle.begin();
  await lifecycle.block(session, { provider: 'netgear', unblockOnCancel: false });
  await lifecycle.finish(session, { reason: 'cancel' });
  assert.equal(journal.state.retainedByChoice, true);
  assert.equal(lifecycle.hasUnretainedPending(), false, 'quit leaves a deliberate block alone');
  assert.equal(lifecycle.hasPending(), true, 'Restore internet can still undo it');
});

test('a provider refusal before any change needs no compensation', async () => {
  const journal = fakeJournal();
  let unblocks = 0;
  const lifecycle = createLifecycle({ journal, block: async () => ({ success: false, mutationAttempted: false }), unblock: async () => { unblocks++; return { success: true }; } });
  const session = lifecycle.begin();
  await lifecycle.block(session, { provider: 'adapter' });
  assert.equal(lifecycle.hasPending(), false);
  assert.equal(journal.state, null);
  const done = await lifecycle.finish(session, { reason: 'complete' });
  assert.equal(done.success, true, 'completion is not blocked by a block that never happened');
  assert.equal(unblocks, 0);
});

test('a block left by a previous process is adopted and restored with current credentials', async () => {
  const journal = fakeJournal();
  journal.record({ provider: 'adapter', adapterId: GUID, retainedByChoice: false });
  const unblocked = [];
  const lifecycle = createLifecycle({ journal, block: async () => ({ success: true }), unblock: async config => { unblocked.push(config); return { success: true }; } });
  lifecycle.adopt(journal.read(), { provider: 'webhook', routerPass: 'from-settings' });
  const result = await lifecycle.restorePending();
  assert.equal(result.success, true);
  assert.equal(unblocked.length, 1);
  assert.equal(unblocked[0].provider, 'adapter', 'the recorded provider wins');
  assert.equal(unblocked[0].adapterId, GUID, 'only the recorded adapter is re-enabled');
  assert.equal(unblocked[0].routerPass, 'from-settings', 'credentials come from encrypted settings, not the record');
  assert.equal(journal.state, null);
});

test('quit restores blocks the user did not keep, and leaves a kept block recorded', async () => {
  const journal = fakeJournal();
  const unblocked = [];
  const lifecycle = createLifecycle({ journal, block: async () => ({ success: true }), unblock: async config => { unblocked.push(config.provider); return { success: true }; } });
  lifecycle.adopt({ provider: 'tplink', retainedByChoice: true }, {});
  assert.equal(lifecycle.hasUnretainedPending(), false);
  await lifecycle.restoreForQuit();
  assert.deepEqual(unblocked, [], 'a kept block is not undone by quitting');
  lifecycle.adopt({ provider: 'asus', retainedByChoice: false }, {});
  assert.equal(lifecycle.hasUnretainedPending(), true);
  await lifecycle.restoreForQuit();
  assert.deepEqual(unblocked, ['asus']);
});

function adapterProvider(replies) {
  const commands = [];
  const file = path.join(__dirname, '..', 'wifiGuard.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = module.paths;
  m.require = request => request === 'child_process' ? { spawn: (_file, args) => {
    commands.push(args.at(-1));
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const reply = replies.shift() || {};
    queueMicrotask(() => { child.stdout.write(reply.output || ''); child.emit('close', reply.code || 0, null); });
    return child;
  } } : request === './boundedProcess' ? require('../boundedProcess') : require(request);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return { api: m.exports, commands };
}

test('the adapter provider hands its GUID to the recovery hook before the disable command', async () => {
  const p = adapterProvider([{ output: GUID }, {}]);
  const seen = [];
  const result = await p.api.blockInternet({ provider: 'adapter' }, { beforeMutation: info => { seen.push({ ...info, commandsSoFar: p.commands.length }); } });
  assert.equal(result.success, true);
  assert.deepEqual(seen, [{ adapterId: GUID, commandsSoFar: 1 }], 'only the identity query ran before the hook');
  assert.equal(p.commands.length, 2);
});

test('a failed recovery hook stops the adapter from being disabled', async () => {
  const p = adapterProvider([{ output: GUID }, {}]);
  const result = await p.api.blockInternet({ provider: 'adapter' }, { beforeMutation: () => { throw new Error('disk full'); } });
  assert.equal(result.success, false);
  assert.equal(result.mutationAttempted, false);
  assert.equal(result.code, 'WIFI_RECOVERY_UNSAVED');
  assert.equal(p.commands.length, 1, 'no Disable-NetAdapter command');
});

test('main wires the record, launch recovery and quit restore', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /journal: wifiRecoveryJournal,\s*block: \(config, hooks\) => wifiGuard\.blockInternet\(config, hooks\)/);
  assert.match(main, /getFilePath: \(\) => path\.join\(app\.getPath\('userData'\), 'wifi-guard-recovery\.json'\)/);
  assert.match(main, /recoverInterruptedWifiBlock\(\)\.catch\(/);
  const quit = main.slice(main.indexOf("app.on('before-quit', (event) => {"));
  assert.match(quit, /if \(!quitWifiRestoreAttempted && wifiLifecycle\.hasUnretainedPending\(\)\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?wifiLifecycle\.restoreForQuit\(\)[\s\S]*?QUIT_WIFI_RESTORE_TIMEOUT_MS[\s\S]*?\.finally\(\(\) => app\.quit\(\)\)/);
});
