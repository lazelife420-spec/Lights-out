'use strict';

// Integration tests for the Profile Ritual Gateway: run-owned token design,
// beginValidatedCountdown split, direct supersession, error behavior, and
// token-safe cleanup. Pure in-memory, no Electron runtime needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const ritualMode = require('../ritualMode');
const profileRitualContext = require('../profileRitualContext');
const settingsStore = require('../settings');

// Enable ritual mode for tests.
try { settingsStore.updateSection('ritual', { enabled: true }); } catch (e) { /* acceptable */ }

const VALID_CTX = {
  durationSeconds: 1800,
  action: 'shutdown',
  dryRun: true,
  forceShutdown: false,
  muteSystem: false,
  gracePeriod: 2,
  profileId: 'test-prof',
  profileName: 'Test Profile'
};

test('ritualMode.startRitual stores immutable run metadata', () => {
  const token = 'test-token-abc';
  const result = ritualMode.startRitual(null, { profileRitualToken: token });
  assert.ok(result.active);
  const meta = ritualMode.getRunMeta();
  assert.ok(meta);
  assert.equal(meta.profileRitualToken, token);
  // Immutable (frozen)
  assert.throws(() => { meta.profileRitualToken = 'mutated'; }, TypeError);
  ritualMode.cancelRitual();
});

test('manual ritual has null runMeta (no profile token)', () => {
  const result = ritualMode.startRitual();
  assert.ok(result.active);
  assert.equal(ritualMode.getRunMeta(), null);
  ritualMode.cancelRitual();
});

test('onStep callback receives run-owned token via runMeta', (t, done) => {
  const token = 'step-token-123';
  let receivedMeta = null;
  ritualMode.onStep((step, state, runMeta) => {
    receivedMeta = runMeta;
  });
  ritualMode.startRitual(null, { profileRitualToken: token });
  assert.ok(receivedMeta);
  assert.equal(receivedMeta.profileRitualToken, token);
  ritualMode.cancelRitual();
  ritualMode.onStep(null);
  done();
});

test('onComplete callback receives run-owned token via runMeta', () => {
  const token = 'complete-token-456';
  let receivedMeta = null;
  ritualMode.onComplete((state, runMeta) => {
    receivedMeta = runMeta;
  });
  // Use single-step ritual to trigger immediate completion on advance.
  ritualMode.startRitual([{ id: 'test', label: 'Test', durationSeconds: 0, skippable: true, auto: false }], { profileRitualToken: token });
  ritualMode.advanceStep(false); // completes
  assert.ok(receivedMeta);
  assert.equal(receivedMeta.profileRitualToken, token);
  ritualMode.onComplete(null);
});

test('each ritual run owns its own immutable token — different per run', () => {
  const token1 = 'run-1-token';
  ritualMode.startRitual(null, { profileRitualToken: token1 });
  assert.equal(ritualMode.getRunMeta().profileRitualToken, token1);
  // Start a new run — overwrites
  const token2 = 'run-2-token';
  ritualMode.startRitual(null, { profileRitualToken: token2 });
  assert.equal(ritualMode.getRunMeta().profileRitualToken, token2);
  ritualMode.cancelRitual();
});

test('consume with run-owned token succeeds; wrong token fails', () => {
  profileRitualContext.clear();
  const runToken = profileRitualContext.createContext(VALID_CTX);
  // Wrong token
  assert.equal(profileRitualContext.consume('wrong'), null);
  assert.ok(profileRitualContext.hasPending());
  // Correct token
  const ctx = profileRitualContext.consume(runToken);
  assert.ok(ctx);
  assert.equal(ctx.durationSeconds, 1800);
  assert.ok(!profileRitualContext.hasPending());
});

test('old run callback cannot consume newer run context', () => {
  profileRitualContext.clear();
  const oldToken = profileRitualContext.createContext(VALID_CTX);
  // Simulate new run creating new context
  const newToken = profileRitualContext.createContext({ ...VALID_CTX, durationSeconds: 3600 });
  // Old run tries to consume — fails
  assert.equal(profileRitualContext.consume(oldToken), null);
  // New run succeeds
  const ctx = profileRitualContext.consume(newToken);
  assert.ok(ctx);
  assert.equal(ctx.durationSeconds, 3600);
});

test('manual ritual (null token) cannot consume profile context', () => {
  profileRitualContext.clear();
  profileRitualContext.createContext(VALID_CTX);
  // Manual ritual has no token
  assert.equal(profileRitualContext.consume(null), null);
  assert.ok(profileRitualContext.hasPending()); // not consumed
  profileRitualContext.clear();
});

test('clearIfOwned: old completion cannot clear newer context', () => {
  profileRitualContext.clear();
  const oldToken = profileRitualContext.createContext(VALID_CTX);
  // New run overwrites
  const newToken = profileRitualContext.createContext({ ...VALID_CTX, durationSeconds: 7200 });
  // Old completion callback tries clearIfOwned
  assert.equal(profileRitualContext.clearIfOwned(oldToken), false);
  assert.ok(profileRitualContext.hasPending()); // new context survives
  // New completion succeeds
  assert.equal(profileRitualContext.clearIfOwned(newToken), true);
  assert.ok(!profileRitualContext.hasPending());
});

test('cancelIfOwned cancels matching run', () => {
  const token = 'cancel-owned-token';
  ritualMode.startRitual(null, { profileRitualToken: token });
  assert.ok(ritualMode.getState().active);
  assert.equal(ritualMode.cancelIfOwned(token), true);
  assert.ok(!ritualMode.getState().active);
});

test('cancelIfOwned is a no-op for mismatched token', () => {
  ritualMode.startRitual(null, { profileRitualToken: 'run-B-token' });
  assert.ok(ritualMode.getState().active);
  // Old run A token cannot cancel run B
  assert.equal(ritualMode.cancelIfOwned('run-A-token'), false);
  assert.ok(ritualMode.getState().active); // B still active
  ritualMode.cancelRitual();
});

test('cancelIfOwned is a no-op for null token (manual ritual)', () => {
  ritualMode.startRitual(); // no meta → manual
  assert.ok(ritualMode.getState().active);
  assert.equal(ritualMode.cancelIfOwned(null), false);
  assert.ok(ritualMode.getState().active); // still active
  ritualMode.cancelRitual();
});

test('cancelIfOwned is a no-op when no ritual is active', () => {
  ritualMode.cancelRitual(); // ensure idle
  assert.equal(ritualMode.cancelIfOwned('any-token'), false);
});

test('old callback cannot cancel newer run (full concurrency scenario)', () => {
  // 1. Start ritual A
  profileRitualContext.clear();
  const tokenA = profileRitualContext.createContext(VALID_CTX);
  ritualMode.startRitual(null, { profileRitualToken: tokenA });
  assert.ok(ritualMode.getState().active);

  // 2. Capture A's callback identity
  const capturedTokenA = tokenA;

  // 3. Start ritual B (overwrites A)
  const tokenB = profileRitualContext.createContext({ ...VALID_CTX, durationSeconds: 9999 });
  ritualMode.startRitual(null, { profileRitualToken: tokenB });
  assert.ok(ritualMode.getState().active);
  assert.equal(ritualMode.getRunMeta().profileRitualToken, tokenB);

  // 4. A's delayed error callback fires with A's token
  profileRitualContext.clearIfOwned(capturedTokenA); // no-op: B's context
  ritualMode.cancelIfOwned(capturedTokenA);           // no-op: B is active

  // 5. B remains active
  assert.ok(ritualMode.getState().active);

  // 6. B's context remains intact
  assert.ok(profileRitualContext.hasPending());

  // 7. A cannot consume B's context
  assert.equal(profileRitualContext.consume(capturedTokenA), null);

  // Verify B can still consume its own context
  const ctx = profileRitualContext.consume(tokenB);
  assert.ok(ctx);
  assert.equal(ctx.durationSeconds, 9999);

  ritualMode.cancelRitual();
});

test('repeated consume with same token returns null (exact-once)', () => {
  profileRitualContext.clear();
  const token = profileRitualContext.createContext(VALID_CTX);
  assert.ok(profileRitualContext.consume(token)); // first
  assert.equal(profileRitualContext.consume(token), null); // second
});

test('direct supersession: ritual active + non-ritual start would cancel it', () => {
  // This test validates the logical flow (not main.js directly)
  ritualMode.startRitual(null, { profileRitualToken: 'sup-token' });
  assert.ok(ritualMode.getState().active);
  // Direct start would call: ritualMode.cancelRitual() + profileRitualContext.clear()
  ritualMode.cancelRitual();
  profileRitualContext.clear();
  assert.ok(!ritualMode.getState().active);
  assert.ok(!profileRitualContext.hasPending());
});

test('consumeAny does not exist in module exports', () => {
  assert.equal(typeof profileRitualContext.consumeAny, 'undefined');
  assert.equal(typeof profileRitualContext._consumeAny, 'undefined');
});
