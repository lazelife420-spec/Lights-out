'use strict';

// v11.3.0 premium polish (design pass F01-F12): the light theme never shows
// a night surface, accent-coloured text stays legible on Dawn for every accent
// the app accepts, the Tonight instrument keeps its face, its paused cut and a
// static run halo, a run gives the ring the wider column, and Settings uses the
// app's own card, disclosure and scrollbar systems.
//
// Reads styles.css / index.html as text (comments stripped, @media aware) and
// runs the real sanitizeAccent() from renderer-settings.js in a vm sandbox.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(root, 'renderer-settings.js'), 'utf8');

// Every style rule with the @media condition(s) it sits in ('' at top level).
function parseRules(src, media = '') {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (/^@media\b/.test(head)) out.push(...parseRules(body, media ? `${media} and ${head.slice(6).trim()}` : head.slice(6).trim()));
    else if (!/^@/.test(head)) out.push({ selector: head.replace(/\s+/g, ' '), body, media });
    i = j;
  }
  return out;
}
const rules = parseRules(css);
const topRules = rules.filter(r => r.media === '');
const findTop = sel => topRules.filter(r => r.selector === sel);
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop.replace(/[-[\]]/g, '\\$&')}\\s*:\\s*([^;]+)`, 'i').exec(body);
  return m ? m[1].trim() : null;
};
// The last top-level declaration of prop for an exact selector (source order).
function lastDecl(sel, prop) {
  let value = null;
  for (const r of findTop(sel)) { const v = decl(r.body, prop); if (v !== null) value = v; }
  return value;
}
function tokens(selector) {
  const out = {};
  for (const r of topRules) {
    if (r.selector !== selector) continue;
    for (const m of r.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/gi)) out[m[1]] = m[2].trim();
  }
  return out;
}
const night = tokens(':root');
const dawn = { ...night, ...tokens('body[data-theme="dawn"]') };
function resolve(map, name, seen = new Set()) {
  const v = map[name];
  assert.ok(v, `${name} is not defined`);
  const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
  if (ref) { assert.ok(!seen.has(name), `${name} is circular`); seen.add(name); return resolve(map, ref[1], seen); }
  assert.match(v, /^#[0-9a-f]{6}$/i, `${name} must resolve to #rrggbb (got ${v})`);
  return v.toLowerCase();
}
const rgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
const hex = arr => '#' + arr.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function luminance(h) {
  const c = rgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// color-mix(in srgb, A p%, B): per gamma-encoded channel.
const mix = (a, p, b) => hex(rgb(a).map((v, k) => v * p + rgb(b)[k] * (1 - p)));
const over = (color, alpha, base) => mix(color, alpha, base);

function extractFunction(source, name) {
  const m = source.match(new RegExp(`function ${name}\\s*\\(`));
  if (!m) throw new Error(`function ${name} not found`);
  let i = m.index + m[0].length;
  let parens = 1;
  while (parens > 0) { if (source[i] === '(') parens++; else if (source[i] === ')') parens--; i++; }
  while (source[i] !== '{') i++;
  i++;
  let braces = 1;
  while (braces > 0) { if (source[i] === '{') braces++; else if (source[i] === '}') braces--; i++; }
  return source.slice(m.index, i);
}
const extractConst = (source, name) => source.match(new RegExp(`const ${name} = [^\\n]*;`))[0];
function loadSanitizer() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext([
    extractConst(settingsSrc, 'LEGACY_DEFAULT_ACCENT'),
    extractConst(settingsSrc, 'ACCENT_BUTTON_INK'),
    extractConst(settingsSrc, 'CUSTOMIZE_DEFAULTS'),
    extractFunction(settingsSrc, 'normalizeHexColor'),
    extractFunction(settingsSrc, 'hexToHsl'),
    extractFunction(settingsSrc, 'hexContrast'),
    extractFunction(settingsSrc, 'sanitizeAccent'),
    'globalThis.api = { sanitizeAccent };'
  ].join('\n'), sandbox);
  return sandbox.api.sanitizeAccent;
}

// ---- F02: the accent as text ------------------------------------------------

test('F02: --accent-text is the accent at night and a Dawn mix that follows the accent', () => {
  assert.equal(night['--accent-text'], 'var(--accent-cyan)');
  assert.match(dawn['--accent-text'] || '', /^color-mix\(in srgb, var\(--accent-cyan\) \d+(\.\d+)?%, #[0-9a-f]{6}\)$/i,
    'Dawn mixes the live accent (not a fixed hex), so a custom accent keeps its hue');
});

test('F02: Dawn accent text reaches 4.5:1 on card, field and footer for every accent sanitizeAccent accepts', () => {
  const sanitizeAccent = loadSanitizer();
  const [, pct, ink] = /color-mix\(in srgb, var\(--accent-cyan\) (\d+(?:\.\d+)?)%, (#[0-9a-f]{6})\)/i.exec(dawn['--accent-text']);
  const p = Number(pct) / 100;
  const surfaces = ['--bg-card', '--bg-primary', '--bg-secondary'].map(name => [name, resolve(dawn, name)]);
  const swatches = [...html.matchAll(/class="swatch"[^>]*data-color="(#[0-9a-f]{6})"/gi)].map(m => m[1].toLowerCase());
  assert.ok(swatches.length >= 5, 'the Settings swatches are offered (fixture check)');
  const accepted = [];
  for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
    const c = hex([r, g, b]);
    if (sanitizeAccent(c) === c) accepted.push(c);
  }
  assert.ok(accepted.length > 300, `the accent grid exercises the accepted range (got ${accepted.length})`);
  for (const accent of [...new Set([...swatches, ...accepted, '#b4e6fa', '#9b93d6'])]) {
    const text = mix(accent, p, ink);
    for (const [name, bg] of surfaces) {
      const ratio = contrast(text, bg);
      assert.ok(ratio >= 4.5, `accent ${accent}: Dawn accent text ${text} on ${name} is ${ratio.toFixed(2)}:1 (< 4.5)`);
    }
  }
  // The default violet stays clearly violet, not black: well inside AA, below 10:1.
  const def = contrast(mix('#9b93d6', p, ink), resolve(dawn, '--bg-card'));
  assert.ok(def >= 4.5 && def < 10, `default violet text on the Dawn card is ${def.toFixed(2)}:1`);
});

test('F02: the small accent-coloured text uses --accent-text (links, disclosures, today, eyebrow, names)', () => {
  for (const sel of ['.device-link', '.routine-details > summary', '.night-cell.is-tonight .night-dow',
    '.planner-day[aria-current="date"] .planner-day-number', '.session-eyebrow', '.tdr-ends', '.timer-name']) {
    assert.equal(lastDecl(sel, 'color'), 'var(--accent-text)', `${sel} colours its text with --accent-text`);
  }
  // Fills, rings and the Devices off-card CTA keep their own checked tokens.
  assert.equal(lastDecl('.device-card:not(#device-card-pc)[data-state="off"] .device-link', 'color'), 'var(--chip-ink-act)');
});

// ---- F01: no night surface leaks into Dawn ----------------------------------

test('F01: .status-card is opaque theme surfaces only, with no backdrop blur and no transition: all', () => {
  const cards = findTop('.status-card');
  assert.ok(cards.length >= 1);
  for (const r of cards) {
    assert.ok(!/backdrop-filter/.test(r.body), '.status-card never blurs its backdrop');
    assert.ok(!/transition:\s*all/.test(r.body), '.status-card transitions named properties only');
  }
  const bg = lastDecl('.status-card', 'background');
  assert.match(bg, /var\(--bg-card\)$/, 'an opaque theme base under the gradient');
  assert.ok(!/rgba\(\s*21\s*,\s*25\s*,\s*28/.test(bg) && !/#[0-9a-f]{6}/i.test(bg), `the gradient uses theme tokens only (got ${bg})`);
});

test('F01: Dawn gets a warm dialog scrim and a one-colour dark frame', () => {
  const scrim = lastDecl('body[data-theme="dawn"] .modal', 'background');
  assert.ok(scrim, 'Dawn has its own .modal backdrop');
  assert.ok(!/8,\s*12,\s*17|3,\s*5,\s*8/.test(scrim), 'not the cool night black');
  for (const m of scrim.matchAll(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)) {
    assert.ok(Number(m[1]) >= Number(m[3]), 'a warm ink (red >= blue)');
    assert.ok(Number(m[4]) <= 0.6, 'lighter than the night scrim');
  }
  assert.equal(lastDecl('body[data-theme="dawn"] .chrome-header', 'background'), lastDecl('body[data-theme="dawn"] .ns-sidebar', 'background'),
    'the Dawn header and rail share one night colour (no seam)');
});

// ---- F03 / F10 / F11 / F12: Settings ---------------------------------------

test('F03: the Clock Face hint is styled help text across the whole row', () => {
  assert.match(html, /<p class="set-hint">The clock appears while idle\. Running timers always show time remaining\.<\/p>/);
  const r = findTop('#ns-panel-set .settings-categories .set-hint')[0];
  assert.ok(r, '.set-hint has a Settings rule');
  assert.equal(decl(r.body, 'grid-column'), '1 / -1');
  assert.match(decl(r.body, 'font'), /12px/);
  assert.equal(decl(r.body, 'color'), 'var(--text-secondary)');
});

test('F10: Settings section cards are raised to --bg-card with a hairline', () => {
  const sel = '#ns-panel-set .settings-categories > .option-section';
  assert.equal(lastDecl(sel, 'background'), 'var(--bg-card)');
  assert.match(lastDecl(sel, 'border'), /var\(--border-color\)/);
  assert.equal(lastDecl('#ns-panel-set .settings-categories', 'background'), 'var(--bg-secondary)', 'the panel stays one step down');
});

test('F11: collapsible setting groups use the app disclosure (no inline style, no browser marker, focus ring)', () => {
  const groups = [...html.matchAll(/<details class="advanced-settings-group"><summary([^>]*)>/g)];
  assert.equal(groups.length, 6, 'six collapsible groups');
  assert.ok(groups.every(m => m[1] === ''), 'the summaries carry no inline style');
  const s = '#ns-panel-set .advanced-settings-group > summary';
  assert.equal(lastDecl(s, 'list-style'), 'none');
  assert.equal(lastDecl(`${s}::-webkit-details-marker`, 'display'), 'none');
  assert.match(lastDecl(`${s}::after`, 'transform'), /rotate\(-45deg\)/);
  assert.match(lastDecl('#ns-panel-set .advanced-settings-group[open] > summary::after', 'transform'), /rotate\(45deg\)/);
  assert.match(lastDecl(`${s}:focus-visible`, 'outline'), /2px solid var\(--accent-cyan\)/);
  assert.ok(lastDecl(`${s}:hover`, 'background'), 'a hover wash');
});

test('F12: no scroller opts out of the slim ::-webkit-scrollbar (scrollbar-width / -color bring back arrow buttons)', () => {
  assert.ok(!/scrollbar-(width|color)\s*:/.test(css), 'styles.css sets no scrollbar-width or scrollbar-color');
  assert.equal(lastDecl('#ns-panel-set .settings-categories::-webkit-scrollbar', 'width'), '6px');
  assert.ok(lastDecl('#ns-panel-set .settings-categories::-webkit-scrollbar-thumb', 'background'));
});

// ---- F04 / F06 / F07: the Tonight instrument -------------------------------

test('F04: the glass face stays on (outside mini / fullscreen) and the track is a visible accent', () => {
  for (const r of rules) {
    if (!/display:\s*none/.test(r.body)) continue;
    const hidesFace = r.selector.split(',').map(s => s.trim()).some(s => /^(\.timer-section )?\.ring-container::before$/.test(s));
    assert.ok(!hidesFace, `no rule hides the dial's glass face (${r.selector})`);
  }
  const face = lastDecl('.ring-container::before', 'background');
  assert.match(face, /var\(--bg-primary\)$/, 'the face ends on an opaque field base');
  assert.ok(!/rgba\(\s*38\s*,\s*46\s*,\s*62/.test(face), 'the face is built from theme surfaces, not a fixed blue-grey');
  assert.match(lastDecl('.timer-section .ring-bg', 'stroke'), /^rgba\(var\(--accent-rgb\), 0\.1[2-9]\)$/);
  assert.ok(lastDecl('body[data-theme="dawn"] .timer-section .ring-bg', 'stroke'), 'Dawn draws the track in its own ink');
});

test('F04: a run gets one static halo at the ring, in the phase colour, never in mini / fullscreen', () => {
  const sel = 'body:not(.mini-mode):not(.fullscreen-clock-mode) .ring-container::after';
  assert.equal(lastDecl(sel, 'inset'), '5%', 'the halo circle sits on the arc (r 90 of 100)');
  assert.equal(lastDecl(sel, 'z-index'), '-1', 'under the SVG and the face');
  assert.match(lastDecl(sel, 'box-shadow'), /var\(--run-halo\)/, 'a shadow: ink overflow only, never scrollable overflow');
  assert.equal(lastDecl(sel, 'opacity'), '0', 'idle: no halo');
  assert.equal(lastDecl('body:is(.is-running, .is-paused):not(.mini-mode):not(.fullscreen-clock-mode) .ring-container::after', 'opacity'), '1');
  assert.ok(!/animation/.test(findTop(sel).map(r => r.body).join(';')), 'the halo never animates');
  assert.match(lastDecl('body.is-paused .ring-container', '--run-halo'), /--amber-rgb/);
  assert.match(lastDecl('body.phase-lastlight .ring-container', '--run-halo'), /--red-rgb/);
  assert.match(lastDecl('body.phase-lastlight.test-mode .ring-container', '--run-halo'), /--amber-rgb/);
  assert.ok(!/amber/.test(lastDecl('body.phase-dim:not(.is-paused) .ring-container', '--run-halo')), 'winding down is never amber');
});

test('F06: paused keeps the broken-O cut; nothing cancels it', () => {
  assert.equal(lastDecl('body.is-paused .ring-progress', 'mask'), 'url(#ring-cut-mask)');
  for (const r of rules) {
    if (/\.ring-progress\b/.test(r.selector)) assert.ok(!/(^|;)\s*mask\s*:\s*none/.test(r.body), `no rule removes the paused cut (${r.selector})`);
  }
  assert.equal(lastDecl('body.is-paused .timer-section .ring-bg', 'mask'), 'url(#ring-cut-mask)', 'the track takes the same cut, so the gaps are real');
  assert.ok(html.includes('<mask id="ring-cut-mask"'), 'the mask exists');
});

test('F07: the default session name is legible (>= 4.5:1 on the face) and reads as editable', () => {
  const sel = '.timer-name.is-default:not(:focus):not(:hover):not(:focus-visible)';
  assert.equal(lastDecl(sel, 'color'), 'var(--text-secondary)');
  assert.equal(lastDecl(sel, 'opacity'), '1');
  assert.match(lastDecl(sel, 'text-decoration'), /underline dotted/);
  for (const [label, map] of [['midnight', night], ['dawn', dawn]]) {
    for (const bg of ['--bg-card', '--bg-primary']) {
      const ratio = contrast(resolve(map, '--text-secondary'), resolve(map, bg));
      assert.ok(ratio >= 4.5, `${label}: the default name on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
  assert.equal(lastDecl('.timer-display.clock-idle .timer-readout-label', 'margin'), '2px 0 8px');
});

// ---- F05: a run gives the ring the wider column ----------------------------

test('F05: running / paused swap the columns and grow the ring on wide, tall windows only', () => {
  const cols = rules.find(r => r.selector === 'body:not(.mini-mode):not(.fullscreen-clock-mode):is(.is-running, .is-paused) #ns-panel-lib' && /grid-template-columns/.test(r.body));
  assert.ok(cols, 'a running column rule exists');
  assert.equal(cols.media, '(min-width: 761px)', 'the 760px single column keeps its own grid');
  assert.match(decl(cols.body, 'grid-template-columns'), /^minmax\(0, 1\.\d+fr\) minmax\(320px, 0\.\d+fr\)$/);
  const ring = rules.find(r => r.selector === 'body:not(.mini-mode):not(.fullscreen-clock-mode):is(.is-running, .is-paused) .ring-container' && /clamp\(280px/.test(r.body));
  assert.ok(ring && ring.media === '(min-width: 761px) and (min-height: 701px)', 'the larger running ring skips short windows (their own 310px cap holds)');
  assert.equal(lastDecl('#action-bar-running', 'max-width'), '380px');
  assert.match(lastDecl('body:not(.mini-mode):not(.fullscreen-clock-mode) #ns-panel-lib', 'transition'), /grid-template-columns/);
  assert.equal(lastDecl('#action-bar-running #btn-pause:active', 'transform'), 'scale(0.985)', 'Pause / Resume answers a press');
});

// ---- F09: the month planner ---------------------------------------------

test('F09: planner rule chips are readable labels and today stands out', () => {
  const chip = findTop('.planner-rule').pop();
  assert.equal(decl(chip.body, 'font-size'), 'var(--fs-micro)');
  assert.notEqual(decl(chip.body, 'color'), 'var(--text-secondary)');
  assert.equal(lastDecl('body[data-theme="dawn"] .planner-rule', 'color'), 'var(--accent-text)');
  // Night chip ink: the accent mixed into the text ink, on the chip wash over the field.
  const [, pct] = /color-mix\(in srgb, var\(--accent-cyan\) (\d+)%, var\(--text-primary\)\)/.exec(decl(chip.body, 'color'));
  const ink = mix(resolve(night, '--accent-cyan'), Number(pct) / 100, resolve(night, '--text-primary'));
  const wash = over(resolve(night, '--accent-cyan'), 0.18, resolve(night, '--bg-primary'));
  assert.ok(contrast(ink, wash) >= 4.5, `night chip ${contrast(ink, wash).toFixed(2)}:1`);
  const today = findTop('.planner-day[aria-current="date"]').pop();
  assert.equal(decl(today.body, 'border-color'), 'var(--accent-cyan)');
  assert.ok(decl(today.body, 'background') && decl(today.body, 'box-shadow'), 'today gets a wash and a ring');
  assert.ok(!/animation|transition/.test(today.body), 'today is static');
  assert.equal(lastDecl('.planner-day.outside-month .planner-rule', 'background'), 'transparent');
});
