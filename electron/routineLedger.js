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
    dispatchResult(key, result, receiptId = null) {
      const data = load(), entry = data.entries.find(e => e.occurrenceKey === key);
      if (!entry || !['claimed', 'accepted'].includes(entry.status)) return;
      entry.status = result?.success ? (receiptId ? 'running' : 'accepted') : 'failed';
      entry.reason = result?.success ? null : (result?.code || 'start-failed');
      if (receiptId) entry.timerReceiptId = receiptId;
      entry.actions.forEach(a => { a.status = entry.status; }); persist(data);
    },
    timerStarted(key, receiptId) {
      const data = load(), entry = data.entries.find(e => e.occurrenceKey === key);
      if (!entry || !['claimed', 'accepted'].includes(entry.status)) return;
      entry.status = 'running'; entry.timerReceiptId = receiptId; entry.reason = null;
      entry.actions.forEach(a => { if (a.type === 'timer.start') a.status = 'running'; }); persist(data);
    },
    finishPending(key, status, reason) {
      const data = load(), entry = data.entries.find(e => e.occurrenceKey === key);
      if (!entry || entry.timerReceiptId || !['claimed', 'accepted'].includes(entry.status)) return;
      entry.status = status; entry.reason = reason;
      entry.actions.forEach(a => { a.status = status; }); persist(data);
    },
    interruptPending() {
      const data = load(); let changed = false;
      for (const entry of data.entries) if (!entry.timerReceiptId && ['claimed', 'accepted'].includes(entry.status)) {
        entry.status = 'interrupted'; entry.reason = 'app-restarted-before-timer';
        entry.actions.forEach(a => { a.status = 'interrupted'; }); changed = true;
      }
      if (changed) persist(data);
    },
    list(receiptById = () => null, receiptByOccurrence = () => null) {
      return load().entries.slice().reverse().map(entry => {
        const receipt = (entry.timerReceiptId ? receiptById(entry.timerReceiptId) : null) || receiptByOccurrence(entry.occurrenceKey);
        if (receipt) entry.timerReceiptId = receipt.id || entry.timerReceiptId;
        const result = receipt?.result;
        const status = { running: 'running', dry_run_completed: 'simulated', power_executed: 'unverified', completed: 'unverified',
          timer_elapsed: 'timer_elapsed', action_requested: 'action_requested', command_spawned: 'command_spawned',
          command_returned_success: 'unverified', outcome_unverified: 'unverified', command_returned_failure: 'command_returned_failure',
          spawn_failed: 'spawn_failed', cancelled: 'cancelled', interrupted: 'interrupted', blocked: 'failed', error: 'failed' }[result];
        if (status) { entry.status = status; entry.actions = entry.actions.map(a => a.type === 'timer.start' ? { ...a, status } : a); }
        entry.receiptAvailable = Boolean(receipt);
        if (receipt) { entry.commandStatus = result; entry.systemOutcome = 'unverified'; entry.proofSaved = receipt.persistence?.saved; }
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
