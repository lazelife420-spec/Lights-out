'use strict';
const { randomBytes } = require('node:crypto');

// No executor is imported here. Production supplies spawn explicitly; tests
// supply pipes or a separately compiled helper with no reachable native API.
function createSuspendDispatcher({ spawn, helperPath, platform = process.platform,
  preparationMs = 5000, observationMs = 3000 } = {}) {
  if (typeof spawn !== 'function' || typeof helperPath !== 'string' || !helperPath) throw new TypeError('Explicit suspend helper executor and path required');
  for (const ms of [preparationMs, observationMs]) if (!Number.isFinite(ms) || ms <= 0 || ms > 30000) throw new TypeError('Bounded suspend observation required');
  let busy = false;
  return function suspend({ action, signal, onEvidence = () => {}, onDiagnostic = () => {} } = {}) {
    const record = (state, detail = {}) => {
      try { onEvidence({ state, at: new Date().toISOString(), systemOutcome: 'unverified', api: 'SetSuspendState', ...detail }); }
      catch (error) { try { onDiagnostic({ code: 'PROOF_WRITE_FAILED', errorCode: error.code || 'UNKNOWN' }); } catch { /* evidence never invents success */ } }
    };
    const refuse = (state, reason) => { record(state, { reason }); return Promise.resolve({ success: false, status: state, reason, systemOutcome: 'not_requested' }); };
    if (!['sleep', 'hibernate'].includes(action)) return refuse('blocked', 'invalid-suspend-action');
    if (signal?.aborted) return refuse('cancelled', 'cancelled-before-commit');
    if (platform !== 'win32') return refuse('blocked', 'unsupported-platform');
    if (busy) return refuse('blocked', 'suspend-request-in-progress');
    busy = true;
    return new Promise(resolve => {
      const requestId = randomBytes(16).toString('hex');
      let child, committed = false, invoking = false, ready = false, terminal = false;
      let settled = false, output = '', bytes = 0, response = null, deadline;
      const settle = result => { if (!settled) { settled = true; resolve(result); } };
      const result = (state, detail = {}) => ({ success: state === 'command_returned_success', status: state,
        systemOutcome: committed ? 'unverified' : 'not_requested', requestCommitted: committed, ...detail });
      const finish = (state, detail = {}, kill = false) => {
        if (terminal) return;
        terminal = true; clearTimeout(deadline); signal?.removeEventListener('abort', abort);
        record(state, detail); settle(result(state, detail));
        // After commit a Windows API may be suspended until resume. Do not kill,
        // retry, fall back, or claim a cancellation can recall that request.
        if (kill && !committed) { try { child?.kill(); } catch { /* process already gone */ } }
        if (!child) busy = false;
      };
      const pending = reason => {
        if (terminal || settled) return;
        record('outcome_unverified', { reason, nativeInvoking: invoking });
        settle(result('outcome_unverified', { reason }));
        child?.unref?.(); child?.stdout?.unref?.(); child?.stderr?.unref?.();
      };
      const abort = () => {
        if (committed) pending('cancel-after-commit; Windows request cannot be recalled');
        else finish('cancelled', { reason: 'cancelled-before-commit' }, true);
      };
      const protocolError = reason => finish(committed ? 'outcome_unverified' : 'blocked', { reason }, !committed);
      const message = line => {
        let msg;
        try { msg = JSON.parse(line); } catch { protocolError('invalid-helper-json'); return; }
        if (terminal) return;
        if (msg?.type === 'error' && !committed) { finish('blocked', { reason: msg.reason || 'helper-error', errorCode: msg.errorCode || 0 }, true); return; }
        if (!msg || msg.requestId !== requestId) { protocolError('invalid-helper-request-id'); return; }
        if (msg.type === 'ready' && !ready && !committed && msg.version === 1 && msg.action === action && msg.capabilities?.[action] === true) {
          ready = true;
          if (signal?.aborted) { abort(); return; }
          record('action_requested', { command: 'WindowsSuspend.exe', arguments: [action], requestId, capabilities: msg.capabilities });
          if (signal?.aborted) { abort(); return; }
          // Synchronous intent persistence above precedes the one-use commit.
          committed = true;
          clearTimeout(deadline);
          deadline = setTimeout(() => pending('native-return-not-yet-observed'), observationMs);
          child.stdin.end('commit:' + requestId + '\n');
        } else if (msg.type === 'invoking' && committed && !invoking && msg.api === 'SetSuspendState') {
          invoking = true;
          record('command_spawned', { requestId, nativeInvoking: true });
        } else if (msg.type === 'result' && !response && msg.result && typeof msg.result.requested === 'boolean' && typeof msg.result.accepted === 'boolean' &&
          Number.isInteger(msg.result.errorCode) && msg.result.systemOutcome === 'unverified' &&
          ((!msg.result.requested && !msg.result.accepted && msg.result.status === 'blocked') ||
            (committed && invoking && msg.result.requested && ['accepted', 'failed', 'unknown'].includes(msg.result.status) && (msg.result.status === 'accepted') === msg.result.accepted))) {
          response = msg.result;
        } else protocolError('invalid-helper-protocol');
      };
      try {
        child = spawn(helperPath, ['--serve', action, requestId], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.on('error', () => protocolError('helper-input-failed'));
        child.stdout.on('data', chunk => {
          if (terminal) return;
          bytes += chunk.length;
          if (bytes > 16384) { protocolError('helper-output-limit'); return; }
          output += chunk.toString('utf8');
          let end;
          while ((end = output.indexOf('\n')) >= 0 && !terminal) { const line = output.slice(0, end).trim(); output = output.slice(end + 1); if (line) message(line); }
        });
        child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 16384) protocolError('helper-output-limit'); });
        child.on('error', error => { busy = false; finish(committed ? 'outcome_unverified' : 'spawn_failed', { errorCode: error.code || 'UNKNOWN' }); });
        child.on('close', (code, signalName) => {
          busy = false;
          if (terminal) return;
          if (output.trim() || code !== 0 || signalName || !response) {
            finish(committed ? 'outcome_unverified' : 'blocked', { reason: 'helper-ended-without-valid-result', exitCode: code }); return;
          }
          const state = response.status === 'accepted' ? 'command_returned_success' : response.status === 'failed' ? 'command_returned_failure'
            : response.status === 'blocked' ? 'blocked' : 'outcome_unverified';
          finish(state, { reason: response.reason, errorCode: response.errorCode, nativeAccepted: response.accepted,
            nativeRequested: response.requested, cleanupErrorCode: response.cleanupErrorCode || 0, exitCode: code });
        });
        signal?.addEventListener('abort', abort, { once: true });
        deadline = setTimeout(() => finish('blocked', { reason: 'helper-preparation-timeout' }, true), preparationMs);
        if (signal?.aborted) abort();
      } catch (error) { busy = false; finish(committed ? 'outcome_unverified' : 'spawn_failed', { errorCode: error.code || 'UNKNOWN' }, !committed); }
    });
  };
}
module.exports = { createSuspendDispatcher };
