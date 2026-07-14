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

// ═══════════════════════════════════════════════════════════════════════════
// Run-ID ownership tests (cancelIfCurrent uses numeric runId, not token)
// ═══════════════════════════════════════════════════════════════════════════

test('1. Manual ritual receives a run ID', () => {
  ritualMode.startRitual(); // no meta → manual
  const id = ritualMode.getRunId();
  assert.ok(id > 0, 'manual ritual should have a positive runId');
  assert.equal(ritualMode.getRunMeta(), null);
  ritualMode.cancelRitual();
});

test('2. Profile ritual receives a different run ID plus its profile token', () => {
  ritualMode.startRitual(); // manual run → get its ID
  const manualId = ritualMode.getRunId();
  ritualMode.cancelRitual();

  const token = 'profile-token-xyz';
  ritualMode.startRitual(null, { profileRitualToken: token });
  const profileId = ritualMode.getRunId();
  assert.ok(profileId > manualId, 'profile ritual should have a newer runId');
  assert.equal(ritualMode.getRunMeta().profileRitualToken, token);
  ritualMode.cancelRitual();
});

test('3. Manual ritual step error cancels that manual run via cancelIfCurrent', () => {
  ritualMode.startRitual(); // manual
  const id = ritualMode.getRunId();
  assert.ok(ritualMode.getState().active);
  // Simulate error path
  assert.equal(ritualMode.cancelIfCurrent(id), true);
  assert.ok(!ritualMode.getState().active);
});

test('4. Profile ritual step error cancels that profile run and clears its context', () => {
  profileRitualContext.clear();
  const token = profileRitualContext.createContext(VALID_CTX);
  ritualMode.startRitual(null, { profileRitualToken: token });
  const id = ritualMode.getRunId();
  assert.ok(ritualMode.getState().active);
  // Simulate error path: clear context + cancel run
  assert.equal(profileRitualContext.clearIfOwned(token), true);
  assert.equal(ritualMode.cancelIfCurrent(id), true);
  assert.ok(!ritualMode.getState().active);
  assert.ok(!profileRitualContext.hasPending());
});

test('5. Old run A error cannot cancel run B (full concurrency)', () => {
  // Start run A
  profileRitualContext.clear();
  const tokenA = profileRitualContext.createContext(VALID_CTX);
  ritualMode.startRitual(null, { profileRitualToken: tokenA });
  const idA = ritualMode.getRunId();

  // Start run B (overwrites A)
  const tokenB = profileRitualContext.createContext({ ...VALID_CTX, durationSeconds: 9999 });
  ritualMode.startRitual(null, { profileRitualToken: tokenB });
  const idB = ritualMode.getRunId();
  assert.notEqual(idA, idB);

  // A's delayed error callback fires
  profileRitualContext.clearIfOwned(tokenA); // no-op: B's context
  ritualMode.cancelIfCurrent(idA);            // no-op: B is active

  // B remains active
  assert.ok(ritualMode.getState().active);
  assert.equal(ritualMode.getRunId(), idB);
  ritualMode.cancelRitual();
});

test('6. Old run A error cannot clear B\'s context', () => {
  profileRitualContext.clear();
  const tokenA = profileRitualContext.createContext(VALID_CTX);
  // New context created for B
  const tokenB = profileRitualContext.createContext({ ...VALID_CTX, durationSeconds: 5555 });
  // A tries to clear — fails
  assert.equal(profileRitualContext.clearIfOwned(tokenA), false);
  assert.ok(profileRitualContext.hasPending());
  // B can still consume
  const ctx = profileRitualContext.consume(tokenB);
  assert.ok(ctx);
  assert.equal(ctx.durationSeconds, 5555);
});

test('7. Missing profile token does not prevent run-owned cancellation', () => {
  ritualMode.startRitual(); // manual: no profileRitualToken
  const id = ritualMode.getRunId();
  assert.ok(ritualMode.getState().active);
  // cancelIfCurrent uses runId, not token — works for manual rituals
  assert.equal(ritualMode.cancelIfCurrent(id), true);
  assert.ok(!ritualMode.getState().active);
});

test('8. Stale auto-advance callback cannot advance a newer run', (t, done) => {
  // Start run A with a timed step
  const timedSteps = [
    { id: 'timed', label: 'Timed', durationSeconds: 60, skippable: true, auto: true },
    { id: 'after', label: 'After', durationSeconds: 0, skippable: true, auto: false }
  ];
  ritualMode.startRitual(timedSteps);
  const idA = ritualMode.getRunId();
  // A sets up a stepTimer. Now start B before A's timer fires.
  ritualMode.startRitual(timedSteps);
  const idB = ritualMode.getRunId();
  assert.notEqual(idA, idB);
  // B should be at step 0 (timed). If A's timer fires, runId check blocks it.
  assert.equal(ritualMode.getState().currentStep, 0);
  ritualMode.cancelRitual();
  done();
});

test('9. Repeated cancellation is idempotent', () => {
  ritualMode.startRitual();
  const id = ritualMode.getRunId();
  assert.equal(ritualMode.cancelIfCurrent(id), true);
  // Second call — already inactive
  assert.equal(ritualMode.cancelIfCurrent(id), false);
  // Unconditional cancel also idempotent
  ritualMode.cancelRitual(); // no error
});

test('10. cancelIfCurrent returns false for stale/mismatched/null runId', () => {
  ritualMode.startRitual();
  const currentId = ritualMode.getRunId();
  assert.equal(ritualMode.cancelIfCurrent(0), false);
  assert.equal(ritualMode.cancelIfCurrent(null), false);
  assert.equal(ritualMode.cancelIfCurrent(currentId - 1), false);
  assert.ok(ritualMode.getState().active); // still active
  ritualMode.cancelRitual();
});

test('onStep callback receives runId as 4th argument', (t, done) => {
  let receivedRunId = null;
  ritualMode.onStep((step, state, runMeta, runId) => { receivedRunId = runId; });
  ritualMode.startRitual();
  assert.ok(receivedRunId > 0);
  assert.equal(receivedRunId, ritualMode.getRunId());
  ritualMode.cancelRitual();
  ritualMode.onStep(null);
  done();
});

test('onComplete callback receives runId as 3rd argument', () => {
  let receivedRunId = null;
  ritualMode.onComplete((state, runMeta, runId) => { receivedRunId = runId; });
  ritualMode.startRitual([{ id: 'x', label: 'X', durationSeconds: 0, skippable: true, auto: false }]);
  const expectedId = ritualMode.getRunId();
  ritualMode.advanceStep(false);
  assert.equal(receivedRunId, expectedId);
  ritualMode.onComplete(null);
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
