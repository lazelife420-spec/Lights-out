// Run Receipts: durable proof of every timer run.
// Append-only, local-only, no cloud telemetry.
// Stores in userData/run-receipts.json, keeps latest 100.

const path = require('path');
const { createPersistence } = require('./receiptPersistence');

const RECEIPTS_FILE = 'run-receipts.json';
const MAX_RECEIPTS = 100;
const RECEIPT_VERSION = 2;

let cache = null;
let configPath = null;
let persistence = null;

function storage() {
  if (!persistence) {
    const file = getConfigPath();
    persistence = file ? createPersistence(file, {
      diagnose: ({ code }) => console.warn('[receipt-persistence]', code, 'Proof save unavailable; timer intent is preserved.')
    }) : {
      load: () => ({ receipts: [] }), save: () => false,
      getStatus: () => ({ saved: false, pending: true, recoveredFrom: null, errorCode: 'USERDATA_UNAVAILABLE' })
    };
  }
  return persistence;
}

function getPersistenceStatus() { return storage().getStatus(); }
function view(receipt) { return receipt ? { ...receipt, persistence: getPersistenceStatus() } : null; }
function assertReadable(data) {
  if (!data.receipts.length && getPersistenceStatus().saved === false) {
    throw Object.assign(new Error('Receipts unavailable; existing history has been preserved'), { code: 'RECEIPTS_UNAVAILABLE' });
  }
}

// Lazily get the userData path. Falls back to os.tmpdir() if not in Electron.
function getConfigPath() {
  if (!configPath) {
    let userDataDir;
    try {
      const { app } = require('electron');
      userDataDir = app.getPath('userData');
    } catch {
      if (process.versions.electron) {
        console.warn('[receipt-persistence] USERDATA_UNAVAILABLE; no alternate user profile will be written.');
        return null;
      }
      const os = require('os');
      // Non-Electron callers have no application profile. Keep separate test /
      // CLI processes from corrupting each other's pending receipt transitions.
      configPath = path.join(os.tmpdir(), `lightsout-${process.pid}-${RECEIPTS_FILE}`);
      return configPath;
    }
    configPath = path.join(userDataDir, RECEIPTS_FILE);
  }
  return configPath;
}

function load() {
  if (cache) return cache;
  cache = storage().load();
  return cache;
}

function save(options) {
  return cache ? storage().save(cache, options) : false;
}

function generateId() {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Create a new receipt when a timer starts.
function createRunReceipt(timerState) {
  const receipt = {
    id: generateId(),
    version: RECEIPT_VERSION,
    startedAt: new Date().toISOString(),
    plannedEndsAt: timerState.endsAt || null,
    timerElapsedAt: null,
    endedAt: null,
    action: timerState.action || 'shutdown',
    profileId: timerState.profileId || null,
    profileName: timerState.profileName || null,
    nightModeId: timerState.nightModeId || null,
    nightModeTitle: timerState.nightModeTitle || null,
    nightModeVersion: timerState.nightModeVersion || null,
    durationSeconds: timerState.totalSeconds || 0,
    // Display only: where the run started (older receipts simply lack it).
    origin: typeof timerState.origin === 'string' ? timerState.origin : null,
    routineOccurrenceKey: timerState.routineOccurrenceKey || null,
    remainingSeconds: null,
    dryRun: !!timerState.dryRun,
    forceShutdown: !!timerState.forceShutdown,
    gracefulClose: timerState.gracefulClose !== false,
    result: 'running',
    pauseCount: 0,
    snoozeCount: 0,
    cancelReason: null,
    warningsShown: 0,
    lastLightSequence: null,
    powerCommand: null,
    notes: null
  };

  const data = load();
  data.receipts.push(receipt);
  prune(data);
  save();
  return view(receipt);
}

// Update a receipt by id.
function updateRunReceipt(id, updates) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  Object.assign(receipt, updates);
  save();
  return view(receipt);
}

// Capture events at their source. An exit status is never an OS outcome.
// Legacy result values remain stored intact and are interpreted at read time.
function recordActionEvent(id, event) {
  const allowed = ['timer_elapsed', 'action_requested', 'command_spawned', 'command_returned_success',
    'command_returned_failure', 'spawn_failed', 'outcome_unverified', 'cancelled', 'blocked'];
  if (!event || !allowed.includes(event.state)) throw new TypeError('Unknown action evidence');
  const receipt = load().receipts.find(r => r.id === id);
  if (!receipt) return null;
  const evidence = receipt.powerEvidence || { version: 1, systemOutcome: 'unverified', events: [] };
  const entry = { ...event, systemOutcome: 'unverified' };
  evidence.events.push(entry);
  evidence.systemOutcome = 'unverified';
  receipt.powerEvidence = evidence;
  receipt.result = entry.state;
  if (entry.state === 'timer_elapsed') receipt.timerElapsedAt = entry.at;
  if (entry.state === 'action_requested') receipt.powerCommand = entry.command
    ? [entry.command, ...(entry.arguments || [])].join(' ') : receipt.action;
  save();
  return view(receipt);
}

// Mark a receipt as paused (increment pauseCount).
function receiptPaused(id) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  receipt.pauseCount = (receipt.pauseCount || 0) + 1;
  save();
  return view(receipt);
}

// Mark a receipt as snoozed (increment snoozeCount).
function receiptSnoozed(id) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  receipt.snoozeCount = (receipt.snoozeCount || 0) + 1;
  save();
  return view(receipt);
}

// Mark a warning shown (increment warningsShown).
function receiptWarning(id) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  receipt.warningsShown = (receipt.warningsShown || 0) + 1;
  save();
  return view(receipt);
}

// Look up a single receipt by id (used to decide whether a persisted
// recovery snapshot still points at a live 'running' receipt).
function getReceiptById(id) {
  if (!id) return null;
  const data = load();
  return view(data.receipts.find(r => r.id === id));
}

function getReceiptByOccurrence(key) {
  if (!key) return null;
  return view(load().receipts.find(r => r.routineOccurrenceKey === key));
}

// Fallback correlation for a persisted activeTimer snapshot saved by a
// pre-upgrade build, before the snapshot carried receiptId. Only one timer
// can ever be running at a time, so if a still-valid recoverable snapshot
// exists but can't name its receipt directly, the most recently created
// 'running' receipt is it -- used so that migration boundary doesn't
// misclassify a genuinely still-recoverable run as orphaned.
function getMostRecentRunningReceiptId() {
  const data = load();
  for (let i = data.receipts.length - 1; i >= 0; i--) {
    if (data.receipts[i].result === 'running') return data.receipts[i].id;
  }
  return null;
}

// Startup reconciliation: a receipt can be left at result:'running' forever
// if the process that started it ended (crash, force-kill, power loss)
// before it ever reached a terminal update. That reads as a currently-active
// run in the receipt viewer and Copy Proof export indefinitely, which is
// false proof. Finalize every 'running' receipt as 'interrupted' EXCEPT the
// one identified by protectedReceiptId (the receipt tied to a still-valid,
// still-recoverable persisted timer snapshot, if any) -- that one stays
// 'running' until the user resumes, discards, cancels, or it completes.
// Idempotent: once a receipt leaves 'running' it is never touched again.
function reconcileOrphanedRunningReceipts(protectedReceiptId, reconciledAt) {
  const data = load();
  const timestamp = reconciledAt || new Date().toISOString();
  const reconciledIds = [];
  for (const receipt of data.receipts) {
    const inFlight = ['action_requested', 'command_spawned', 'completing'].includes(receipt.result);
    if (receipt.result !== 'running' && receipt.result !== 'timer_elapsed' && !inFlight) continue;
    if (!inFlight && protectedReceiptId && receipt.id === protectedReceiptId) continue;
    const lastState = receipt.result;
    receipt.result = inFlight ? 'outcome_unverified' : 'interrupted';
    if (!inFlight || !receipt.endedAt) receipt.endedAt = timestamp;
    receipt.reconciliationReason = inFlight ? 'host-ended-during-action; Windows outcome unknown' : 'orphaned-running-receipt';
    receipt.reconciledAt = timestamp;
    if (inFlight) {
      receipt.lastActionState = lastState;
      const evidence = receipt.powerEvidence || { version: 1, events: [] };
      evidence.systemOutcome = 'unverified';
      evidence.events.push({ state: 'outcome_unverified', at: timestamp, systemOutcome: 'unverified', reason: 'startup-reconciliation', lastState });
      receipt.powerEvidence = evidence;
    }
    reconciledIds.push(receipt.id);
  }
  if (reconciledIds.length) save();
  return reconciledIds;
}

// Get the latest receipt.
function getLatestReceipt() {
  const data = load();
  assertReadable(data);
  return view(data.receipts[data.receipts.length - 1]);
}

// List receipts (most recent first).
function listReceipts(limit = 20) {
  const data = load();
  assertReadable(data);
  return data.receipts.slice(-limit).reverse().map(view);
}

// All receipts, oldest first -- unlike listReceipts() (most-recent-first,
// capped at a display limit), this is the full stored ledger for export.
function getAllReceiptsForExport() {
  const data = load();
  assertReadable(data);
  return data.receipts.map(view);
}

// Clear all receipts.
function clearReceipts() {
  const previous = load();
  cache = { receipts: [] };
  const cleared = save({ recoverPending: false });
  if (!cleared) cache = previous;
  return { cleared };
}

// Prune to MAX_RECEIPTS, keeping the most recent.
function prune(data) {
  if (data.receipts.length > MAX_RECEIPTS) {
    data.receipts = data.receipts.slice(-MAX_RECEIPTS);
  }
}

// Get summary stats across all receipts. Two independent axes:
// - Outcome: every receipt lands in exactly one bucket, so completed +
//   cancelled + dryRun + blocked + interrupted + other always equals total
//   ('other' = running, completing or an unknown result). 'completed' is a
//   an unverified non-Test ending only; it never means Windows acted.
//   A completed result on a Test Mode receipt joins the 'dryRun' (Test
//   completed) bucket, so a Test Mode run is never counted as real.
// - Mode (UI-R3 Fire 10): testRuns (dryRun === true) + realRuns (dryRun ===
//   false) + unknownModeRuns (anything else, e.g. a receipt with no dryRun
//   field) always equals total. A missing mode is never counted as real.
// Read-only: nothing stored is changed.
function getReceiptStats() {
  const data = load();
  assertReadable(data);
  const receipts = data.receipts;
  const total = receipts.length;
  // Compatibility key 'completed' now labels UNVERIFIED endings in every UI.
  // Timer endings and independently observed Windows outcomes are separate.
  const isFinished = r => ['power_executed', 'completed', 'command_returned_success', 'outcome_unverified'].includes(r.result);
  const completed = receipts.filter(r => isFinished(r) && r.dryRun !== true).length;
  const cancelled = receipts.filter(r => r.result === 'cancelled').length;
  const dryRun = receipts.filter(r => r.result === 'dry_run_completed' || (isFinished(r) && r.dryRun === true)).length;
  const blocked = receipts.filter(r => ['blocked', 'error', 'spawn_failed', 'command_returned_failure'].includes(r.result)).length;
  const interrupted = receipts.filter(r => r.result === 'interrupted').length;
  const other = total - completed - cancelled - dryRun - blocked - interrupted;
  const testRuns = receipts.filter(r => r.dryRun === true).length;
  const realRuns = receipts.filter(r => r.dryRun === false).length;
  const unknownModeRuns = total - testRuns - realRuns;
  const timerFinished = receipts.filter(r => r.timerElapsedAt || ['power_executed', 'completed', 'dry_run_completed'].includes(r.result)).length;
  const legacyUnverified = receipts.filter(r => ['power_executed', 'completed'].includes(r.result) && r.dryRun !== true).length;
  return { total, completed, cancelled, dryRun, blocked, interrupted, other, testRuns, realRuns, unknownModeRuns,
    timerFinished, legacyUnverified, systemOutcomesObserved: 0, persistence: getPersistenceStatus() };
}

function reset() {
  cache = null;
  persistence = null;
}

module.exports = {
  createRunReceipt,
  updateRunReceipt,
  recordActionEvent,
  getPersistenceStatus,
  receiptPaused,
  receiptSnoozed,
  receiptWarning,
  getReceiptById,
  getReceiptByOccurrence,
  getMostRecentRunningReceiptId,
  reconcileOrphanedRunningReceipts,
  getLatestReceipt,
  listReceipts,
  getAllReceiptsForExport,
  clearReceipts,
  getReceiptStats,
  _load: load,
  _reset: reset,
  MAX_RECEIPTS,
  RECEIPT_VERSION
};
