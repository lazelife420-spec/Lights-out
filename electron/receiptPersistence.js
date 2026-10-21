'use strict';

// Receipt-specific persistence. Does not migrate or alter other settings stores.
// The primary changes only via a verified, flushed pending file and atomic rename.
// Valid previous data, interrupted pending writes and corrupt originals survive.
function createPersistence(file, { fs = require('node:fs'), now = () => Date.now(), diagnose = () => {} } = {}) {
  let status = { saved: true, pending: false, recoveredFrom: null, errorCode: null };
  let loadBlocked = false;
  const valid = data => data && typeof data === 'object' && Array.isArray(data.receipts)
    && data.receipts.every(receipt => receipt && typeof receipt === 'object' && !Array.isArray(receipt));
  const revision = data => Number.isSafeInteger(data?.storeRevision) ? data.storeRevision : 0;
  function read(candidate) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      const data = JSON.parse(text);
      if (!valid(data)) throw Object.assign(new Error('Invalid receipt data'), { code: 'INVALID_RECEIPTS' });
      return { data, text, candidate };
    } catch (error) {
      return { error, candidate };
    }
  }
  function report(error) {
    const code = typeof error?.code === 'string' ? error.code : 'INVALID_JSON';
    status = { ...status, saved: false, pending: true, errorCode: code };
    try { diagnose({ code, message: 'Receipt persistence unavailable; power intent is not blocked.' }); } catch { /* diagnostic only */ }
  }
  function flushedWrite(target, text) {
    const descriptor = fs.openSync(target, 'w', 0o600);
    try { fs.writeFileSync(descriptor, text, 'utf8'); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    if (!valid(JSON.parse(fs.readFileSync(target, 'utf8')))) throw Object.assign(new Error('Receipt verification failed'), { code: 'VERIFY_FAILED' });
  }
  function load() {
    const primary = read(file);
    const pending = read(file + '.pending');
    const backup = read(file + '.bak');
    const chosen = pending.data && pending.data.pendingRecovery !== 'commit-only' && (!primary.data || revision(pending.data) > revision(primary.data))
      ? pending : primary.data ? primary : backup.data ? backup : null;
    if (chosen) {
      const recoveredFrom = chosen.candidate === file ? null : chosen.candidate === file + '.pending' ? 'pending' : 'backup';
      status = { saved: !recoveredFrom, pending: Boolean(recoveredFrom), recoveredFrom, errorCode: null };
      return chosen.data;
    }
    if ([primary, pending, backup].some(entry => entry.error?.code !== 'ENOENT')) {
      loadBlocked = true;
      report(primary.error);
    }
    return { receipts: [] };
  }
  function save(data, { recoverPending = true } = {}) {
    try {
      if (loadBlocked) throw Object.assign(new Error('Existing history cannot be read; retain all files until next recovery'), { code: 'RECEIPT_LOAD_BLOCKED' });
      if (!valid(data)) throw Object.assign(new Error('Invalid receipt data'), { code: 'INVALID_RECEIPTS' });
      const previous = read(file);
      data.storeRevision = Math.max(revision(data), revision(previous.data)) + 1;
      data.pendingRecovery = recoverPending ? 'recoverable' : 'commit-only';
      const text = JSON.stringify(data, null, 2);
      // Flush the transition before dispatch. Keep this recovery file on failure.
      flushedWrite(file + '.pending', text);
      if (previous.data) {
        flushedWrite(file + '.bak.pending', previous.text);
        fs.renameSync(file + '.bak.pending', file + '.bak');
      } else if (previous.error.code !== 'ENOENT') {
        // Never replace an unreadable/corrupt original without retaining its bytes.
        fs.copyFileSync(file, file + '.corrupt-' + now(), fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(file + '.pending', file);
      status = { saved: true, pending: false, recoveredFrom: status.recoveredFrom, errorCode: null };
      return true;
    } catch (error) { report(error); return false; }
  }
  return { load, save, getStatus: () => ({ ...status }) };
}

module.exports = { createPersistence };
