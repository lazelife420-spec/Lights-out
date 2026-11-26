'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPersistence } = require('../receiptPersistence');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-power-truth-store-'));
  return { directory, file: path.join(directory, 'run-receipts.json') };
}
const data = id => ({ receipts: [{ id, result: 'running' }] });

test('flushed atomic replacement retains a valid previous snapshot and returns an explicit save result', () => {
  const { file } = fixture();
  const store = createPersistence(file);
  store.load();
  assert.equal(store.save(data('first')), true);
  assert.equal(store.save(data('second')), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).receipts[0].id, 'second');
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).receipts[0].id, 'first');
  assert.equal(store.getStatus().saved, true);
  assert.equal(fs.existsSync(file + '.pending'), false);
});

test('failed write does not truncate existing history and is diagnosed as unsaved', () => {
  const { file } = fixture();
  fs.writeFileSync(file, JSON.stringify(data('history')));
  const before = fs.readFileSync(file);
  const diagnostics = [];
  const fake = Object.create(fs);
  fake.openSync = () => { throw Object.assign(new Error('fake disk full'), { code: 'ENOSPC' }); };
  const store = createPersistence(file, { fs: fake, diagnose: d => diagnostics.push(d) });
  const loaded = store.load(); loaded.receipts.push({ id: 'new' });
  assert.equal(store.save(loaded), false);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(store.getStatus().errorCode, 'ENOSPC');
  assert.equal(store.getStatus().saved, false);
  assert.equal(diagnostics.length, 1);
});

test('failed replacement leaves a flushed pending snapshot; restart recovers newer evidence without losing old receipts', () => {
  const { file } = fixture();
  fs.writeFileSync(file, JSON.stringify(data('history')));
  const fake = Object.create(fs);
  fake.renameSync = (from, to) => { if (to === file) throw Object.assign(new Error('fake busy'), { code: 'EPERM' }); return fs.renameSync(from, to); };
  const store = createPersistence(file, { fs: fake });
  const loaded = store.load(); loaded.receipts.push({ id: 'new' });
  assert.equal(store.save(loaded), false);
  assert.equal(JSON.parse(fs.readFileSync(file)).receipts.length, 1);
  const reopened = createPersistence(file);
  assert.deepEqual(reopened.load().receipts.map(r => r.id), ['history', 'new']);
  assert.equal(reopened.getStatus().recoveredFrom, 'pending');
  assert.equal(reopened.getStatus().saved, false, 'recovered pending evidence is not advertised as a committed primary');
  assert.equal(reopened.save(reopened.load()), true);
  assert.equal(reopened.getStatus().saved, true);
});

test('backup recovery retains corrupt original bytes before replacing the primary', () => {
  const { file } = fixture();
  fs.writeFileSync(file, '{broken'); fs.writeFileSync(file + '.bak', JSON.stringify(data('retained')));
  const store = createPersistence(file, { now: () => 100 });
  const loaded = store.load();
  assert.equal(loaded.receipts[0].id, 'retained');
  assert.equal(store.getStatus().recoveredFrom, 'backup');
  assert.equal(store.save(loaded), true);
  assert.equal(fs.readFileSync(file + '.corrupt-100', 'utf8'), '{broken');
});

test('unreadable history without a recoverable snapshot is never overwritten by an empty cache', () => {
  const { file } = fixture();
  fs.writeFileSync(file, '{unrecoverable');
  const store = createPersistence(file);
  const loaded = store.load();
  assert.equal(store.getStatus().saved, false);
  loaded.receipts.push({ id: 'memory-only' });
  assert.equal(store.save(loaded), false);
  assert.equal(store.getStatus().errorCode, 'RECEIPT_LOAD_BLOCKED');
  assert.equal(fs.readFileSync(file, 'utf8'), '{unrecoverable');
  assert.equal(fs.existsSync(file + '.pending'), false);
});

test('fsync failure preserves primary and cannot advertise durable success', () => {
  const { file } = fixture();
  fs.writeFileSync(file, JSON.stringify(data('history')));
  const fake = Object.create(fs);
  fake.fsyncSync = () => { throw Object.assign(new Error('fake sync failed'), { code: 'EIO' }); };
  const store = createPersistence(file, { fs: fake });
  const loaded = store.load(); loaded.receipts.push({ id: 'new' });
  assert.equal(store.save(loaded), false);
  assert.equal(store.getStatus().saved, false);
  assert.equal(JSON.parse(fs.readFileSync(file)).receipts.length, 1);
});

test('valid JSON with malformed receipt entries is unavailable and preserved instead of crashing reconciliation', () => {
  const { file } = fixture();
  fs.writeFileSync(file, '{"receipts":[null]}');
  const store = createPersistence(file);
  assert.equal(store.load().receipts.length, 0);
  assert.equal(store.getStatus().saved, false);
  assert.equal(store.save(data('memory-only')), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"receipts":[null]}');
});
