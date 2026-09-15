// Adjudication proof: DEF-006 — settings persistence corruption consequences
// Isolated test using the same parse/merge logic as settings.js
// Does NOT modify production source.

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const tmp = path.join(os.tmpdir(), 'lightsout-adjudication-def006-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
const sf = path.join(tmp, 'settings.json');

// Mirror DEFAULTS shape from settings.js
const DEFAULTS = {
  app: { action: 'shutdown', durationSeconds: 1680, dryRun: false, bedtime: '22:30' },
  wifiGuard: { enabled: false, routerIp: '', routerPass: '' },
  remoteControl: { enabled: false, mode: 'off', port: 58732, token: '' }
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }

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

// Simulate the settings load/save cycle from settings.js
function save(data) { fs.writeFileSync(sf, JSON.stringify(data, null, 2), 'utf8'); }
function load() {
  try {
    const raw = fs.readFileSync(sf, 'utf8');
    if (!raw || !raw.trim()) return clone(DEFAULTS);
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return clone(DEFAULTS);
  }
}

console.log('--- DEF-006 ADJUDICATION PROOF ---\n');

// 1. Normal save/load round-trip
console.log('TEST 1: Normal save/load');
const custom = clone(DEFAULTS);
custom.app.action = 'hibernate';
custom.app.bedtime = '23:00';
save(custom);
const loaded1 = load();
assert.strictEqual(loaded1.app.action, 'hibernate');
assert.strictEqual(loaded1.app.bedtime, '23:00');
console.log('  PASS: Normal round-trip works\n');

// 2. Zero-byte file (power loss during write)
console.log('TEST 2: Zero-byte file (simulates BSOD mid-write)');
fs.writeFileSync(sf, '', 'utf8');
const loaded2 = load();
assert.strictEqual(loaded2.app.action, 'shutdown', 'Fell back to default action');
assert.strictEqual(loaded2.app.bedtime, '22:30', 'Fell back to default bedtime');
console.log('  RESULT: Silent fallback to DEFAULTS — user loses ALL customizations');
console.log('  IMPACT: P2 — complete settings loss with no warning or recovery\n');

// 3. Truncated JSON (partial write)
console.log('TEST 3: Truncated JSON (simulates partial write)');
const fullJson = JSON.stringify(custom, null, 2);
fs.writeFileSync(sf, fullJson.substring(0, Math.floor(fullJson.length / 2)), 'utf8');
const loaded3 = load();
assert.strictEqual(loaded3.app.action, 'shutdown', 'Fell back to default');
console.log('  RESULT: Silent fallback to DEFAULTS — same as zero-byte');
console.log('  IMPACT: No way to distinguish corruption from first-run\n');

// 4. Malformed JSON
console.log('TEST 4: Malformed JSON');
fs.writeFileSync(sf, '{"app": {"action": "hibernate"', 'utf8');
const loaded4 = load();
assert.strictEqual(loaded4.app.action, 'shutdown', 'Fell back to default');
console.log('  RESULT: Silent fallback to DEFAULTS');
console.log('  IMPACT: Same — no backup, no recovery, no user notification\n');

// 5. What SHOULD happen (not currently implemented)
console.log('WHAT\'S MISSING:');
console.log('  1. No write-to-temp + rename (atomic write pattern)');
console.log('  2. No backup file (.bak) to recover from');
console.log('  3. No verification after write (re-read + JSON.parse)');
console.log('  4. No distinction between "first run" and "corruption"');
console.log('  5. No user notification when falling back to defaults\n');

// Cleanup
fs.rmSync(tmp, { recursive: true, force: true });

console.log('--- CONCLUSION ---');
console.log('Any interruption during writeFileSync produces a corrupt file.');
console.log('The load path silently falls back to DEFAULTS with no recovery.');
console.log('SEVERITY: P2 (complete settings loss on power failure / BSOD)');
console.log('FIX: write-tmp-verify-rename with .bak fallback on load.');
