'use strict';

const fs = require('fs');

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* fallback bounded spin */ }
  }
}

function writeAndFsyncSync(tmpFile, json) {
  const fd = fs.openSync(tmpFile, 'w');
  try {
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function renameWithRetrySync(tmpFile, file, maxAttempts = 6) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.renameSync(tmpFile, file);
      return;
    } catch (err) {
      lastErr = err;
      if (!err || !RETRYABLE_RENAME_CODES.has(err.code) || attempt === maxAttempts - 1) {
        throw err;
      }
      sleepSync(15 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * Atomically writes data to a JSON file using write-tmp-fsync-verify-rename with .bak backup.
 * @param {string} file - Target file path
 * @param {object|string} data - Object to stringify or string to write
 * @returns {boolean} Success status
 */
function writeTmpVerifyRename(file, data) {
  const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  const bakFile = file + '.bak';
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  try {
    // 1. Write to unique temp file and flush to storage.
    writeAndFsyncSync(tmpFile, json);

    // 2. Verify temp file is valid JSON.
    const verification = fs.readFileSync(tmpFile, 'utf8');
    JSON.parse(verification);

    // 3. Backup current primary file only if it exists, is non-empty, and parses cleanly.
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        const existingRaw = fs.readFileSync(file, 'utf8');
        if (existingRaw && existingRaw.trim()) {
          JSON.parse(existingRaw);
          fs.copyFileSync(file, bakFile);
        }
      }
    } catch (bakErr) {
      console.warn(`durableJsonStore: failed to create backup for ${file}:`, bakErr.message);
    }

    // 4. Atomically rename temp file over primary (retrying transient Windows AV locks).
    renameWithRetrySync(tmpFile, file);
    return true;
  } catch (error) {
    console.error(`durableJsonStore: failed to write ${file}:`, error.message);
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
    return false;
  }
}

/**
 * Safely loads JSON from primary file with automatic backup recovery if primary is corrupt/missing.
 * @param {string} file - Target file path
 * @param {function} [validator] - Optional function(parsed) returning boolean
 * @returns {{ data: any, recovered: boolean }} Result object with parsed data or null
 */
function safeLoadJson(file, validator = null) {
  const tmpFile = file + '.tmp';
  const bakFile = file + '.bak';

  // Clean stale temp file if left behind by an interrupted process.
  try {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  } catch {}

  // Helper to test if raw text is valid JSON and satisfies validator
  function tryParse(raw) {
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (validator && !validator(parsed)) return null;
    return parsed;
  }

  // 1. Try primary file.
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = tryParse(raw);
      if (parsed !== null) {
        return { data: parsed, recovered: false };
      }
    }
  } catch (err) {
    console.warn(`durableJsonStore: primary file ${file} corrupt or unreadable:`, err.message);
  }

  // 2. Try backup file.
  try {
    if (fs.existsSync(bakFile)) {
      const raw = fs.readFileSync(bakFile, 'utf8');
      const parsed = tryParse(raw);
      if (parsed !== null) {
        console.warn(`durableJsonStore: primary file ${file} corrupt/missing; successfully recovered from backup.`);
        return { data: parsed, recovered: true };
      }
    }
  } catch (err) {
    console.warn(`durableJsonStore: backup file ${bakFile} corrupt or unreadable:`, err.message);
  }

  return { data: null, recovered: false };
}

module.exports = {
  writeTmpVerifyRename,
  safeLoadJson
};
