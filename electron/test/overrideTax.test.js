// Override Tax: unit tests for escalating snooze cost system.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

// Mock electron before requiring overrideTax.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-test-'));
const fakeElectron = { app: { getPath: () => tmpDir } };
const FAKE_ELECTRON_PATH = path.join(tmpDir, '__fake_electron__.js');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return FAKE_ELECTRON_PATH;
  return originalResolve.call(this, request, ...args);
};
require.cache[FAKE_ELECTRON_PATH] = { id: FAKE_ELECTRON_PATH, filename: FAKE_ELECTRON_PATH, loaded: true, exports: fakeElectron };

// Also mock ./settings which overrideTax requires.
const settingsPath = path.resolve(__dirname, '..', 'settings.js');
require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: { getSection: () => ({}) } };

const overrideTax = require('../overrideTax');

function cleanup() {
  overrideTax._reset();
  const f = path.join(tmpDir, 'override-tax.json');
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  cleanup();
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('assessSnoozeCost: first snooze is free', () => {
  overrideTax.resetSession();
  const cost = overrideTax.assessSnoozeCost();
  assert.strictEqual(cost.level, 0);
  assert.strictEqual(cost.cost, 'free');
  assert.strictEqual(cost.consequences.length, 0);
});

test('assessSnoozeCost: second snooze has level 1 (logged + accountability)', () => {
  overrideTax.resetSession();
  overrideTax.recordSnooze(); // consume the free one
  const cost = overrideTax.assessSnoozeCost();
  assert.strictEqual(cost.level, 1);
  assert.ok(cost.consequences.some(c => c.type === 'logged'));
  assert.ok(cost.consequences.some(c => c.type === 'accountability'));
});

test('assessSnoozeCost: third snooze adds tighten penalty', () => {
  overrideTax.resetSession();
  overrideTax.recordSnooze(); // 1st (free)
  overrideTax.recordSnooze(); // 2nd (level 1)
  const cost = overrideTax.assessSnoozeCost();
  assert.strictEqual(cost.level, 2);
  assert.ok(cost.consequences.some(c => c.type === 'tighten'));
});

test('assessSnoozeCost: 4th snooze requires reason', () => {
  overrideTax.resetSession();
  overrideTax.recordSnooze(); // 1
  overrideTax.recordSnooze(); // 2
  overrideTax.recordSnooze(); // 3
  const cost = overrideTax.assessSnoozeCost();
  assert.strictEqual(cost.requireReason, true);
  assert.ok(cost.consequences.some(c => c.type === 'reason'));
});

test('recordSnooze: increments session count and accumulates debt', () => {
  overrideTax.resetSession();
  const r1 = overrideTax.recordSnooze(); // 1st (free, no debt)
  assert.strictEqual(r1.level, 0);
  assert.strictEqual(r1.tomorrowDebt, 0);

  const r2 = overrideTax.recordSnooze(); // 2nd (level 1, no debt yet)
  assert.strictEqual(r2.level, 1);
  assert.strictEqual(r2.tomorrowDebt, 0);

  const r3 = overrideTax.recordSnooze(); // 3rd (level 2, +15 min debt)
  assert.strictEqual(r3.level, 2);
  assert.strictEqual(r3.tomorrowDebt, 15);
});

test('consumeDebt: returns and zeroes accumulated debt', () => {
  overrideTax.resetSession();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze(); // accumulates 15 min
  const debt = overrideTax.consumeDebt();
  assert.strictEqual(debt, 15);
  assert.strictEqual(overrideTax.getTomorrowDebt(), 0);
});

test('resetSession: zeroes session count without clearing debt', () => {
  overrideTax.resetSession();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze(); // debt = 15
  overrideTax.resetSession();
  // Session count is reset but debt persists.
  const cost = overrideTax.assessSnoozeCost();
  assert.strictEqual(cost.level, 0); // first snooze of new session is free
  assert.strictEqual(overrideTax.getTomorrowDebt(), 15); // debt remains
});

test('config: maxTighten caps debt accumulation', () => {
  overrideTax.updateConfig({ maxTighten: 30 });
  overrideTax.resetSession();
  overrideTax.recordSnooze(); // free
  overrideTax.recordSnooze(); // level 1
  overrideTax.recordSnooze(); // +15 = 15
  overrideTax.recordSnooze(); // +15 = 30 (capped)
  overrideTax.recordSnooze(); // +0 (at cap)
  assert.strictEqual(overrideTax.getTomorrowDebt(), 30);
});

test('config: disabled means all snoozes are free', () => {
  overrideTax.updateConfig({ enabled: false });
  overrideTax.resetSession();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze();
  const cost = overrideTax.assessSnoozeCost();
  assert.strictEqual(cost.level, 0);
  assert.strictEqual(cost.cost, 'free');
});

test('getStats: returns current session and weekly summary', () => {
  overrideTax.updateConfig({ enabled: true });
  overrideTax.resetSession();
  overrideTax.recordSnooze();
  overrideTax.recordSnooze();
  const stats = overrideTax.getStats();
  assert.strictEqual(stats.sessionSnoozeCount, 2);
  assert.strictEqual(stats.weekSnoozes, 2);
  assert.strictEqual(stats.weekTaxedSnoozes, 1); // only 2nd is taxed
});

test('history: prunes entries older than 90 days', () => {
  overrideTax.resetSession();
  // Manually inject an old history entry.
  const data = overrideTax._load();
  data.history.push({
    date: new Date(Date.now() - 100 * 86400000).toISOString(),
    type: 'snooze',
    snoozeNumber: 1,
    level: 0
  });
  overrideTax.recordSnooze(); // triggers prune
  const stats = overrideTax.getStats();
  // Old entry should be pruned.
  assert.ok(!data.history.some(h => new Date(h.date) < new Date(Date.now() - 91 * 86400000)));
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n  Override Tax: ${passed} passed, ${failed} failed`);

// Cleanup temp dir.
fs.rmSync(tmpDir, { recursive: true, force: true });

if (failed > 0) process.exit(1);
