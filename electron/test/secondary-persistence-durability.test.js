// Regression test for secondary JSON persistence durability.
// Verifies crash-safe atomic writes (write-tmp-verify-rename) and automatic
// backup recovery (.bak) for streaks.js, sleepDebt.js, profiles.js, and overrideTax.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const durableJsonStore = require('../durableJsonStore');

// Helper to isolate test paths using Electron mock
let currentTmpDir = null;
const origLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => currentTmpDir || os.tmpdir() },
      safeStorage: { isEncryptionAvailable: () => false }
    };
  }
  return origLoad.apply(this, arguments);
};

function loadFreshModule(modulePath, targetTmpDir) {
  currentTmpDir = targetTmpDir;
  delete require.cache[modulePath];
  delete require.cache[require.resolve('../durableJsonStore')];
  const mod = require(modulePath);
  if (mod._reset) mod._reset();
  return mod;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. durableJsonStore Direct Contract Tests
// ─────────────────────────────────────────────────────────────────────────────

test('durableJsonStore: atomic write creates primary and backup files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durability-contract-'));
  const file = path.join(dir, 'test.json');
  const bak = file + '.bak';
  const tmp = file + '.tmp';

  try {
    // First write: primary created, no backup yet
    const ok1 = durableJsonStore.writeTmpVerifyRename(file, { version: 1 });
    assert.ok(ok1, 'first write succeeds');
    assert.ok(fs.existsSync(file), 'primary file created');
    assert.ok(!fs.existsSync(tmp), 'tmp file removed after write');
    assert.ok(!fs.existsSync(bak), 'no backup on first write');

    // Second write: backup created from version 1
    const ok2 = durableJsonStore.writeTmpVerifyRename(file, { version: 2 });
    assert.ok(ok2, 'second write succeeds');
    assert.ok(fs.existsSync(bak), 'backup file created on second write');
    assert.strictEqual(JSON.parse(fs.readFileSync(bak, 'utf8')).version, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('durableJsonStore: safeLoadJson recovers from backup when primary is 0-byte or corrupt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durability-recover-'));
  const file = path.join(dir, 'test.json');
  const bak = file + '.bak';

  try {
    durableJsonStore.writeTmpVerifyRename(file, { status: 'good-v1' });
    durableJsonStore.writeTmpVerifyRename(file, { status: 'good-v2' });
    assert.ok(fs.existsSync(bak), 'backup file created');

    // Corrupt primary to 0 bytes
    fs.writeFileSync(file, '', 'utf8');

    const result = durableJsonStore.safeLoadJson(file);
    assert.ok(result.recovered, 'identified as recovered from backup');
    assert.strictEqual(result.data.status, 'good-v1', 'loaded valid backup data');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Streaks Persistence Durability
// ─────────────────────────────────────────────────────────────────────────────

test('streaks: crash-safe save creates backup and recovers on primary corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streaks-durability-'));
  const file = path.join(dir, 'streaks.json');
  const bak = file + '.bak';
  const modulePath = path.resolve(path.join(__dirname, '..', 'streaks.js'));

  try {
    let streaks = loadFreshModule(modulePath, dir);
    streaks.replaceAll({ streak: 5, bestStreak: 10, events: [{ date: '2026-09-10', bedTime: '22:00', action: 'shutdown' }] });
    assert.ok(fs.existsSync(file), `streaks.json created at ${file}`);

    // Second write triggers backup creation
    streaks.replaceAll({ streak: 6, bestStreak: 10, events: [{ date: '2026-09-11', bedTime: '22:15', action: 'shutdown' }] });
    assert.ok(fs.existsSync(bak), 'streaks.json.bak created');

    const preCorruptStreak = JSON.parse(fs.readFileSync(bak, 'utf8')).streak;

    // Negative control: simulate zero-byte power loss corruption on primary file
    fs.writeFileSync(file, '', 'utf8');

    // Reload module from clean state
    streaks = loadFreshModule(modulePath, dir);
    const loaded = streaks.getSummary();

    assert.strictEqual(loaded.streak, preCorruptStreak, 'streak retained from backup');
    assert.ok(fs.statSync(file).size > 0, 'primary file restored on disk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SleepDebt Persistence Durability
// ─────────────────────────────────────────────────────────────────────────────

test('sleepDebt: crash-safe save creates backup and recovers on primary corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleepdebt-durability-'));
  const file = path.join(dir, 'sleepDebt.json');
  const bak = file + '.bak';
  const modulePath = path.resolve(path.join(__dirname, '..', 'sleepDebt.js'));

  try {
    let debt = loadFreshModule(modulePath, dir);
    debt.recordNight('23:00', '07:00', 7.5);
    assert.ok(fs.existsSync(file), `sleepDebt.json created at ${file}`);

    debt.recordNight('23:15', '07:00', 7.0);
    assert.ok(fs.existsSync(bak), 'sleepDebt.json.bak created');

    // Negative control: simulate truncated json on primary
    fs.writeFileSync(file, '{partial json...', 'utf8');

    debt = loadFreshModule(modulePath, dir);
    const loaded = debt.getDebtSummary();

    assert.ok(loaded.dailyLog.length > 0, 'daily log survived primary truncation');
    assert.ok(fs.statSync(file).size > 0, 'primary sleepDebt.json restored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Profiles Persistence Durability
// ─────────────────────────────────────────────────────────────────────────────

test('profiles: crash-safe save creates backup and recovers on primary corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-durability-'));
  const file = path.join(dir, 'profiles.json');
  const bak = file + '.bak';
  const modulePath = path.resolve(path.join(__dirname, '..', 'profiles.js'));

  try {
    let profiles = loadFreshModule(modulePath, dir);
    profiles.create({ name: 'Bedtime 1', seconds: 1800, action: 'shutdown' });
    assert.ok(fs.existsSync(file), `profiles.json created at ${file}`);

    profiles.create({ name: 'Bedtime 2', seconds: 3600, action: 'sleep' });
    assert.ok(fs.existsSync(bak), 'profiles.json.bak created');

    // Negative control: corrupt primary file
    fs.writeFileSync(file, 'INVALID JSON CONTENT', 'utf8');

    profiles = loadFreshModule(modulePath, dir);
    const loaded = profiles.reload();

    assert.ok(loaded.length >= 1, 'profiles survived primary corruption via backup');
    assert.ok(fs.statSync(file).size > 0, 'primary profiles.json restored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. OverrideTax Persistence Durability
// ─────────────────────────────────────────────────────────────────────────────

test('overrideTax: crash-safe save creates backup and recovers on primary corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overridetax-durability-'));
  const file = path.join(dir, 'override-tax.json');
  const bak = file + '.bak';
  const modulePath = path.resolve(path.join(__dirname, '..', 'overrideTax.js'));

  try {
    let tax = loadFreshModule(modulePath, dir);
    tax.recordSnooze(300);
    assert.ok(fs.existsSync(file), `override-tax.json created at ${file}`);

    tax.recordSnooze(300);
    assert.ok(fs.existsSync(bak), 'override-tax.json.bak created');

    // Negative control: truncate primary file
    fs.writeFileSync(file, '', 'utf8');

    tax = loadFreshModule(modulePath, dir);
    const loaded = tax.getStats();

    assert.ok(loaded.sessionSnoozeCount > 0, 'session count survived primary 0-byte file');
    assert.ok(fs.statSync(file).size > 0, 'primary override-tax.json restored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
