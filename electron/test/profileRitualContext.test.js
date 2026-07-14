// Unit tests for profileRitualContext: one-use pending timer context for
// profile-sourced standard ritual starts. Pure in-memory module, no Electron
// runtime needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const ctx = require('../profileRitualContext');

const VALID_CONTEXT = {
  durationSeconds: 1800,
  action: 'shutdown',
  dryRun: false,
  forceShutdown: false,
  muteSystem: false,
  gracePeriod: 2,
  profileId: 'abc123',
  profileName: 'Night Owl'
};

test('eligible origins include play and profile-start only', () => {
  assert.ok(ctx.isEligibleOrigin('play'));
  assert.ok(ctx.isEligibleOrigin('profile-start'));
  assert.ok(!ctx.isEligibleOrigin('tray'));
  assert.ok(!ctx.isEligibleOrigin('calendar'));
  assert.ok(!ctx.isEligibleOrigin('autopilot'));
  assert.ok(!ctx.isEligibleOrigin('remote'));
  assert.ok(!ctx.isEligibleOrigin('companion'));
  assert.ok(!ctx.isEligibleOrigin(null));
  assert.ok(!ctx.isEligibleOrigin(undefined));
  assert.ok(!ctx.isEligibleOrigin(''));
});

test('createContext stores a pending context and returns a token', () => {
  ctx.clear();
  const token = ctx.createContext(VALID_CONTEXT);
  assert.ok(token);
  assert.equal(typeof token, 'string');
  assert.ok(ctx.hasPending());
  assert.equal(ctx.getPendingToken(), token);
  ctx.clear();
});

test('createContext rejects null/undefined/non-object', () => {
  ctx.clear();
  assert.equal(ctx.createContext(null), null);
  assert.equal(ctx.createContext(undefined), null);
  assert.equal(ctx.createContext('string'), null);
  assert.ok(!ctx.hasPending());
});

test('consume returns context only with matching token', () => {
  ctx.clear();
  const token = ctx.createContext(VALID_CONTEXT);
  assert.equal(ctx.consume('wrong-token'), null);
  assert.ok(ctx.hasPending()); // still there
  const result = ctx.consume(token);
  assert.ok(result);
  assert.equal(result.durationSeconds, 1800);
  assert.equal(result.action, 'shutdown');
  assert.equal(result.profileId, 'abc123');
  assert.equal(result.profileName, 'Night Owl');
  assert.ok(!ctx.hasPending()); // consumed
});

test('consume with null token returns null (manual ritual has no token)', () => {
  ctx.clear();
  ctx.createContext(VALID_CONTEXT);
  assert.equal(ctx.consume(null), null);
  assert.ok(ctx.hasPending()); // still there — not consumed
  ctx.clear();
});

test('consume with undefined token returns null', () => {
  ctx.clear();
  ctx.createContext(VALID_CONTEXT);
  assert.equal(ctx.consume(undefined), null);
  assert.ok(ctx.hasPending());
  ctx.clear();
});

test('consumeAny is not exported (token-verified consume only)', () => {
  assert.equal(typeof ctx.consumeAny, 'undefined');
});

test('clear removes pending context', () => {
  ctx.clear();
  const token = ctx.createContext(VALID_CONTEXT);
  assert.ok(ctx.hasPending());
  ctx.clear();
  assert.ok(!ctx.hasPending());
  assert.equal(ctx.consume(token), null);
});

test('createContext overwrites stale context (new ritual start)', () => {
  ctx.clear();
  const token1 = ctx.createContext(VALID_CONTEXT);
  const token2 = ctx.createContext({ ...VALID_CONTEXT, durationSeconds: 3600 });
  assert.notEqual(token1, token2);
  // Old token is invalid
  assert.equal(ctx.consume(token1), null);
  // New token works
  const result = ctx.consume(token2);
  assert.ok(result);
  assert.equal(result.durationSeconds, 3600);
});

test('double consume with same token returns null (one-use)', () => {
  ctx.clear();
  const token = ctx.createContext(VALID_CONTEXT);
  const first = ctx.consume(token);
  assert.ok(first);
  const second = ctx.consume(token);
  assert.equal(second, null);
});

test('context preserves validated fields accurately', () => {
  ctx.clear();
  const input = {
    durationSeconds: 900,
    action: 'sleep',
    dryRun: true,
    forceShutdown: true,
    muteSystem: true,
    gracePeriod: 5,
    profileId: 'xyz789',
    profileName: 'Quick Nap'
  };
  const token = ctx.createContext(input);
  const result = ctx.consume(token);
  assert.equal(result.durationSeconds, 900);
  assert.equal(result.action, 'sleep');
  assert.equal(result.dryRun, true);
  assert.equal(result.forceShutdown, true);
  assert.equal(result.muteSystem, true);
  assert.equal(result.gracePeriod, 5);
  assert.equal(result.profileId, 'xyz789');
  assert.equal(result.profileName, 'Quick Nap');
  assert.ok(result.token);
  assert.ok(result.createdAt);
});

test('stale token from a previous context cannot consume a newer context', () => {
  ctx.clear();
  const staleToken = ctx.createContext(VALID_CONTEXT);
  // Simulate new ritual replacing context.
  const freshToken = ctx.createContext({ ...VALID_CONTEXT, durationSeconds: 7200 });
  // Stale token must not work.
  assert.equal(ctx.consume(staleToken), null);
  // Fresh token works.
  const result = ctx.consume(freshToken);
  assert.ok(result);
  assert.equal(result.durationSeconds, 7200);
});

test('safe origin defaults: null, undefined, empty string are not eligible', () => {
  assert.ok(!ctx.isEligibleOrigin(null));
  assert.ok(!ctx.isEligibleOrigin(undefined));
  assert.ok(!ctx.isEligibleOrigin(''));
  assert.ok(!ctx.isEligibleOrigin('direct'));
  assert.ok(!ctx.isEligibleOrigin('unknown'));
});

test('getPendingToken returns null when empty', () => {
  ctx.clear();
  assert.equal(ctx.getPendingToken(), null);
});
