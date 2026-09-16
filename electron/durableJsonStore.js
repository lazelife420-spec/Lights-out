'use strict';

const fs = require('fs');

/**
 * Atomically writes data to a JSON file using write-tmp-verify-rename with .bak backup.
 * @param {string} file - Target file path
 * @param {object|string} data - Object to stringify or string to write
 * @returns {boolean} Success status
 */
function writeTmpVerifyRename(file, data) {
  const tmpFile = file + '.tmp';
  const bakFile = file + '.bak';
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  try {
    // 1. Write to temp file.
    fs.writeFileSync(tmpFile, json, 'utf8');

    // 2. Verify temp file is valid JSON.
    const verification = fs.readFileSync(tmpFile, 'utf8');
    JSON.parse(verification);

    // 3. Backup current primary file if it exists and is non-empty.
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        fs.copyFileSync(file, bakFile);
      }
    } catch (bakErr) {
      console.warn(`durableJsonStore: failed to create backup for ${file}:`, bakErr.message);
    }

    // 4. Atomically rename temp file over primary.
    fs.renameSync(tmpFile, file);
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
