'use strict';
const fs = require('node:fs');
const model = require('./routineModel');
const { writeTmpVerifyRename } = require('./durableJsonStore');

function createLedger({ read, write }) {
  function load() {
    const data = read() || { schemaVersion: 1, entries: [] };
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw Error('Routine ledger is unreadable');
    return structuredClone(data);
  }
  function persist(data) { if (!write(data)) throw Error('Could not persist routine occurrence'); }
  return {
    claim(plan, day, scheduledFor) {
      const occurrenceKey = model.occurrenceKey(plan, day), data = load();
      if (data.entries.some(e => e.occurrenceKey === occurrenceKey)) return null;
      const entry = { schemaVersion: 1, occurrenceKey, routineId: plan.id, name: plan.name,
        owner: plan.owner, scheduledFor, status: 'claimed', at: new Date().toISOString(),
        actions: plan.actions.map(a => ({ id: a.id, type: a.type, target: a.target, status: 'pending' })) };
      data.entries.push(entry); data.entries = data.entries.slice(-256); persist(data);
      return structuredClone(entry);
    },
    update(key, patch) {
      const data = load(), entry = data.entries.find(e => e.occurrenceKey === key);
      if (!entry) return null;
      Object.assign(entry, patch); persist(data); return structuredClone(entry);
    },
    list(receiptById = () => null) {
      return load().entries.slice().reverse().map(entry => {
        const result = entry.timerReceiptId ? receiptById(entry.timerReceiptId)?.result : null;
        const status = { dry_run_completed: 'simulated', power_executed: 'completed', cancelled: 'cancelled',
          interrupted: 'interrupted', blocked: 'failed', error: 'failed' }[result];
        if (status) { entry.status = status; entry.actions = entry.actions.map(a => a.type === 'timer.start' ? { ...a, status } : a); }
        return entry;
      });
    }
  };
}
function createFileLedger(getFile) {
  return createLedger({ read: () => {
    if (!fs.existsSync(getFile())) return null;
    const data = JSON.parse(fs.readFileSync(getFile(), 'utf8'));
    if (!data || typeof data !== 'object') throw Error('Routine ledger is unreadable');
    return data;
  },
    write: data => writeTmpVerifyRename(getFile(), data) });
}
module.exports = { createLedger, createFileLedger };
