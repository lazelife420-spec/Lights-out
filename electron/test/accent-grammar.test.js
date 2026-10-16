'use strict';

// UI-R3 P04: Appearance choices can never break the colour grammar.
//
// Violet = you act, teal = live, amber = Test Mode / attention, red = REAL or
// destructive. A custom accent that borrows amber, red/rose or teal/green (or
// is too dark, too light or too grey) renders as the product violet, and the
// retired ring styles (Sunset, Ember, Aurora) render as Glow. Both limits are
// applied at render time; the saved value is never rewritten.
//
// The real renderer-settings.js functions run in a vm sandbox (the renderer
// has no Node, so nothing here touches a DOM or IPC).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const settingsSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

function extractConst(source, name) {
  const m = source.match(new RegExp(`const ${name} = [^\\n]*;`));
  if (!m) throw new Error(`const ${name} not found`);
  return m[0];
}

function loadGuards() {
  const code = [
    extractConst(settingsSrc, 'RING_STYLES'),
    extractConst(settingsSrc, 'LEGACY_DEFAULT_ACCENT'),
    extractConst(settingsSrc, 'ACCENT_BUTTON_INK'),
    extractConst(settingsSrc, 'CUSTOMIZE_DEFAULTS'),
    extractFunction(settingsSrc, 'normalizeHexColor'),
    extractFunction(settingsSrc, 'hexToHsl'),
    extractFunction(settingsSrc, 'hexContrast'),
    extractFunction(settingsSrc, 'sanitizeAccent'),
    extractFunction(settingsSrc, 'accentIsReserved'),
    extractFunction(settingsSrc, 'sanitizeRingStyle'),
    extractFunction(settingsSrc, 'effectiveClockHandColor'),
    'globalThis.api = { sanitizeAccent, accentIsReserved, hexContrast, sanitizeRingStyle, effectiveClockHandColor, CUSTOMIZE_DEFAULTS, ACCENT_BUTTON_INK };'
  ].join('\n');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.api;
}

const guards = loadGuards();

test('the default accent is the Lights Out violet', () => {
  assert.equal(guards.CUSTOMIZE_DEFAULTS.accent, '#9b93d6');
});

test('reserved accents (amber, rose/red, teal/cyan, green, black, white) fall back to violet', () => {
  for (const hex of ['#f59e0b', '#fb7185', '#22d3ee', '#00d1b2', '#84cc16', '#000000', '#ffffff', '#34d399', '#ff5c7a', '#f5b83d', '#808080']) {
    assert.equal(guards.sanitizeAccent(hex), '#9b93d6', `${hex} must be reserved`);
  }
});

test('night-safe violets and blues pass through unchanged', () => {
  for (const hex of ['#9b93d6', '#a855f7', '#8a9cf7', '#b08cf0', '#6f8fd8', '#c79ad8']) {
    assert.equal(guards.sanitizeAccent(hex), hex, `${hex} must be allowed`);
  }
  assert.equal(guards.sanitizeAccent('#A855F7'), '#a855f7', 'case is normalized');
});

test('the retired v11.1.3 default blue (#5b8cff), saved by every upgraded install, renders violet', () => {
  assert.equal(guards.sanitizeAccent('#5b8cff'), '#9b93d6');
  assert.equal(guards.sanitizeAccent('#5B8CFF'), '#9b93d6');
  // Drawn violet quietly: the user never picked it, so no reserved-colour note.
  assert.equal(guards.accentIsReserved('#5b8cff'), false);
  assert.equal(guards.accentIsReserved(undefined), false);
});

test('the reserved-colour note follows real rejections only', () => {
  assert.equal(guards.accentIsReserved('#f59e0b'), true);
  assert.equal(guards.accentIsReserved('#6a00ff'), true);
  assert.equal(guards.accentIsReserved('#9b93d6'), false);
  assert.equal(guards.accentIsReserved('#a855f7'), false);
});

test('accents too dark for the dark button ink (#14101f) fall back to violet', () => {
  for (const hex of ['#6a00ff', '#8a2be2', '#7a3cf0', '#2e5cff']) {
    assert.ok(guards.hexContrast(hex, guards.ACCENT_BUTTON_INK) < 4.5, `${hex} is a real low-contrast case`);
    assert.equal(guards.sanitizeAccent(hex), '#9b93d6', `${hex} must be reserved`);
  }
  for (const hex of ['#9b93d6', '#a855f7', '#8a9cf7', '#b08cf0', '#6f8fd8', '#c79ad8']) {
    assert.ok(guards.hexContrast(hex, guards.ACCENT_BUTTON_INK) >= 4.5, `${hex} keeps the button label >= 4.5:1`);
  }
});

test('malformed or missing accents fall back to violet', () => {
  for (const v of [undefined, null, '', 'violet', '#12', '#zzzzzz', 42, 'rgba(1,2,3,1)']) {
    assert.equal(guards.sanitizeAccent(v), '#9b93d6');
  }
});

test('every Accent swatch offered in Settings is night-safe', () => {
  const colors = [...htmlSrc.matchAll(/class="swatch"[^>]*data-color="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]);
  assert.ok(colors.length >= 5, 'swatches present');
  for (const c of colors) assert.equal(guards.sanitizeAccent(c), c.toLowerCase(), `swatch ${c} is reserved`);
});

test('retired ring styles map to Glow; supported styles pass', () => {
  for (const v of ['ember', 'sunset', 'aurora', 'bogus', undefined, '', 'GLOW']) {
    assert.equal(guards.sanitizeRingStyle(v), 'glow', `${String(v)} must map to glow`);
  }
  for (const v of ['glow', 'neon', 'midnight', 'solid', 'minimal']) {
    assert.equal(guards.sanitizeRingStyle(v), v);
  }
});

test('the Ring Style select offers only supported styles', () => {
  const select = htmlSrc.match(/<select id="cz-ring">[\s\S]*?<\/select>/)[0];
  const values = [...select.matchAll(/value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(values.sort(), ['glow', 'midnight', 'minimal', 'neon', 'solid']);
});

test('clock hand: the old light-blue default renders violet; custom colours are untouched', () => {
  assert.equal(guards.effectiveClockHandColor('#76c9ff'), '#9b93d6');
  assert.equal(guards.effectiveClockHandColor('#76C9FF'), '#9b93d6');
  assert.equal(guards.effectiveClockHandColor(undefined), '#9b93d6');
  assert.equal(guards.effectiveClockHandColor('#ff8800'), '#ff8800');
  assert.equal(guards.effectiveClockHandColor('#9b93d6'), '#9b93d6');
});

test('applyCustomization sanitizes before any setProperty and never writes the saved value back', () => {
  const body = extractFunction(settingsSrc, 'applyCustomization');
  const sanitizeAt = body.indexOf('sanitizeAccent(c.accent)');
  assert.ok(sanitizeAt > 0, 'applyCustomization must call sanitizeAccent');
  assert.ok(sanitizeAt < body.indexOf('setProperty'), 'sanitize before the first setProperty');
  assert.match(body, /document\.body\.dataset\.ring = sanitizeRingStyle\(c\.ringStyle\)/);
  assert.doesNotMatch(body, /c\.(accent|ringStyle)\s*=[^=]/, 'the saved customization object is never rewritten');
  assert.doesNotMatch(body, /setProperty\('--accent(?:-cyan)?', c\.accent\)/, 'the raw accent never reaches a token');
});
