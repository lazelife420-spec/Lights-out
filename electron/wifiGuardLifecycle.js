'use strict';

const RECOVERY_SCHEMA = 'lights-out.wifi-guard-recovery/v1';
const RECOVERY_PROVIDERS = new Set(['adapter', 'tplink', 'asus', 'netgear', 'webhook']);
const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

// Durable record of a timer-owned Wi-Fi block, so a crash, forced quit or power
// loss cannot leave internet blocked with nobody owning the restore. It holds
// only the provider and the adapter GUID captured before the adapter was
// disabled — never router credentials or webhook addresses (those stay in the
// encrypted settings and are read again at restore time).
function createFileJournal({ getFilePath, store = require('./durableJsonStore'), now = () => new Date().toISOString() }) {
  const file = () => getFilePath();
  return {
    record(entry = {}) {
      return store.writeTmpVerifyRename(file(), {
        schema: RECOVERY_SCHEMA,
        active: true,
        provider: String(entry.provider || ''),
        adapterId: typeof entry.adapterId === 'string' && GUID.test(entry.adapterId) ? entry.adapterId : null,
        retainedByChoice: entry.retainedByChoice === true,
        recordedAt: now()
      });
    },
    clear() {
      return store.writeTmpVerifyRename(file(), { schema: RECOVERY_SCHEMA, active: false, clearedAt: now() });
    },
    read() {
      let data = null;
      try { data = store.safeLoadJson(file()).data; } catch { return null; }
      if (!data || data.schema !== RECOVERY_SCHEMA || data.active !== true || !RECOVERY_PROVIDERS.has(data.provider)) return null;
      const adapterId = typeof data.adapterId === 'string' && GUID.test(data.adapterId) ? data.adapterId : null;
      return { provider: data.provider, adapterId, retainedByChoice: data.retainedByChoice === true, recordedAt: data.recordedAt || null };
    }
  };
}

// Serializes only timer-owned changes. A late block must settle before its
// matching restore, and an old restore must finish before a new run blocks.
function createLifecycle({ block, unblock, onStatus = () => {}, blockingAllowed = true, journal = null }) {
  let tail = Promise.resolve();
  let current = null;
  const pending = new Set();
  const retained = new Set();
  const queue = task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  // A journal write is part of the guarantee: a block is never requested
  // unless its recovery record is on disk first.
  const persist = write => {
    if (!journal) return true;
    try { return write() !== false; } catch { return false; }
  };
  const syncJournal = () => {
    if (!journal) return;
    const owned = [...pending, ...retained].find(session => session.attempted);
    if (!owned) persist(() => journal.clear());
    else persist(() => journal.record({ provider: owned.config?.provider, adapterId: owned.config?.adapterId || null, retainedByChoice: retained.has(owned) }));
  };
  const report = (session, result, blocked) => {
    if (session === current || result.success !== true) onStatus({
      blocked: result.success ? blocked : null,
      success: result.success === true,
      recoveryRequired: (pending.size > 0 || retained.size > 0) && !result.success,
      provider: session.config?.provider,
      // Provider failures may contain a credential-bearing URL. Never relay it.
      error: result.success ? null : (result.code === 'WIFI_RECOVERY_UNSAVED' ? result.error
        : 'Wi-Fi Guard could not confirm restoration. Restore internet before another power action.')
    });
  };
  async function restore(session) {
    if (!session.attempted || (!pending.has(session) && !retained.has(session))) return { success: true };
    let result;
    try { result = await unblock(session.config); }
    catch { result = { success: false }; }
    if (result?.success === true) { pending.delete(session); retained.delete(session); }
    else { retained.delete(session); pending.add(session); result = { success: false, recoveryRequired: true }; }
    syncJournal();
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
        syncJournal();
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
      // Build policy switch: blockingAllowed:false refuses every new mutation
      // (main.js ships true; durable recovery is the journal above).
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
        const unsaved = { success: false, code: 'WIFI_RECOVERY_UNSAVED', mutationAttempted: false,
          error: 'Wi-Fi Guard could not save its recovery record. No network change was requested.' };
        if (!persist(() => journal.record({ provider: session.config.provider, adapterId: null, retainedByChoice: false }))) {
          report(session, unsaved, null);
          return unsaved;
        }
        session.attempted = true;
        pending.add(session);
        // The adapter provider captures the GUID it is about to disable and
        // hands it here first: once the record names a GUID, a later process
        // can restore exactly that adapter; without one, nothing was disabled.
        const hooks = {
          beforeMutation: info => {
            if (info && typeof info.adapterId === 'string') session.config.adapterId = info.adapterId;
            if (!persist(() => journal.record({ provider: session.config.provider, adapterId: session.config.adapterId || null, retainedByChoice: false }))) {
              throw Object.assign(new Error(unsaved.error), { code: unsaved.code });
            }
          }
        };
        let result;
        try { result = await block(session.config, hooks); }
        catch { result = { success: false }; }
        if (result?.adapterId) session.config.adapterId = result.adapterId;
        if (result && result.mutationAttempted === false) {
          // Refused before any network change: nothing to compensate.
          pending.delete(session);
          session.attempted = false;
          syncJournal();
          report(session, result, null);
          return result;
        }
        session.blockSucceeded = result?.success === true;
        syncJournal();
        report(session, result || { success: false }, true);
        return result;
      });
      return session.blocking;
    },
    finish,
    // A previous process left a timer-owned block behind (crash, forced quit,
    // power loss). Re-own it so Restore internet and automatic recovery work.
    // Credentials come from current settings; the record supplies only the
    // provider and the captured adapter GUID.
    adopt(entry, config) {
      if (!entry || !RECOVERY_PROVIDERS.has(entry.provider)) return null;
      const session = {
        dryRun: false, closed: true, attempted: true, blockSucceeded: true, recovered: true,
        config: { ...JSON.parse(JSON.stringify(config || {})), provider: entry.provider, adapterId: entry.adapterId || undefined }
      };
      (entry.retainedByChoice ? retained : pending).add(session);
      return session;
    },
    restorePending() {
      return queue(async () => {
        for (const session of new Set([...pending, ...retained])) await restore(session);
        return { success: pending.size === 0, recoveryRequired: pending.size > 0 };
      });
    },
    // On quit: restore every block the user did not deliberately keep. A
    // deliberately retained block stays recorded for the next launch.
    restoreForQuit() {
      return queue(async () => {
        for (const session of new Set(pending)) await restore(session);
        return { success: pending.size === 0 };
      });
    },
    hasPending: () => pending.size > 0 || retained.size > 0 || Boolean(current?.queued),
    hasUnretainedPending: () => pending.size > 0 || Boolean(current?.queued)
  };
}

module.exports = { createLifecycle, createFileJournal, RECOVERY_SCHEMA };
