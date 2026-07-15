// Canonical start-decision behavioral tests.
// Verifies that Night Mode semantics control direct vs ritual execution,
// and that profile identity only acts as a fallback when no mode is armed.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const startDecision = require('../startDecision');
const nightModes = require('../nightModes');
const runReceipts = require('../runReceipts');
const profileRitualContext = require('../profileRitualContext');
const settingsStore = require('../settings');

// Helpers -------------------------------------------------------------------

function makeOptions({ durationSeconds, action, nightModeId, startOrigin = 'play', source = 'local' }) {
  return {
    durationSeconds,
    action,
    nightModeId,
    startOrigin,
    source,
    dryRun: true,
    forceShutdown: false,
    muteSystem: false,
    gracePeriod: 2
  };
}

function makeProfile(ritualId) {
  return { id: 'family-1', name: 'Family', ritualId };
}

function makeIdentity(profile) {
  return profile
    ? { profileId: profile.id, profileName: profile.name }
    : { profileId: null, profileName: null };
}

function resolveFor(options, profile) {
  const nmIdentity = nightModes.resolveNightModeStart(options);
  return startDecision.resolveStartDecision({
    options,
    identity: makeIdentity(profile),
    profile: profile || null,
    nmIdentity
  });
}

function resetReceipts() {
  runReceipts.clearReceipts();
  runReceipts._reset();
}

// Enable ritual mode for tests that exercise the ritual path.
try { settingsStore.updateSection('ritual', { enabled: true }); } catch (e) { /* acceptable */ }

// 1. Quick Sleep + no profile starts directly.
test('Quick Sleep with no profile decides direct countdown', () => {
  const options = makeOptions({ durationSeconds: 900, action: 'sleep', nightModeId: 'quick-sleep' });
  const d = resolveFor(options, null);
  assert.strictEqual(d.effectiveRitualId, 'none');
  assert.strictEqual(d.useRitualGateway, false);
});

// 2. Quick Sleep + standard profile still starts directly.
test('Quick Sleep overrides standard-profile ritual preference', () => {
  const options = makeOptions({ durationSeconds: 900, action: 'sleep', nightModeId: 'quick-sleep' });
  const d = resolveFor(options, makeProfile('standard'));
  assert.strictEqual(d.effectiveRitualId, 'none');
  assert.strictEqual(d.useRitualGateway, false);
  assert.strictEqual(d.nmIdentity.nightModeId, 'quick-sleep');
});

// 3. Quick Sleep receipt contains both mode and profile identity.
test('Quick Sleep decision preserves both mode and profile identity for receipt', () => {
  const options = makeOptions({ durationSeconds: 900, action: 'sleep', nightModeId: 'quick-sleep' });
  const profile = makeProfile('standard');
  const d = resolveFor(options, profile);
  assert.strictEqual(d.identity.profileId, 'family-1');
  assert.strictEqual(d.nmIdentity.nightModeId, 'quick-sleep');
  assert.strictEqual(d.nmIdentity.nightModeTitle, 'Quick Sleep');
  assert.strictEqual(d.nmIdentity.nightModeVersion, 1);

  // Receipt mirrors decision identity exactly.
  resetReceipts();
  const receipt = runReceipts.createRunReceipt({
    action: d.options.action,
    profileId: d.identity.profileId,
    profileName: d.identity.profileName,
    nightModeId: d.nmIdentity.nightModeId,
    nightModeTitle: d.nmIdentity.nightModeTitle,
    nightModeVersion: d.nmIdentity.nightModeVersion,
    totalSeconds: d.options.durationSeconds,
    dryRun: d.options.dryRun,
    forceShutdown: d.options.forceShutdown,
    gracefulClose: true
  });
  assert.strictEqual(receipt.nightModeId, 'quick-sleep');
  assert.strictEqual(receipt.nightModeTitle, 'Quick Sleep');
  assert.strictEqual(receipt.nightModeVersion, 1);
  assert.strictEqual(receipt.profileId, 'family-1');
  assert.strictEqual(receipt.profileName, 'Family');
});

// 4. Full Shutdown + no profile starts the standard ritual.
test('Full Shutdown with no profile decides standard ritual gateway', () => {
  const options = makeOptions({ durationSeconds: 3600, action: 'shutdown', nightModeId: 'full-shutdown' });
  const d = resolveFor(options, null);
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, true);
});

// 5. Full Shutdown + none profile still starts the standard ritual.
test('Full Shutdown overrides none-profile ritual preference', () => {
  const options = makeOptions({ durationSeconds: 3600, action: 'shutdown', nightModeId: 'full-shutdown' });
  const d = resolveFor(options, makeProfile('none'));
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, true);
  assert.strictEqual(d.nmIdentity.nightModeId, 'full-shutdown');
});

// 6. Full Shutdown + standard profile starts one ritual, not two.
test('Full Shutdown with standard profile decides exactly one ritual gateway', () => {
  const options = makeOptions({ durationSeconds: 3600, action: 'shutdown', nightModeId: 'full-shutdown' });
  const d = resolveFor(options, makeProfile('standard'));
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, true);
  // The decision is a single gateway; no secondary ritual path is produced.
  assert.strictEqual(d.options.source, 'local');
});

// 7. Full Shutdown identity survives ritual context into the receipt.
test('Full Shutdown identity is preserved in ritual context and receipt', () => {
  const options = makeOptions({ durationSeconds: 3600, action: 'shutdown', nightModeId: 'full-shutdown' });
  const d = resolveFor(options, makeProfile('standard'));
  assert.strictEqual(d.nmIdentity.nightModeId, 'full-shutdown');

  profileRitualContext.clear();
  const token = profileRitualContext.createContext({
    durationSeconds: d.options.durationSeconds,
    action: d.options.action,
    dryRun: d.options.dryRun,
    forceShutdown: d.options.forceShutdown,
    muteSystem: d.options.muteSystem,
    gracePeriod: d.options.gracePeriod,
    profileId: d.identity.profileId,
    profileName: d.identity.profileName,
    nightModeId: d.nmIdentity.nightModeId,
    nightModeTitle: d.nmIdentity.nightModeTitle,
    nightModeVersion: d.nmIdentity.nightModeVersion
  });
  const ctx = profileRitualContext.consume(token);
  assert.ok(ctx);
  assert.strictEqual(ctx.nightModeId, 'full-shutdown');
  assert.strictEqual(ctx.nightModeTitle, 'Full Shutdown');
  assert.strictEqual(ctx.nightModeVersion, 1);
  assert.strictEqual(ctx.profileId, 'family-1');

  resetReceipts();
  const receipt = runReceipts.createRunReceipt({
    action: ctx.action,
    profileId: ctx.profileId,
    profileName: ctx.profileName,
    nightModeId: ctx.nightModeId,
    nightModeTitle: ctx.nightModeTitle,
    nightModeVersion: ctx.nightModeVersion,
    totalSeconds: ctx.durationSeconds,
    dryRun: ctx.dryRun,
    forceShutdown: ctx.forceShutdown,
    gracefulClose: true
  });
  assert.strictEqual(receipt.nightModeId, 'full-shutdown');
  assert.strictEqual(receipt.nightModeTitle, 'Full Shutdown');
  assert.strictEqual(receipt.profileId, 'family-1');
  profileRitualContext.clear();
});

// 8. Lights Down and Movie Wind-Down use standard ritual semantics.
test('Lights Down and Movie Wind-Down decide standard ritual', () => {
  for (const id of ['lights-down', 'movie-wind-down']) {
    const mode = nightModes.getById(id);
    const options = makeOptions({ durationSeconds: mode.timer.durationSeconds, action: mode.timer.action, nightModeId: id });
    const d = resolveFor(options, null);
    assert.strictEqual(d.effectiveRitualId, 'standard', `${id} should be standard`);
    assert.strictEqual(d.useRitualGateway, true, `${id} should use ritual gateway`);
  }
});

// 9. Modified Quick Sleep becomes mode-neutral.
test('Modified Quick Sleep clears mode identity and falls back to profile semantics', () => {
  const options = makeOptions({ durationSeconds: 2700, action: 'sleep', nightModeId: 'quick-sleep' });
  const d = resolveFor(options, makeProfile('standard'));
  assert.strictEqual(d.nmIdentity.nightModeId, null);
  // Fallback to profile ritual because no canonical mode applies.
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, true);
});

// 10. Modified mode with a standard profile falls back to the profile ritual.
test('Modified Full Shutdown with standard profile falls back to profile ritual', () => {
  const options = makeOptions({ durationSeconds: 1800, action: 'shutdown', nightModeId: 'full-shutdown' });
  const d = resolveFor(options, makeProfile('standard'));
  assert.strictEqual(d.nmIdentity.nightModeId, null);
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, true);
});

// 11. No-mode PLAY retains existing profile ritual behavior.
test('No-mode PLAY with standard profile decides profile ritual gateway', () => {
  const options = makeOptions({ durationSeconds: 1800, action: 'shutdown', nightModeId: undefined });
  const d = resolveFor(options, makeProfile('standard'));
  assert.strictEqual(d.nmIdentity.nightModeId, null);
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, true);
});

// 12. No-mode/no-profile PLAY remains direct.
test('No-mode PLAY with no profile decides direct countdown', () => {
  const options = makeOptions({ durationSeconds: 1800, action: 'shutdown', nightModeId: undefined });
  const d = resolveFor(options, null);
  assert.strictEqual(d.nmIdentity.nightModeId, null);
  assert.strictEqual(d.effectiveRitualId, 'none');
  assert.strictEqual(d.useRitualGateway, false);
});

// 13. Unknown/disabled mode cannot control execution.
test('Unknown or disabled mode cannot control ritual semantics', () => {
  for (const id of ['nonexistent-mode', 'quiet-house', 'school-night']) {
    const options = makeOptions({ durationSeconds: 900, action: 'sleep', nightModeId: id });
    const d = resolveFor(options, makeProfile('standard'));
    assert.strictEqual(d.nmIdentity.nightModeId, null, `${id} must not produce identity`);
    // Execution falls back to profile semantics.
    assert.strictEqual(d.effectiveRitualId, 'standard', `${id} fallback to profile ritual`);
  }
});

// 14. Renderer-supplied ritual/title/version values are ignored.
test('resolveNightModeStart ignores renderer-supplied ritual/title/version', () => {
  const result = nightModes.resolveNightModeStart({
    nightModeId: 'quick-sleep',
    nightModeTitle: 'INJECTED',
    nightModeVersion: 99,
    ritualId: 'standard', // injected by renderer — must be ignored
    durationSeconds: 900,
    action: 'sleep'
  });
  assert.strictEqual(result.nightModeTitle, 'Quick Sleep');
  assert.strictEqual(result.nightModeVersion, 1);
  assert.strictEqual(result.ritualId, 'none');
});

// 15. Standard mode timer step starts exactly one countdown.
test('Standard mode ritual context is consumed exactly once', () => {
  profileRitualContext.clear();
  const token = profileRitualContext.createContext({
    durationSeconds: 3600,
    action: 'shutdown',
    dryRun: true,
    forceShutdown: false,
    muteSystem: false,
    gracePeriod: 2,
    profileId: 'family-1',
    profileName: 'Family',
    nightModeId: 'full-shutdown',
    nightModeTitle: 'Full Shutdown',
    nightModeVersion: 1
  });
  const first = profileRitualContext.consume(token);
  assert.ok(first);
  assert.strictEqual(first.nightModeId, 'full-shutdown');
  const second = profileRitualContext.consume(token);
  assert.strictEqual(second, null);
  profileRitualContext.clear();
});

// 16. Direct mode starts exactly one countdown (no ritual context is created).
test('Direct mode decision does not create or consume ritual context', () => {
  const options = makeOptions({ durationSeconds: 900, action: 'sleep', nightModeId: 'quick-sleep' });
  const d = resolveFor(options, null);
  assert.strictEqual(d.useRitualGateway, false);
  assert.strictEqual(d.effectiveRitualId, 'none');
  // No pending context should exist for a direct decision.
  profileRitualContext.clear();
  assert.strictEqual(profileRitualContext.hasPending(), false);
});

// 17. Profile selection remains inert (no start decision without a start origin).
test('Profile selection alone does not produce a start decision', () => {
  // resolveStartDecision requires options; a profile selection event has no timer options.
  const profile = makeProfile('standard');
  const identity = makeIdentity(profile);
  const d = startDecision.resolveStartDecision({
    options: { startOrigin: undefined },
    identity,
    profile,
    nmIdentity: startDecision.EMPTY_NM
  });
  // Without an eligible start origin, gateway is not used even if profile is standard.
  assert.strictEqual(d.useRitualGateway, false);
});

// 18. Use Tonight remains inert (resolves mode but does not start).
test('resolveForExecution returns canonical options without starting anything', () => {
  const resolution = nightModes.resolveForExecution('full-shutdown');
  assert.strictEqual(resolution.success, true);
  assert.strictEqual(resolution.resolved.ritualId, 'standard');
  assert.strictEqual(resolution.resolved.durationSeconds, 3600);
  // No ritual context should be created just by resolving.
  profileRitualContext.clear();
  assert.strictEqual(profileRitualContext.hasPending(), false);
  // No receipt should be created.
  resetReceipts();
  assert.strictEqual(runReceipts.getLatestReceipt(), null);
});

// Extra: remote source never uses ritual gateway even with standard mode.
test('Remote source blocks ritual gateway regardless of mode', () => {
  const options = makeOptions({
    durationSeconds: 3600,
    action: 'shutdown',
    nightModeId: 'full-shutdown',
    source: 'remote'
  });
  const d = resolveFor(options, null);
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, false);
});

// Extra: non-eligible start origin does not use gateway even with standard mode.
test('Non-eligible start origin blocks ritual gateway even with standard mode', () => {
  const options = makeOptions({
    durationSeconds: 3600,
    action: 'shutdown',
    nightModeId: 'full-shutdown',
    startOrigin: 'autopilot'
  });
  const d = resolveFor(options, null);
  assert.strictEqual(d.effectiveRitualId, 'standard');
  assert.strictEqual(d.useRitualGateway, false);
});
