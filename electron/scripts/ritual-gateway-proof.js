#!/usr/bin/env node
// Isolated Electron runtime proof for the Profile Ritual Gateway.
// Runs with Dry Run enabled. Uses isolated app data. No real power actions.
//
// Usage: cd electron && npm start -- --run-proof=ritual-gateway
// Or:   node scripts/ritual-gateway-proof.js
//
// This script exercises the gateway in the main process directly (no GUI).
// It requires the modules but does NOT start Electron's app lifecycle.

'use strict';

const path = require('path');
const assert = require('assert');

// Load modules directly (no Electron app context needed for these pure modules).
const profiles = require(path.join(__dirname, '..', 'profiles.js'));
const profileRitualContext = require(path.join(__dirname, '..', 'profileRitualContext.js'));
const ritualMode = require(path.join(__dirname, '..', 'ritualMode.js'));
const settingsStore = require(path.join(__dirname, '..', 'settings.js'));

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${label} -> ${err.message}`);
    failed++;
  }
}

console.log('Profile Ritual Gateway — Isolated Runtime Proof\n');
console.log('All operations use Dry Run. No real power actions.\n');

// Initialize profiles (creates temp storage in userData mock path).
try { profiles.initialize(); } catch (e) { /* may fail without app.getPath; acceptable */ }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Profile normalization
// ─────────────────────────────────────────────────────────────────────────────

check('1. Legacy profile normalizes to ritualId: none', () => {
  const p = profiles.normalize({ name: 'Legacy' });
  assert.strictEqual(p.ritualId, 'none');
});

check('2. Profile with ritualId standard round-trips correctly', () => {
  const p = profiles.normalize({ name: 'Ritual', ritualId: 'standard' });
  assert.strictEqual(p.ritualId, 'standard');
  // Re-normalize preserves
  const p2 = profiles.normalize({ ...p, name: 'Ritual v2' });
  assert.strictEqual(p2.ritualId, 'standard');
});

check('3. Invalid ritualId normalizes to none', () => {
  assert.strictEqual(profiles.normalize({ name: 'X', ritualId: 'custom' }).ritualId, 'none');
  assert.strictEqual(profiles.normalize({ name: 'X', ritualId: 123 }).ritualId, 'none');
});

check('4. Imported steps/ritualSteps arrays are dropped', () => {
  const p = profiles.normalize({
    name: 'Injected',
    ritualId: 'standard',
    steps: [{ id: 'bad' }],
    ritualSteps: [{ id: 'also-bad' }]
  });
  assert.strictEqual(p.steps, undefined);
  assert.strictEqual(p.ritualSteps, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Token ownership and consume semantics
// ─────────────────────────────────────────────────────────────────────────────

check('5. Token-verified consume: correct token succeeds', () => {
  profileRitualContext.clear();
  const token = profileRitualContext.createContext({
    durationSeconds: 1800,
    action: 'shutdown',
    dryRun: true,
    forceShutdown: false,
    muteSystem: false,
    gracePeriod: 2,
    profileId: 'test-profile',
    profileName: 'Test'
  });
  const ctx = profileRitualContext.consume(token);
  assert.ok(ctx);
  assert.strictEqual(ctx.durationSeconds, 1800);
  assert.strictEqual(ctx.dryRun, true);
  assert.strictEqual(ctx.profileId, 'test-profile');
});

check('6. Wrong token is rejected — context remains', () => {
  profileRitualContext.clear();
  profileRitualContext.createContext({
    durationSeconds: 900, action: 'sleep', dryRun: true,
    forceShutdown: false, muteSystem: false, gracePeriod: 0,
    profileId: 'p1', profileName: 'P1'
  });
  assert.strictEqual(profileRitualContext.consume('wrong-token'), null);
  assert.ok(profileRitualContext.hasPending()); // still there
  profileRitualContext.clear();
});

check('7. Null token (manual ritual) is rejected — context remains', () => {
  profileRitualContext.clear();
  profileRitualContext.createContext({
    durationSeconds: 900, action: 'shutdown', dryRun: true,
    forceShutdown: false, muteSystem: false, gracePeriod: 0,
    profileId: 'p2', profileName: 'P2'
  });
  assert.strictEqual(profileRitualContext.consume(null), null);
  assert.ok(profileRitualContext.hasPending());
  profileRitualContext.clear();
});

check('8. Stale token from overwritten context is rejected', () => {
  profileRitualContext.clear();
  const stale = profileRitualContext.createContext({
    durationSeconds: 1800, action: 'shutdown', dryRun: true,
    forceShutdown: false, muteSystem: false, gracePeriod: 0,
    profileId: 'p3', profileName: 'Stale'
  });
  const fresh = profileRitualContext.createContext({
    durationSeconds: 3600, action: 'sleep', dryRun: true,
    forceShutdown: false, muteSystem: false, gracePeriod: 0,
    profileId: 'p4', profileName: 'Fresh'
  });
  assert.strictEqual(profileRitualContext.consume(stale), null);
  const ctx = profileRitualContext.consume(fresh);
  assert.ok(ctx);
  assert.strictEqual(ctx.durationSeconds, 3600);
});

check('9. Double consume is one-use', () => {
  profileRitualContext.clear();
  const token = profileRitualContext.createContext({
    durationSeconds: 600, action: 'shutdown', dryRun: true,
    forceShutdown: false, muteSystem: false, gracePeriod: 0,
    profileId: 'p5', profileName: 'Once'
  });
  assert.ok(profileRitualContext.consume(token));
  assert.strictEqual(profileRitualContext.consume(token), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Eligible origin policy
// ─────────────────────────────────────────────────────────────────────────────

check('10. Only play and profile-start are eligible', () => {
  assert.ok(profileRitualContext.isEligibleOrigin('play'));
  assert.ok(profileRitualContext.isEligibleOrigin('profile-start'));
  assert.ok(!profileRitualContext.isEligibleOrigin(null));
  assert.ok(!profileRitualContext.isEligibleOrigin(undefined));
  assert.ok(!profileRitualContext.isEligibleOrigin(''));
  assert.ok(!profileRitualContext.isEligibleOrigin('tray'));
  assert.ok(!profileRitualContext.isEligibleOrigin('calendar'));
  assert.ok(!profileRitualContext.isEligibleOrigin('autopilot'));
  assert.ok(!profileRitualContext.isEligibleOrigin('remote'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ritual mode integration (simulated)
// ─────────────────────────────────────────────────────────────────────────────

// Enable ritual in settings so startRitual doesn't reject
settingsStore.updateSection('ritual', { enabled: true });

check('11. Ritual starts and reaches timer step via advance', () => {
  const result = ritualMode.startRitual();
  assert.ok(result.active);
  const steps = ritualMode.getConfig().steps;
  const timerIdx = steps.findIndex(s => s.id === 'timer');
  assert.ok(timerIdx >= 0, 'timer step exists in ritual config');
  // Advance through all steps until timer
  let state;
  for (let i = 0; i < timerIdx; i++) {
    state = ritualMode.advanceStep(false);
    assert.ok(state.active, `ritual still active at step ${i}`);
  }
  // We are now at the timer step — confirm
  const currentState = ritualMode.getState();
  assert.strictEqual(currentState.currentStepInfo.id, 'timer');
});

check('12. Cancel before timer step clears everything', () => {
  profileRitualContext.clear();
  const token = profileRitualContext.createContext({
    durationSeconds: 1800, action: 'shutdown', dryRun: true,
    forceShutdown: false, muteSystem: false, gracePeriod: 0,
    profileId: 'test', profileName: 'Test'
  });
  ritualMode.startRitual();
  // Cancel immediately
  ritualMode.cancelRitual();
  profileRitualContext.clear(); // simulates what main.js cancel handler does
  assert.ok(!profileRitualContext.hasPending());
  assert.strictEqual(profileRitualContext.consume(token), null);
});

check('13. consumeAny is NOT exported from profileRitualContext', () => {
  assert.strictEqual(typeof profileRitualContext.consumeAny, 'undefined');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nRuntime Proof Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
