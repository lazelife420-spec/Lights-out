'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle } = require('../wifiGuardLifecycle');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cancel waits for a late block and restores its captured config once', async () => {
  const block = deferred(), restore = deferred(), calls = [];
  const life = createLifecycle({ block: async cfg => { calls.push(['block', cfg]); return block.promise; }, unblock: async cfg => { calls.push(['restore', cfg]); return restore.promise; } });
  const session = life.begin(), config = { provider: 'webhook', webhookUrl: 'fixture:original' };
  life.block(session, config); await tick(); config.webhookUrl = 'fixture:changed';
  const done = life.finish(session); assert.equal(life.finish(session), done);
  await tick(); assert.deepEqual(calls.map(c => c[0]), ['block']);
  block.resolve({ success: true }); await tick();
  assert.equal(calls[1][1].webhookUrl, 'fixture:original');
  let settled = false; done.then(() => { settled = true; }); await tick(); assert.equal(settled, false);
  restore.resolve({ success: true }); assert.equal((await done).success, true); assert.equal(life.hasPending(), false);
});

test('an old restore cannot finish after a new run blocks', async () => {
  const gate = deferred(), calls = [];
  const life = createLifecycle({ block: async c => { calls.push('block:' + c.id); return { success: true }; }, unblock: async c => { calls.push('restore:' + c.id); if (c.id === 'A') await gate.promise; return { success: true }; } });
  const a = life.begin(); await life.block(a, { id: 'A' });
  const b = life.begin(), blocked = life.block(b, { id: 'B' }); await tick();
  assert.deepEqual(calls, ['block:A', 'restore:A']);
  gate.resolve(); await blocked; assert.deepEqual(calls, ['block:A', 'restore:A', 'block:B']);
  await life.finish(b); assert.deepEqual(calls, ['block:A', 'restore:A', 'block:B', 'restore:B']);
});

test('a partially failed block is compensated rather than treated as unchanged', async () => {
  let restores = 0;
  const life = createLifecycle({ block: async () => { throw Error('fixture partial write'); }, unblock: async () => { restores++; return { success: true }; } });
  const s = life.begin(); await life.block(s, { provider: 'webhook' });
  assert.equal((await life.finish(s)).success, true); assert.equal(restores, 1);
});

test('failed restoration remains pending, prevents another block, and can be retried explicitly', async () => {
  let recovered = false, blocks = 0;
  const life = createLifecycle({ block: async () => { blocks++; return { success: true }; }, unblock: async () => ({ success: recovered }) });
  const a = life.begin(); await life.block(a, {}); assert.equal((await life.finish(a)).success, false);
  const b = life.begin(); assert.equal((await life.block(b, {})).recoveryRequired, true); assert.equal(blocks, 1);
  assert.equal((await life.finish(b)).success, false);
  recovered = true; assert.equal((await life.restorePending()).success, true);
  const c = life.begin(); await life.block(c, {}); assert.equal(blocks, 2); await life.finish(c);
});

test('Test Mode never calls block or restore providers', async () => {
  const fail = () => { throw Error('External effect reached'); };
  const life = createLifecycle({ block: fail, unblock: fail });
  const s = life.begin({ dryRun: true }); assert.equal((await life.block(s, {})).skipped, true);
  assert.equal((await life.finish(s)).success, true);
});

test('only the adapter identity returned by this block is restored', async () => {
  let restored;
  const life = createLifecycle({ block: async () => ({ success: true, adapterId: 'owned-adapter' }), unblock: async c => { restored = c.adapterId; return { success: true }; } });
  const s = life.begin(); await life.block(s, { provider: 'adapter', adapterId: 'stale-adapter' }); await life.finish(s);
  assert.equal(restored, 'owned-adapter');
});

test('keep-blocked is honored only after a confirmed successful block', async () => {
  let restores = 0, success = true;
  const life = createLifecycle({ block: async () => ({ success }), unblock: async () => { restores++; return { success: true }; } });
  const a = life.begin(); await life.block(a, { unblockOnCancel: false }); assert.equal((await life.finish(a)).retainedByChoice, true); assert.equal(restores, 0);
  assert.equal(life.hasPending(), true);
  await life.restorePending(); assert.equal(restores, 1);
  success = false; const b = life.begin(); await life.block(b, { unblockOnCancel: false }); await life.finish(b); assert.equal(restores, 2);
});

test('duplicate dim ticks do not start additional router mutations', async () => {
  let count = 0; const life = createLifecycle({ block: async () => { count++; return { success: true }; }, unblock: async () => ({ success: true }) });
  const s = life.begin(), first = life.block(s, {}); assert.equal(life.block(s, {}), first); await first; assert.equal(count, 1); await life.finish(s);
});

test('manual restore queued in the same turn waits for the scheduled block', async () => {
  const calls = [];
  const life = createLifecycle({ block: async () => { calls.push('block'); return { success: true }; }, unblock: async () => { calls.push('restore'); return { success: true }; } });
  const s = life.begin(); const block = life.block(s, {}); assert.equal(life.hasPending(), true);
  const restore = life.restorePending(); await block; await restore;
  assert.deepEqual(calls, ['block', 'restore']);
});
