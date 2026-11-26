'use strict';

// Subprocess evidence only. This module has no native executor of its own:
// production explicitly supplies spawn; qualification supplies a non-actuating fake.
// None of these events establishes that Windows changed its power state.
function commandForAction(action, forceShutdown = false) {
  switch (action) {
    case 'shutdown': return { file: 'shutdown.exe', args: forceShutdown ? ['/s', '/f', '/t', '0'] : ['/s', '/t', '0'] };
    case 'restart': return { file: 'shutdown.exe', args: forceShutdown ? ['/r', '/f', '/t', '0'] : ['/r', '/t', '0'] };
    // Suspend actions exclusively use the injected typed native adapter below.
    case 'sleep':
    case 'hibernate': return null;
    case 'lock': return { file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] };
    case 'logout': return { file: 'shutdown.exe', args: ['/l'] };
    default: return null;
  }
}

function createDispatcher({ spawn, suspend, now = () => new Date().toISOString(), observationMs = 3000,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  if (typeof spawn !== 'function') throw new TypeError('An explicit command executor is required');
  if (!Number.isFinite(observationMs) || observationMs <= 0 || observationMs > 30000) throw new TypeError('Bounded observation window required');
  return function dispatch({ action, forceShutdown = false, signal, onEvidence = () => {}, onDiagnostic = () => {} } = {}) {
    if (action === 'sleep' || action === 'hibernate') {
      if (typeof suspend === 'function') return suspend({ action, signal, onEvidence, onDiagnostic });
      onEvidence({ state: 'blocked', at: now(), systemOutcome: 'unverified', reason: 'native-suspend-adapter-unavailable' });
      return Promise.resolve({ success: false, status: 'blocked', systemOutcome: 'not_requested', reason: 'native-suspend-adapter-unavailable' });
    }
    const command = commandForAction(action, forceShutdown);
    const record = (state, details = {}) => {
      try { return onEvidence({ state, at: now(), systemOutcome: 'unverified', ...details }); }
      catch (error) {
        try { onDiagnostic({ code: 'PROOF_WRITE_FAILED', errorCode: error.code || 'UNKNOWN' }); } catch { /* reporting cannot block intent */ }
        return null;
      }
    };
    if (!command) {
      record('blocked', { reason: 'unknown-action' });
      return Promise.resolve({ success: false, status: 'blocked', systemOutcome: 'not_requested', error: `Unknown action: ${action}` });
    }
    if (signal?.aborted) {
      record('cancelled', { reason: 'cancelled-before-dispatch' });
      return Promise.resolve({ success: false, status: 'cancelled', systemOutcome: 'not_requested' });
    }
    // This synchronous callback completes the persistence attempt before spawn.
    // A failed proof write is surfaced, but never silently cancels the user's intent.
    record('action_requested', { command: command.file, arguments: command.args });
    if (signal?.aborted) {
      record('cancelled', { reason: 'cancelled-before-dispatch' });
      return Promise.resolve({ success: false, status: 'cancelled', systemOutcome: 'not_requested' });
    }
    return new Promise(resolve => {
      let child;
      let spawnCallReturned = false;
      let observedSpawn = false;
      let done = false;
      let deadline;
      const finish = (status, details = {}) => {
        if (done) return;
        done = true;
        if (deadline !== undefined) unschedule(deadline);
        signal?.removeEventListener('abort', onAbort);
        record(status, details);
        // All evidence listeners were attached and the bounded observation ended.
        // Never wait indefinitely or keep a detached command alive as app authority.
        child?.unref?.();
        resolve({ success: status === 'command_returned_success' || (status === 'outcome_unverified' && observedSpawn),
          status, commandSpawned: observedSpawn, systemOutcome: 'unverified', ...details });
      };
      const onAbort = () => finish('outcome_unverified', { reason: 'cancellation-after-dispatch; Windows action cannot be recalled here' });
      const returned = (code, signalName, event) => {
        const exitCode = Number.isInteger(code) ? code : null;
        const terminal = signalName || exitCode === null ? 'outcome_unverified'
          : exitCode === 0 ? 'command_returned_success' : 'command_returned_failure';
        finish(terminal, { exitCode, signal: signalName || null, observedEvent: event });
      };
      try {
        child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
        spawnCallReturned = true;
        if (!child || typeof child.on !== 'function') throw new TypeError('Executor must return an observable subprocess');
        child.on('error', error => finish(observedSpawn ? 'outcome_unverified' : 'spawn_failed', {
          errorCode: typeof error.code === 'string' ? error.code : 'UNKNOWN', observedEvent: 'error'
        }));
        child.on('spawn', () => {
          if (done || observedSpawn) return;
          observedSpawn = true;
          record('command_spawned', { pid: Number.isInteger(child.pid) ? child.pid : null });
        });
        child.on('exit', (code, signalName) => returned(code, signalName, 'exit'));
        child.on('close', (code, signalName) => returned(code, signalName, 'close'));
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        deadline = schedule(() => finish('outcome_unverified', { reason: 'observation-window-ended-without-terminal-event' }), observationMs);
      } catch (error) {
        finish(spawnCallReturned ? 'outcome_unverified' : 'spawn_failed', { errorCode: typeof error.code === 'string' ? error.code : 'UNKNOWN', observedEvent: 'throw' });
      }
    });
  };
}

module.exports = { commandForAction, createDispatcher };
