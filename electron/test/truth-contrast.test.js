'use strict';

// UI-R3 P04: Test Mode / REAL truth text and muted meta text stay legible.
//
// Parses the colour tokens straight from styles.css (every `:root` block and
// every `body[data-theme="..."]` block, later declarations winning, exactly
// like the cascade) and checks WCAG 2.x contrast >= 4.5:1 for the truth inks
// (amber, red, teal) and --text-muted on the card and field colours, for the
// default theme and for Dawn (the one light theme). Ember and Tide recolour
// --text-muted, so those overrides are checked against their own cards.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Top-level rules only (skip @media/@keyframes bodies).
function topLevelRules(src) {
  const rules = [];
  let depth = 0;
  let selStart = 0;
  let bodyStart = -1;
  let selector = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) { selector = src.slice(selStart, i).trim(); bodyStart = i + 1; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        rules.push({ selector, body: src.slice(bodyStart, i) });
        selStart = i + 1;
      }
    }
  }
  return rules;
}

const rules = topLevelRules(css);

function tokens(selectors) {
  const out = {};
  for (const r of rules) {
    if (!selectors.includes(r.selector)) continue;
    for (const m of r.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/gi)) out[m[1]] = m[2].trim();
  }
  return out;
}

function resolve(map, name, seen = new Set()) {
  const v = map[name];
  assert.ok(v, `${name} is not defined`);
  const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
  if (ref) {
    assert.ok(!seen.has(name), `${name} is circular`);
    seen.add(name);
    return resolve(map, ref[1], seen);
  }
  assert.match(v, /^#[0-9a-f]{6}$/i, `${name} must resolve to a #rrggbb colour (got ${v})`);
  return v;
}

function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const theme = name => tokens([':root', `body[data-theme="${name}"]`]);
const TRUTH_INKS = ['--accent-amber', '--accent-red', '--pf-teal', '--text-muted'];

for (const [label, map] of [['default', tokens([':root'])], ['dawn', theme('dawn')]]) {
  test(`${label} theme: truth inks and muted text reach 4.5:1 on cards, field and footer`, () => {
    for (const ink of TRUTH_INKS) {
      for (const bg of ['--bg-card', '--bg-primary', '--bg-secondary']) {
        const ratio = contrast(resolve(map, ink), resolve(map, bg));
        assert.ok(ratio >= 4.5, `${label}: ${ink} on ${bg} is ${ratio.toFixed(2)}:1 (< 4.5)`);
      }
    }
  });
}

for (const name of ['ember', 'tide']) {
  test(`${name} theme: its muted override reaches 4.5:1 on its own card and field`, () => {
    const map = theme(name);
    for (const bg of ['--bg-card', '--bg-primary']) {
      const ratio = contrast(resolve(map, '--text-muted'), resolve(map, bg));
      assert.ok(ratio >= 4.5, `${name}: --text-muted on ${bg} is ${ratio.toFixed(2)}:1 (< 4.5)`);
    }
  });
}

test('dawn darkens the truth inks instead of reusing the night values', () => {
  const dawn = tokens([`body[data-theme="dawn"]`]);
  for (const ink of ['--accent-amber', '--accent-red', '--pf-teal']) assert.ok(dawn[ink], `dawn must override ${ink}`);
});

test('dawn: the dark nav rail and window header keep night inks at 4.5:1 or better', () => {
  // In Dawn the rail and header stay dark, so the darkened Dawn inks would
  // fall to 2-3.5:1 on them. They get opaque night surfaces and night inks.
  const scoped = { ...theme('dawn'), ...tokens(['body[data-theme="dawn"] :is(.ns-sidebar, .chrome-header)']) };
  const surface = sel => {
    const rule = rules.find(r => r.selector === sel);
    assert.ok(rule, `${sel} rule is missing`);
    const m = /(?:^|;)\s*background:\s*(#[0-9a-f]{6})\s*;/i.exec(rule.body);
    assert.ok(m, `${sel} must declare an opaque #rrggbb background`);
    return m[1];
  };
  const surfaces = {
    rail: surface('body[data-theme="dawn"] .ns-sidebar'),
    header: surface('body[data-theme="dawn"] .chrome-header')
  };
  const inks = ['--text-muted', '--text-secondary', '--text-primary', '--accent-amber', '--accent-red', '--pf-teal', '--accent-cyan'];
  for (const [where, bg] of Object.entries(surfaces)) {
    for (const ink of inks) {
      const ratio = contrast(resolve(scoped, ink), bg);
      assert.ok(ratio >= 4.5, `dawn ${where}: ${ink} is ${ratio.toFixed(2)}:1 (< 4.5)`);
    }
  }
  // The active nav item sits on --bg-card with the accent as its ink.
  const active = contrast(resolve(scoped, '--accent-cyan'), resolve(scoped, '--bg-card'));
  assert.ok(active >= 4.5, `dawn rail: active nav item is ${active.toFixed(2)}:1 (< 4.5)`);
});

// ---- P04 fix round 2 --------------------------------------------------------

function ruleBody(sel) {
  const rule = rules.find(r => r.selector === sel);
  assert.ok(rule, `${sel} rule is missing`);
  return rule.body;
}

function decl(body, prop) {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(body);
  return m ? m[1].trim() : null;
}

function rgbOf(map, name) {
  const v = map[name];
  assert.ok(v, `${name} is not defined`);
  const parts = v.split(',').map(s => Number(s.trim()));
  assert.equal(parts.length, 3, `${name} must be r, g, b`);
  return parts;
}

function blend(rgb, alpha, baseHex) {
  const base = [1, 3, 5].map(i => parseInt(baseHex.slice(i, i + 2), 16));
  return '#' + base.map((b, i) => Math.round(rgb[i] * alpha + b * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

const OVERLAY_SCOPE = 'body[data-theme="dawn"] :is(.last-light-overlay, .breathing-overlay)';

test('dawn: the breathing / Last Light overlays keep night surfaces under their night text', () => {
  const scoped = { ...theme('dawn'), ...tokens([OVERLAY_SCOPE]) };
  // .btn-secondary (the breathing Stop control): --text-secondary on
  // --bg-secondary at rest, --text-primary on --bg-hover on hover.
  const pairs = [
    ['--text-secondary', '--bg-secondary'],
    ['--text-primary', '--bg-hover'],
    ['--text-primary', '--bg-secondary'],
    ['--text-secondary', '--bg-card'],
    ['--text-muted', '--bg-card'],
    ['--accent-amber', '--bg-card'],
    ['--accent-red', '--bg-card']
  ];
  for (const [ink, bg] of pairs) {
    const ratio = contrast(resolve(scoped, ink), resolve(scoped, bg));
    assert.ok(ratio >= 4.5, `dawn overlay: ${ink} on ${bg} is ${ratio.toFixed(2)}:1 (< 4.5)`);
  }
  // The Stop control really is a .btn-secondary painted from those tokens.
  assert.equal(decl(ruleBody('.btn-secondary'), 'background'), 'var(--bg-secondary)');
  assert.equal(decl(ruleBody('.btn-secondary'), 'color'), 'var(--text-secondary)');
  assert.equal(decl(ruleBody('.btn-secondary:hover'), 'background'), 'var(--bg-hover)');
  assert.equal(decl(ruleBody('.btn-secondary:hover'), 'color'), 'var(--text-primary)');
});

test('dawn: the Test Mode / REAL pill has an opaque base, so dim / Last Light cannot wash it out', () => {
  const dawn = theme('dawn');
  const card = resolve(dawn, '--bg-card');
  const cases = [
    ['body[data-theme="dawn"] #testmode-pill', '--amber-rgb', '--accent-amber'],
    ['body[data-theme="dawn"] #testmode-pill.real', '--red-rgb', '--accent-red']
  ];
  for (const [sel, channel, ink] of cases) {
    const bg = decl(ruleBody(sel), 'background');
    const m = /^linear-gradient\(rgba\(var\((--[a-z-]+)\),\s*([\d.]+)\),\s*rgba\(var\(\1\),\s*\2\)\),\s*var\(--bg-card\)$/.exec(bg);
    assert.ok(m, `${sel} must tint over an opaque var(--bg-card) base (got ${bg})`);
    assert.equal(m[1], channel);
    const surface = blend(rgbOf(dawn, channel), Number(m[2]), card);
    const ratio = contrast(resolve(dawn, ink), surface);
    assert.ok(ratio >= 4.5, `${sel}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1 (< 4.5)`);
  }
  assert.equal(decl(ruleBody('body[data-theme="dawn"] #testmode-pill.checking'), 'background'), 'var(--bg-card)');
  const checking = contrast(resolve(dawn, '--text-secondary'), card);
  assert.ok(checking >= 4.5, `dawn checking pill is ${checking.toFixed(2)}:1 (< 4.5)`);
  for (const sel of cases.map(c => c[0]).concat('body[data-theme="dawn"] #testmode-pill.checking')) {
    assert.ok(!/animation|transition|opacity/.test(ruleBody(sel)), `${sel} must stay static`);
  }
});

test('every ring style keeps its countdown digits at 4.5:1 on every theme', () => {
  const ringTime = {};
  for (const r of rules) {
    const m = /^body\[data-ring="([a-z]+)"\] \.time-main$/.exec(r.selector);
    if (m && decl(r.body, 'color')) ringTime[m[1]] = decl(r.body, 'color');
  }
  assert.ok(ringTime.midnight, 'the Midnight ring style recolours the digits (fixture check)');
  const themes = ['carbon', 'aurora', 'ember', 'tide', 'dawn'];
  for (const [ring, base] of Object.entries(ringTime)) {
    for (const name of [null, ...themes]) {
      const map = name ? theme(name) : tokens([':root']);
      const over = name && rules.find(r => r.selector === `body[data-theme="${name}"][data-ring="${ring}"] .time-main`);
      const value = (over && decl(over.body, 'color')) || base;
      const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
      const ink = ref ? resolve(map, ref[1]) : value;
      assert.match(ink, /^#[0-9a-f]{6}$/i, `${ring}: digit colour must be a #rrggbb or a token`);
      for (const bg of ['--bg-primary', '--bg-card']) {
        const ratio = contrast(ink, resolve(map, bg));
        assert.ok(ratio >= 4.5, `${name || 'default'} + ${ring}: digits on ${bg} are ${ratio.toFixed(2)}:1 (< 4.5)`);
      }
    }
  }
});

test('the destructive tiny button keeps white text at 4.5:1 on hover', () => {
  const body = ruleBody('.btn-danger.btn-tiny:hover');
  assert.equal(decl(body, 'color'), '#fff');
  const bg = decl(body, 'background');
  assert.match(bg, /^#[0-9a-f]{6}$/i);
  const ratio = contrast('#ffffff', bg);
  assert.ok(ratio >= 4.5, `.btn-danger.btn-tiny:hover is ${ratio.toFixed(2)}:1 (< 4.5)`);
});

// ---- UI-R3 Fire pass: every new text / state token, on Midnight and Dawn ----
//
// Rule for the whole fire pass: a token that colours text is a #rrggbb literal
// or a var() chain to one, and has a Dawn value. Each fire package appends its
// pairs here. rgba decoration (ticks, glows, washes) stays out of these lists.
//   FIRE_TEXT_PAIRS  [ink, surface] text pairs, >= 4.5:1.
//   FIRE_STATE_PAIRS [mark, surface] pairs, >= 3:1, for a graphic that is the
//                    only cue of a state.
const FIRE_TEXT_PAIRS = [
  // Fire 01 chip inks (--chip-fg variants) on the card and footer surfaces.
  ['--text-secondary', '--bg-card'],      // neutral chip
  ['--text-secondary', '--bg-secondary'],
  ['--chip-ink-act', '--bg-card'],        // "you act" chip
  ['--chip-ink-act', '--bg-secondary'],
  ['--accent-amber', '--bg-card'],        // Test Mode chip
  ['--accent-amber', '--bg-secondary'],
  ['--accent-red', '--bg-card'],          // REAL / Forced chip
  ['--accent-red', '--bg-secondary'],
  ['--pf-teal', '--bg-card'],             // live chip
  ['--pf-teal', '--bg-secondary'],
  // Fire 01 destructive button: white ink on the deepened red, resting + hover.
  ['--danger-ink', '--danger-fill'],
  ['--danger-ink', '--danger-fill-hover'],
  // Fire 01 field system: values and placeholders on the field surfaces
  // (--bg-secondary everywhere, --bg-primary inside the My Modes form card).
  ['--text-primary', '--bg-secondary'],
  ['--text-muted', '--bg-secondary'],
  ['--text-primary', '--bg-primary'],
  ['--text-muted', '--bg-primary'],
  // Fire 02 Test Mode scope notes (#set-testmode-scope, #plan-scope-note):
  // amber in Test Mode, muted otherwise, on the card and panel surfaces.
  ['--accent-amber', '--bg-card'],
  ['--accent-amber', '--bg-secondary'],
  ['--accent-amber', '--bg-primary'],
  ['--text-muted', '--bg-card'],
  ['--text-muted', '--bg-secondary'],
  // Fire 02 footer: the branding line and the outcome word on the footer.
  ['--text-secondary', '--bg-secondary'],
  ['--pf-teal', '--bg-secondary'],
  // Fire 04 paused Resume: the dark accent ink on the filled violet, resting
  // and hover (--accent-blue).
  ['--accent-ink', '--accent-cyan'],
  ['--accent-ink', '--accent-blue'],
  // Fire 07 Devices: the Test Mode scope note (.device-scope-note, amber) on
  // the card; the off-card call to action (--chip-ink-act) on the card; the
  // red peer Stop outline's ink on the card.
  ['--accent-amber', '--bg-card'],
  ['--chip-ink-act', '--bg-card'],
  ['--accent-red', '--bg-card'],
  // Fire 08 Night Modes: the Ritual tag ink on the card (violet at night,
  // Dawn's darkened violet --chip-ink-act in Dawn); the detail's Test Mode
  // scope line (amber) on the card; the manager's armed 'Delete?' and the
  // overwrite note (red) on the dialog row / form surface.
  ['--chip-ink-act', '--bg-card'],
  ['--accent-amber', '--bg-card'],
  ['--accent-red', '--bg-secondary'],
  ['--accent-red', '--bg-card'],
  // Fire 09 Schedule: the calendar check line, amber (a fixed reason) or teal
  // (reached), on the provider panel (the card / panel surfaces); the armed
  // rule 'Delete?' (red) on the card.
  ['--accent-amber', '--bg-card'],
  ['--accent-amber', '--bg-secondary'],
  ['--pf-teal', '--bg-card'],
  ['--accent-red', '--bg-card'],
  // Fire 10 Proof: the ledger mode line's real (red; muted at 0) and Test
  // Mode (amber) counts on the dialog surfaces, and the live Routine streak
  // (teal; muted otherwise) on the card.
  ['--accent-red', '--bg-secondary'],
  ['--accent-amber', '--bg-secondary'],
  ['--text-muted', '--bg-secondary'],
  ['--accent-red', '--bg-card'],
  ['--accent-amber', '--bg-card'],
  ['--text-muted', '--bg-card'],
  ['--pf-teal', '--bg-card']
];
const FIRE_STATE_PAIRS = [
  // The destructive fill must read as a filled control on the card.
  ['--danger-fill', '--bg-card'],
  ['--chip-ink-act', '--bg-card'],
  // Fire 07: a lit (ready / live) satellite and the hub ring mark their state
  // in teal (border, beam, dot, ring track); the hub's paused / error track
  // is amber / red. The status pill text carries the same state in words.
  ['--pf-teal', '--bg-card'],
  ['--accent-amber', '--bg-card'],
  ['--accent-red', '--bg-card'],
  // Fire 09: a rule's day-track 'on' pill is the only mark of an active day
  // beside its letter (violet at night, Dawn's darkened violet in Dawn).
  ['--chip-ink-act', '--bg-card']
  // Fire 04's Dawn ring-tick ink is rgba decoration (not a #rrggbb text
  // token), so it is checked by blending in its own test below.
];

for (const [label, map] of [['midnight', tokens([':root'])], ['dawn', theme('dawn')]]) {
  test(`fire pass (${label}): text pairs reach 4.5:1 and state pairs 3:1`, () => {
    for (const [ink, bg] of FIRE_TEXT_PAIRS) {
      const ratio = contrast(resolve(map, ink), resolve(map, bg));
      assert.ok(ratio >= 4.5, `${label}: ${ink} on ${bg} is ${ratio.toFixed(2)}:1 (< 4.5)`);
    }
    for (const [mark, bg] of FIRE_STATE_PAIRS) {
      const ratio = contrast(resolve(map, mark), resolve(map, bg));
      assert.ok(ratio >= 3, `${label}: ${mark} on ${bg} is ${ratio.toFixed(2)}:1 (< 3)`);
    }
  });
}

test('fire pass (Fire 07): the Devices truth inks are the checked tokens', () => {
  assert.equal(decl(ruleBody('.device-scope-note'), 'color'), 'var(--accent-amber)');
  assert.equal(decl(ruleBody('.device-scope-note::before'), 'background'), 'var(--accent-amber)');
  const lit = ruleBody('.device-card:not(#device-card-pc):is([data-state="ok"], [data-state="live"])');
  assert.match(decl(lit, 'border-color'), /^rgba\(var\(--teal-rgb\), 0\.28\)$/);
  // Dawn: the wash stays within .08 alpha over the theme's own card.
  assert.match(decl(lit, 'background'), /rgba\(var\(--teal-rgb\), 0\.0[0-8]\)[\s\S]*var\(--bg-card\)$/);
  assert.equal(decl(ruleBody('#device-card-pc:is([data-state="ok"], [data-state="live"]) .hub-track'), 'stroke'), 'var(--pf-teal)');
  assert.equal(decl(ruleBody('.device-card:not(#device-card-pc)[data-state="off"] .device-link'), 'color'), 'var(--chip-ink-act)');
});

test('fire pass (Fire 08): the Night Modes truth inks are the checked tokens', () => {
  // Night: the ritual tag is the accent violet (checked as --accent-cyan via
  // --chip-ink-act, which is var(--accent-cyan) at night); Dawn: the
  // darkened violet token.
  assert.equal(decl(ruleBody('.nm-card-tag.nm-ritual'), 'color'), 'var(--accent-cyan)');
  assert.equal(tokens([':root'])['--chip-ink-act'], 'var(--accent-cyan)', 'at night the checked act ink is the accent');
  assert.equal(decl(ruleBody('body[data-theme="dawn"] .nm-card-tag.nm-ritual'), 'color'), 'var(--chip-ink-act)');
  assert.equal(decl(ruleBody('.nm-detail-scope'), 'color'), 'var(--accent-amber)');
  assert.equal(decl(ruleBody('#profiles-modal .profile-item-btn.btn-quiet.delete-btn.is-confirming'), 'color'), 'var(--accent-red)');
  assert.equal(decl(ruleBody('body[data-theme="dawn"] #profiles-modal .profile-item-btn.btn-quiet.delete-btn.is-confirming'), 'color'), 'var(--accent-red)');
  assert.equal(decl(ruleBody('#profiles-modal .profile-save-note'), 'color'), 'var(--accent-red)');
});

test('fire pass: every --chip-fg ink in styles.css is a checked token on Midnight and Dawn', () => {
  const inks = new Set();
  for (const r of topLevelRules(css)) {
    for (const m of r.body.matchAll(/--chip-fg\s*:\s*var\((--[a-z0-9-]+)\)/gi)) inks.add(m[1]);
  }
  assert.ok(inks.size >= 3, 'the chip tone tokens are declared (fixture check)');
  const listed = new Set(FIRE_TEXT_PAIRS.map(p => p[0]));
  for (const ink of inks) {
    assert.ok(listed.has(ink), `${ink} is used as a chip ink but is missing from FIRE_TEXT_PAIRS`);
    for (const [label, map] of [['midnight', tokens([':root'])], ['dawn', theme('dawn')]]) {
      for (const bg of ['--bg-card', '--bg-secondary']) {
        const ratio = contrast(resolve(map, ink), resolve(map, bg));
        assert.ok(ratio >= 4.5, `${label}: chip ink ${ink} on ${bg} is ${ratio.toFixed(2)}:1 (< 4.5)`);
      }
    }
  }
});

test('fire pass: dawn gives every new chip / danger token its own value', () => {
  const dawn = tokens(['body[data-theme="dawn"]']);
  for (const t of ['--chip-ink-act', '--danger-fill', '--danger-fill-hover']) assert.ok(dawn[t], `dawn must define ${t}`);
});

test('fire 04: the ring scale has a Dawn ink that reads at least as well as the night one', () => {
  // rgba(r, g, b, a) tokens, blended onto each theme's field.
  const rgba = v => {
    const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(v || '');
    assert.ok(m, `expected an rgba() token (got ${v})`);
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) };
  };
  const night = tokens([':root']);
  const dawn = theme('dawn');
  assert.notEqual(tokens(['body[data-theme="dawn"]'])['--ring-tick'], undefined, 'dawn overrides --ring-tick');
  assert.notEqual(tokens(['body[data-theme="dawn"]'])['--ring-tick-major'], undefined, 'dawn overrides --ring-tick-major');
  for (const name of ['--ring-tick', '--ring-tick-major']) {
    const n = rgba(night[name]);
    const d = rgba(dawn[name]);
    const nightField = resolve(night, '--bg-primary');
    const dawnField = resolve(dawn, '--bg-primary');
    assert.ok(luminance(blend(d.rgb, 1, '#000000')) < luminance(dawnField), `${name}: Dawn draws the scale in dark ink`);
    const nightRatio = contrast(blend(n.rgb, n.a, nightField), nightField);
    const dawnRatio = contrast(blend(d.rgb, d.a, dawnField), dawnField);
    assert.ok(dawnRatio >= nightRatio, `${name}: Dawn ${dawnRatio.toFixed(2)}:1 must read at least as well as night ${nightRatio.toFixed(2)}:1`);
    // A calm scale: never louder than a hairline-level mark at night.
    assert.ok(n.a <= 0.22, `${name}: the night scale stays calm (alpha ${n.a})`);
  }
});

test('fire 04: the paused Resume ink is the house accent ink and the fill reads on the night field', () => {
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer-settings.js'), 'utf8');
  const ink = (/const ACCENT_BUTTON_INK = '(#[0-9a-f]{6})';/i.exec(settingsSrc) || [])[1];
  const root = tokens([':root']);
  assert.equal(resolve(root, '--accent-ink').toLowerCase(), ink.toLowerCase(), '--accent-ink is ACCENT_BUTTON_INK (the accent sanitizer guarantees it)');
  const resume = ruleBody('body.is-paused #action-bar-running #btn-pause');
  assert.equal(decl(resume, 'background'), 'var(--accent-cyan)');
  assert.equal(decl(resume, 'color'), 'var(--accent-ink)');
  assert.equal(decl(ruleBody('body.is-paused #action-bar-running #btn-pause:hover'), 'background'), 'var(--accent-blue)');
  const fill = contrast(resolve(root, '--accent-cyan'), resolve(root, '--bg-primary'));
  assert.ok(fill >= 3, `the filled Resume on the night field is ${fill.toFixed(2)}:1 (< 3)`);
});

test('fire pass: --accent-blue hovers visibly change and stay legible for every night-safe swatch', () => {
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer-settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const shade = Number((/const ACCENT_HOVER_SHADE = (\d+);/.exec(settingsSrc) || [])[1]);
  assert.ok(shade > 0 && shade < 100, 'ACCENT_HOVER_SHADE is a percentage below 100 (never the raw accent)');
  assert.match(settingsSrc, /setProperty\('--accent-blue', `color-mix\(in srgb, \$\{accent\} \$\{ACCENT_HOVER_SHADE\}%, #000\)`\)/);
  // color-mix(in srgb, accent p%, #000): each sRGB channel scales by p.
  const mix = hex => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * shade / 100).toString(16).padStart(2, '0')).join('');
  const swatches = [...html.matchAll(/class="swatch"[^>]*data-color="(#[0-9a-f]{6})"/gi)].map(m => m[1].toLowerCase());
  assert.ok(swatches.length >= 3, 'the accent swatches are offered (fixture check)');
  const root = tokens([':root']);
  const card = resolve(root, '--bg-card');
  for (const accent of swatches) {
    const hover = mix(accent);
    assert.ok(contrast(accent, hover) >= 1.1, `${accent}: hover ${hover} must visibly differ from the accent`);
    assert.ok(contrast('#14101f', hover) >= 4.5, `${accent}: the dark button ink on the hover ${hover} is ${contrast('#14101f', hover).toFixed(2)}:1`);
    assert.ok(contrast(hover, card) >= 4.5, `${accent}: --accent-blue text ${hover} on the card is ${contrast(hover, card).toFixed(2)}:1`);
  }
  // The static default (browser preview, before applyCustomization) is the same mix.
  assert.equal(resolve(root, '--accent-blue').toLowerCase(), mix(resolve(root, '--accent-cyan').toLowerCase()));
});

test('fire pass (Fire 09): the Schedule truth inks are the checked tokens', () => {
  assert.equal(decl(ruleBody('#sch-rules .sch-day.on'), 'background'), 'var(--chip-ink-act)');
  assert.equal(decl(ruleBody('.sch-cal-status[data-tone="attn"]'), 'color'), 'var(--accent-amber)');
  assert.equal(decl(ruleBody('.sch-cal-status[data-tone="live"]'), 'color'), 'var(--pf-teal)');
  assert.equal(decl(ruleBody('#sch-rules .rule-delete-btn.is-confirming'), 'color'), 'var(--accent-red)');
  assert.equal(decl(ruleBody('body[data-theme="dawn"] #sch-rules .rule-delete-btn.is-confirming'), 'color'), 'var(--accent-red)');
  for (const sel of ['.sch-cal-status[data-tone="attn"]', '.sch-cal-status[data-tone="live"]', '#sch-rules .sch-day.on']) {
    assert.ok(!/animation|transition|opacity/.test(ruleBody(sel)), `${sel} must stay static`);
  }
});
