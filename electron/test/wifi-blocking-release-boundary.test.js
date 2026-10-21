'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const parser = require('espree');
const { createLifecycle } = require('../wifiGuardLifecycle');
const root = path.join(__dirname, '..'), source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const ast = parser.parse(source, { ecmaVersion: 'latest', range: true });
const declaration = ast.body.flatMap(n => n.declarations || []).find(n => n.id.name === 'wifiLifecycle');
const initializer = source.slice(...declaration.init.range);
function publicLifecycle() {
  let calls = 0; const statuses = [];
  const life = vm.runInNewContext(initializer, { require: () => ({ createLifecycle }),
    wifiGuard: { blockInternet: () => { calls++; throw Error('Provider must remain unreachable'); }, unblockInternet: () => { calls++; throw Error('No mutation to restore'); } },
    mainWindow: { isDestroyed: () => false, webContents: { send: (_event, status) => statuses.push(status) } }, showNativeNotification() {} });
  return { life, statuses, calls: () => calls };
}
test('actual main-process policy denies all new blocking with no cleanup mutation', async () => {
  const { life, statuses, calls } = publicLifecycle(); assert.equal(life.blockingAvailable, false);
  for (const provider of ['adapter', 'tplink', 'asus', 'netgear', 'webhook']) {
    const session = life.begin(), denied = await life.block(session, { provider, enabled: true, unblockOnCancel: false, blockingAllowed: true });
    assert.equal(denied.code, 'WIFI_BLOCKING_UNAVAILABLE'); assert.equal(denied.mutationAttempted, false);
    assert.equal(life.hasPending(), false); assert.equal((await life.finish(session, { reason: 'complete' })).success, true);
  }
  assert.equal(calls(), 0); assert.ok(statuses.every(s => s.blocked === null && s.recoveryRequired === false));
});
test('new processes at each public blocking boundary have nothing to orphan or retry', () => {
  for (const phase of ['before-block', 'queued', 'denied', 'completion']) {
    const script = `const vm=require('vm');let calls=0;const life=vm.runInNewContext(${JSON.stringify(initializer)},{require:()=>require(${JSON.stringify(path.join(root, 'wifiGuardLifecycle'))}),wifiGuard:{blockInternet:()=>{calls++;throw Error('Unexpected mutation')},unblockInternet:()=>{calls++;throw Error('Unexpected retry')}},mainWindow:null,showNativeNotification(){}});const s=life.begin();(async()=>{if(${JSON.stringify(phase)}!=='before-block'){const p=life.block(s,{provider:'webhook',enabled:true,unblockOnCancel:false});if(${JSON.stringify(phase)}!=='queued')await p;if(${JSON.stringify(phase)}==='completion')await life.finish(s,{reason:'complete'});}console.log(JSON.stringify({phase:${JSON.stringify(phase)},calls,pending:life.hasPending(),available:life.blockingAvailable}));process.exit(0)})().catch(()=>process.exit(1));`;
    const child = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true }));
    assert.deepEqual(child, { phase, calls: 0, pending: false, available: false });
  }
});
test('unchecked cancel restoration never means keep blocked at normal completion', async () => {
  let restores = 0;
  const life = createLifecycle({ block: async () => ({ success: true }), unblock: async () => { restores++; return { success: true }; } });
  const s = life.begin(); await life.block(s, { unblockOnCancel: false });
  assert.equal((await life.finish(s, { reason: 'complete' })).success, true); assert.equal(restores, 1); assert.equal(life.hasPending(), false);
});
test('explicit cancel retention blocks later completion until manual restoration', async () => {
  let restores = 0;
  const life = createLifecycle({ block: async () => ({ success: true }), unblock: async () => { restores++; return { success: true }; } });
  const s = life.begin(); await life.block(s, { unblockOnCancel: false });
  const retained = await life.finish(s, { reason: 'cancel' }); assert.equal(retained.retainedByChoice, true); assert.equal(retained.success, false);
  const next = life.begin(); assert.equal((await life.finish(next, { reason: 'complete' })).success, false); assert.equal(restores, 0);
  assert.equal((await life.restorePending()).success, true); assert.equal(restores, 1);
});
test('normal completion restoration failure remains pending for explicit retry', async () => {
  let online = false;
  const life = createLifecycle({ block: async () => ({ success: true }), unblock: async () => ({ success: online }) });
  const s = life.begin(); await life.block(s, { unblockOnCancel: false }); assert.equal((await life.finish(s, { reason: 'complete' })).success, false);
  assert.equal(life.hasPending(), true); online = true; assert.equal((await life.restorePending()).success, true);
});
