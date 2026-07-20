// Run Receipts: durable proof of every timer run.
// Append-only, local-only, no cloud telemetry.
// Stores in userData/run-receipts.json, keeps latest 100.

const fs = require('fs');
const path = require('path');

const RECEIPTS_FILE = 'run-receipts.json';
const MAX_RECEIPTS = 100;
const RECEIPT_VERSION = 1;

let cache = null;
let configPath = null;

// Lazily get the userData path. Falls back to os.tmpdir() if not in Electron.
function getConfigPath() {
  if (!configPath) {
    let userDataDir;
    try {
      const { app } = require('electron');
      userDataDir = app.getPath('userData');
    } catch {
      const os = require('os');
      userDataDir = os.tmpdir();
    }
    configPath = path.join(userDataDir, RECEIPTS_FILE);
  }
  return configPath;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    // Validate structure.
    if (!Array.isArray(parsed.receipts)) throw new Error('bad structure');
    cache = parsed;
  } catch {
    // Malformed or missing file: recover safely.
    cache = { receipts: [] };
  }
  return cache;
}

function save() {
  if (!cache) return;
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch { /* best effort */ }
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
    endedAt: null,
    action: timerState.action || 'shutdown',
    profileId: timerState.profileId || null,
    profileName: timerState.profileName || null,
    nightModeId: timerState.nightModeId || null,
    nightModeTitle: timerState.nightModeTitle || null,
    nightModeVersion: timerState.nightModeVersion || null,
    durationSeconds: timerState.totalSeconds || 0,
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
  return receipt;
}

// Update a receipt by id.
function updateRunReceipt(id, updates) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  Object.assign(receipt, updates);
  save();
  return receipt;
}

// Mark a receipt as paused (increment pauseCount).
function receiptPaused(id) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  receipt.pauseCount = (receipt.pauseCount || 0) + 1;
  save();
  return receipt;
}

// Mark a receipt as snoozed (increment snoozeCount).
function receiptSnoozed(id) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  receipt.snoozeCount = (receipt.snoozeCount || 0) + 1;
  save();
  return receipt;
}

// Mark a warning shown (increment warningsShown).
function receiptWarning(id) {
  const data = load();
  const receipt = data.receipts.find(r => r.id === id);
  if (!receipt) return null;
  receipt.warningsShown = (receipt.warningsShown || 0) + 1;
  save();
  return receipt;
}

// Look up a single receipt by id (used to decide whether a persisted
// recovery snapshot still points at a live 'running' receipt).
function getReceiptById(id) {
  if (!id) return null;
  const data = load();
  return data.receipts.find(r => r.id === id) || null;
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
    if (receipt.result !== 'running') continue;
    if (protectedReceiptId && receipt.id === protectedReceiptId) continue;
    receipt.result = 'interrupted';
    receipt.endedAt = timestamp;
    receipt.reconciliationReason = 'orphaned-running-receipt';
    receipt.reconciledAt = timestamp;
    reconciledIds.push(receipt.id);
  }
  if (reconciledIds.length) save();
  return reconciledIds;
}

// Get the latest receipt.
function getLatestReceipt() {
  const data = load();
  return data.receipts.length ? data.receipts[data.receipts.length - 1] : null;
}

// List receipts (most recent first).
function listReceipts(limit = 20) {
  const data = load();
  return data.receipts.slice(-limit).reverse();
}

// All receipts, oldest first -- unlike listReceipts() (most-recent-first,
// capped at a display limit), this is the full stored ledger for export.
function getAllReceiptsForExport() {
  const data = load();
  return [...data.receipts];
}

// Clear all receipts.
function clearReceipts() {
  cache = { receipts: [] };
  save();
  return { cleared: true };
}

// Prune to MAX_RECEIPTS, keeping the most recent.
function prune(data) {
  if (data.receipts.length > MAX_RECEIPTS) {
    data.receipts = data.receipts.slice(-MAX_RECEIPTS);
  }
}

// Get summary stats across all receipts.
function getReceiptStats() {
  const data = load();
  const total = data.receipts.length;
  const completed = data.receipts.filter(r => r.result === 'power_executed' || r.result === 'completed').length;
  const cancelled = data.receipts.filter(r => r.result === 'cancelled').length;
  const dryRun = data.receipts.filter(r => r.result === 'dry_run_completed').length;
  const blocked = data.receipts.filter(r => r.result === 'blocked' || r.result === 'error').length;
  return { total, completed, cancelled, dryRun, blocked };
}

function reset() {
  cache = null;
}

module.exports = {
  createRunReceipt,
  updateRunReceipt,
  receiptPaused,
  receiptSnoozed,
  receiptWarning,
  getReceiptById,
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
