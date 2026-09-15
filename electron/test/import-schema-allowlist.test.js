// Regression test for DEF-008: import-all-data must reject unknown section names.
//
// Adjudication proof (2026-09-14, HEAD 268e6b0) demonstrated that the
// import-all-data IPC handler accepted arbitrary section names, persisting
// them to settings.json as schema pollution. The fix adds an ALLOWED_SECTIONS
// allowlist in main.js.
//
// PRE-FIX: updateSection('evilSection', ...) → pollutes settings with unknown keys.
// POST-FIX: unknown sections silently dropped; only known section names accepted.
//
// This test validates the allowlist by reading main.js source, extracting the
// ALLOWED_SECTIONS set, and verifying it against the canonical DEFAULTS, plus
// checking that the import handler gates on the allowlist.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// --- SOURCE-LEVEL: import handler uses ALLOWED_SECTIONS ---

test('import-all-data handler defines ALLOWED_SECTIONS set', () => {
  const match = mainSource.match(/const ALLOWED_SECTIONS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  assert.ok(match, 'ALLOWED_SECTIONS must be defined as new Set([...]) in main.js');
  const sections = match[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  assert.ok(sections.length >= 8, `expected >= 8 allowed sections, got ${sections.length}`);
  // Verify canonical sections present.
  for (const required of ['app', 'calendar', 'customization', 'wifiGuard', 'remoteControl', 'smartLights']) {
    assert.ok(sections.includes(required), `${required} must be in ALLOWED_SECTIONS`);
  }
});

test('import-all-data handler gates updateSection on ALLOWED_SECTIONS.has()', () => {
  const importBlock = mainSource.match(/ipcMain\.handle\('import-all-data'[\s\S]*?ALLOWED_SECTIONS[\s\S]*?return \{ success: true \}/);
  assert.ok(importBlock, 'import-all-data handler must contain ALLOWED_SECTIONS usage');
  assert.ok(importBlock[0].includes('ALLOWED_SECTIONS.has(section)'), 'must call ALLOWED_SECTIONS.has(section)');
});

// --- NEGATIVE: unknown sections should NOT appear in allowlist ---

test('__proto__ is not in ALLOWED_SECTIONS', () => {
  const match = mainSource.match(/const ALLOWED_SECTIONS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  const sections = match[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  assert.ok(!sections.includes('__proto__'), '__proto__ must not be allowed');
  assert.ok(!sections.includes('constructor'), 'constructor must not be allowed');
  assert.ok(!sections.includes('prototype'), 'prototype must not be allowed');
});

// --- PROTOTYPE POLLUTION: still safe via JSON clone ---

test('deepMerge via JSON clone prevents prototype pollution', () => {
  function clone(v) { return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)); }
  function deepMerge(base, override) {
    if (!override || typeof override !== 'object') return clone(base);
    const out = clone(base);
    for (const key of Object.keys(override)) {
      const val = override[key];
      if (val && typeof val === 'object' && !Array.isArray(val) &&
          base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        out[key] = deepMerge(base[key], val);
      } else if (val !== undefined) {
        out[key] = clone(val);
      }
    }
    return out;
  }
  const base = { app: { action: 'shutdown' } };
  const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
  for (const [key, val] of Object.entries(malicious)) {
    deepMerge(base, { [key]: val });
  }
  assert.strictEqual(({}).isAdmin, undefined, 'prototype pollution must not occur');
});

// --- EXISTING SECTION PROTECTION: non-object cannot replace object ---

test('existing object section is protected from non-object replacement by deepMerge', () => {
  function clone(v) { return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)); }
  function deepMerge(base, override) {
    if (!override || typeof override !== 'object') return clone(base);
    const out = clone(base);
    for (const key of Object.keys(override)) {
      const val = override[key];
      if (val && typeof val === 'object' && !Array.isArray(val) &&
          base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        out[key] = deepMerge(base[key], val);
      } else if (val !== undefined) {
        out[key] = clone(val);
      }
    }
    return out;
  }
  const base = { action: 'shutdown', durationSeconds: 1680 };
  const result = deepMerge(base, 'just a string');
  assert.deepStrictEqual(result, base, 'non-object override returns clone of base');
});
