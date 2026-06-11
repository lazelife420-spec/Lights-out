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
  getLatestReceipt,
  listReceipts,
  clearReceipts,
  getReceiptStats,
  _load: load,
  _reset: reset,
  MAX_RECEIPTS,
  RECEIPT_VERSION
};
