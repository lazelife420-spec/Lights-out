'use strict';

// Serializes only timer-owned changes. A late block must settle before its
// matching restore, and an old restore must finish before a new run blocks.
function createLifecycle({ block, unblock, onStatus = () => {}, blockingAllowed = true }) {
  let tail = Promise.resolve();
  let current = null;
  const pending = new Set();
  const retained = new Set();
  const queue = task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  const report = (session, result, blocked) => {
    if (session === current || result.success !== true) onStatus({
      blocked: result.success ? blocked : null,
      success: result.success === true,
      recoveryRequired: (pending.size > 0 || retained.size > 0) && !result.success,
      provider: session.config?.provider,
      // Provider failures may contain a credential-bearing URL. Never relay it.
      error: result.success ? null : 'Wi-Fi Guard could not confirm restoration. Restore internet before another power action.'
    });
  };
  async function restore(session) {
    if (!session.attempted || (!pending.has(session) && !retained.has(session))) return { success: true };
    let result;
    try { result = await unblock(session.config); }
    catch { result = { success: false }; }
    if (result?.success === true) { pending.delete(session); retained.delete(session); }
    else { retained.delete(session); pending.add(session); result = { success: false, recoveryRequired: true }; }
    report(session, result, false);
    return result;
  }
  function finish(session, { reason = 'cancel' } = {}) {
    if (!session) return tail.then(() => ({ success: pending.size === 0 && retained.size === 0 }));
    if (session.cleanup) return session.cleanup;
    session.closed = true;
    session.cleanup = queue(async () => {
      // The user's explicit keep-blocked option is retained. Uncertain or
      // failed blocks are always compensated, including partial router writes.
      // Retain is a cancellation choice only. Normal completion always restores.
      if (reason === 'cancel' && session.blockSucceeded && session.config.unblockOnCancel === false) {
        pending.delete(session);
        retained.add(session);
        return { success: false, retainedByChoice: true };
      }
      const result = await restore(session);
      return { ...result, success: result.success && pending.size === 0 && retained.size === 0 };
    });
    return session.cleanup;
  }
  return {
    blockingAvailable: blockingAllowed === true,
    begin({ dryRun = false } = {}) {
      if (current && !current.closed) finish(current);
      current = { dryRun: Boolean(dryRun), closed: false, attempted: false };
      return current;
    },
    block(session, config) {
      if (!session || session.dryRun || session.closed) return Promise.resolve({ success: true, skipped: true });
      if (session.blocking) return session.blocking;
      // Public candidate policy: no new mutation until durable recovery exists.
      // Do not enqueue or mark pending: no provider was called, so no automatic
      // compensation is authorized or necessary, including after recreation.
      if (blockingAllowed !== true) {
        const result = { success: false, code: 'WIFI_BLOCKING_UNAVAILABLE', mutationAttempted: false,
          error: 'Wi-Fi blocking is unavailable until crash-safe recovery is ready. No network change was requested.' };
        onStatus({ ...result, blockingAvailable: false, blocked: null, recoveryRequired: false });
        session.blocking = Promise.resolve(result);
        return session.blocking;
      }
      session.config = JSON.parse(JSON.stringify(config));
      session.queued = true;
      session.blocking = queue(async () => {
        session.queued = false;
        if (session.closed) return { success: true, skipped: true };
        if (pending.size || retained.size) {
          const result = { success: false, recoveryRequired: true };
          report(session, result, null);
          return result;
        }
        session.attempted = true;
        pending.add(session);
        let result;
        try { result = await block(session.config); }
        catch { result = { success: false }; }
        if (result?.adapterId) session.config.adapterId = result.adapterId;
        session.blockSucceeded = result?.success === true;
        report(session, result || { success: false }, true);
        return result;
      });
      return session.blocking;
    },
    finish,
    restorePending() {
      return queue(async () => {
        for (const session of new Set([...pending, ...retained])) await restore(session);
        return { success: pending.size === 0, recoveryRequired: pending.size > 0 };
      });
    },
    hasPending: () => pending.size > 0 || retained.size > 0 || Boolean(current?.queued)
  };
}

module.exports = { createLifecycle };
