'use strict';

// UI-R3 P11: Proof reads as evidence. renderer-receipts.js (the whole file:
// it only declares functions and constants) and the glyph / origin / night
// sections of renderer-utils.js run in a vm sandbox with a tiny fake DOM and
// a fixed clock. No Electron, no DOM library, no app launch.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
const receiptsSource = fs.readFileSync(path.join(root, 'renderer-receipts.js'), 'utf8');

function section(source, from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(`section ${from} .. ${to} not found`);
  return source.slice(a, b);
}

function createClassList() {
  const values = new Set();
  return {
    add: (...n) => n.forEach(x => values.add(x)),
    remove: (...n) => n.forEach(x => values.delete(x)),
    contains: n => values.has(n),
    toggle: (n, force) => { const on = force === undefined ? !values.has(n) : Boolean(force); if (on) values.add(n); else values.delete(n); return on; }
  };
}

function createDocument() {
  const byId = new Map();
  const doc = { active: null };
  function makeEl(id = null) {
    const e = {
      id,
      dataset: {},
      style: {},
      hidden: false,
      disabled: false,
      className: '',
      title: '',
      attrs: {},
      children: [],
      innerHTML: '',
      _text: '',
      focusCount: 0,
      classList: createClassList(),
      get textContent() { return this._text + this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join(''); },
      set textContent(v) { this._text = String(v); this.children = []; },
      append(...nodes) { this.children.push(...nodes); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      focus() { this.focusCount++; doc.active = this; },
      scrolls: [],
      scrollIntoView(opts) { this.scrolls.push(opts); },
      rows: [],
      querySelectorAll() { return this.rows; }
    };
    return e;
  }
  doc.getElementById = id => {
    if (!byId.has(id)) byId.set(id, makeEl(id));
    return byId.get(id);
  };
  doc.createElement = () => makeEl();
  doc.makeEl = makeEl;
  // The Routine legend's optional entries (bad / active / nodata).
  doc.legendItems = ['bad', 'active', 'nodata'].map(k => { const e = makeEl(); e.dataset.legend = k; e.hidden = true; return e; });
  doc.querySelectorAll = sel => (sel === '.routine-legend li[data-legend]' ? doc.legendItems : []);
  return doc;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createSandbox({ api = {}, state = { running: false, paused: false }, window } = {}) {
  const document = createDocument();
  const notes = [];
  const timers = [];
  const els = {};
  for (const [key, id] of Object.entries({
    morningProofSection: 'morning-proof-section', proofCard: 'proof-card', proofBadge: 'proof-badge',
    receiptStats: 'receipt-stats', receiptsList: 'receipts-list', btnClearReceipts: 'btn-clear-receipts'
  })) els[key] = document.getElementById(id);
  const sandbox = {
    document,
    els,
    api,
    state,
    console: { error() {}, log() {} },
    notify: (...args) => notes.push(args),
    escapeHtml,
    Date,
    Promise,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }
  };
  if (window) sandbox.window = window;
  const context = vm.createContext(sandbox);
  const source = [
    section(utilsSource, '// -- Glyph system (UI-R3 P04)', '// -- Dialog layers (UI-R3 P05)'),
    receiptsSource,
    'this.__p11 = { LO_GLYPHS, nightKey, nightKeyShift, nightKeyDate, RECEIPT_TONE, receiptToneOf, receiptTruth, proofEyebrowFor, morningNoteFor, buildNightStrip, nightOutcomeOf, receiptStatsMarkup, renderReceiptsModal, renderMorningProof, loadMorningProof, confirmClearReceipts, openReceiptsClearConfirm, resetReceiptsClearConfirm, safeReceiptId, shortReceiptId, renderNightStrip, receiptRunSpan, formatRunLength, receiptRunDetail, focusLedgerReceipt, buildProofText };'
  ].join('\n');
  vm.runInContext(source, context);
  return { ...context.__p11, document, els, notes, sandbox, timers };
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

test('nightKey: local start date minus 6 h; invalid dates are null', () => {
  const s = createSandbox();
  assert.equal(s.nightKey(new Date(2026, 9, 5, 0, 30)), '2026-10-04', 'a 00:30 run belongs to the evening before');
  assert.equal(s.nightKey(new Date(2026, 9, 5, 23, 0)), '2026-10-05');
  assert.equal(s.nightKey(new Date(2026, 9, 5, 6, 0)), '2026-10-05');
  assert.equal(s.nightKey('not a date'), null);
  assert.equal(s.nightKey(null), null);
  assert.equal(s.nightKey(''), null);
  assert.equal(s.nightKeyShift('2026-10-01', -1), '2026-09-30');
  assert.equal(s.nightKeyShift('2026-12-31', 1), '2027-01-01');
  assert.equal(s.nightKeyShift('garbage', 1), null);
});

test('RECEIPT_TONE: one vocabulary; Test Mode never reads as done; unknown is neutral', () => {
  const s = createSandbox();
  const tone = r => s.receiptToneOf(r).tone;
  assert.equal(tone('power_executed'), 'done');
  assert.equal(tone('completed'), 'done');
  assert.equal(tone('dry_run_completed'), 'test');
  assert.equal(tone('cancelled'), 'cancel');
  assert.equal(tone('interrupted'), 'warn');
  assert.equal(tone('running'), 'running');
  assert.equal(tone('completing'), 'running');
  assert.equal(tone('blocked'), 'bad');
  assert.equal(tone('error'), 'bad');
  const unknown = s.receiptToneOf('some_new_result');
  assert.equal(unknown.tone, 'neutral');
  assert.equal(unknown.title, 'Some New Result');
  for (const meta of Object.values(s.RECEIPT_TONE)) assert.ok(Object.prototype.hasOwnProperty.call(s.LO_GLYPHS, meta.glyph), `glyph ${meta.glyph} must be a LO_GLYPHS key`);
  assert.equal(s.receiptToneOf('__proto__').tone, 'neutral', 'prototype keys are not results');
});

test('receiptTruth: TEST MODE whenever dryRun; "command sent" only for power_executed', () => {
  const s = createSandbox();
  assert.equal(s.receiptTruth({ dryRun: true, result: 'cancelled', action: 'shutdown' }).text, 'TEST MODE · nothing ran');
  assert.equal(s.receiptTruth({ dryRun: true, result: 'dry_run_completed', action: 'sleep' }).text, 'TEST MODE · nothing ran');
  assert.equal(s.receiptTruth({ dryRun: false, result: 'power_executed', action: 'hibernate' }).text, 'REAL ACTION · Hibernate command sent');
  assert.equal(s.receiptTruth({ dryRun: false, result: 'blocked', action: 'shutdown' }).text, 'REAL ACTION · Shutdown did not run');
  assert.equal(s.receiptTruth({ dryRun: false, result: 'cancelled', action: 'restart' }).text, 'REAL ACTION · Restart did not run');
  assert.equal(s.receiptTruth({ dryRun: false, result: 'interrupted', action: 'sleep' }).text, 'REAL ACTION · Sleep did not run');
  assert.equal(s.receiptTruth({ dryRun: false, result: 'running', action: 'sleep' }).text, 'REAL ACTION · not finished');
  assert.equal(s.receiptTruth({ dryRun: false, result: 'completing', action: 'sleep' }).text, 'REAL ACTION · not finished');
});

test('proofEyebrowFor: TONIGHT / LAST NIGHT by the shared nightKey rule, otherwise the date', () => {
  const s = createSandbox();
  const at3am = new Date(2026, 9, 6, 3, 0);
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 5, 23, 0).toISOString(), at3am), 'TONIGHT');
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 4, 23, 30).toISOString(), at3am), 'LAST NIGHT');
  const at2pm = new Date(2026, 9, 6, 14, 0);
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 5, 22, 0).toISOString(), at2pm), 'LAST NIGHT');
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 6, 1, 0).toISOString(), at2pm), 'LAST NIGHT');
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 6, 12, 0).toISOString(), at2pm), 'TODAY', 'a noon run is never "last night"');
  // Same bucket as the strip / ledger (nightKey): a 16:30 run is in tonight's
  // cell, so it is never a dated 'LATEST RUN'; 05:30 is still last night.
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 6, 16, 30).toISOString(), new Date(2026, 9, 6, 22, 0)), 'TODAY');
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 6, 17, 30).toISOString(), new Date(2026, 9, 6, 22, 0)), 'TONIGHT');
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 6, 5, 30).toISOString(), new Date(2026, 9, 6, 9, 0)), 'LAST NIGHT');
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 5, 13, 0).toISOString(), new Date(2026, 9, 6, 9, 0)), 'YESTERDAY', 'a daytime run in the previous night bucket is never "last night"');
  assert.match(s.proofEyebrowFor(new Date(2026, 9, 3, 23, 0).toISOString(), at2pm), /^LATEST RUN · /);
  for (const [run, now] of [[new Date(2026, 9, 6, 16, 30), new Date(2026, 9, 6, 22, 0)], [new Date(2026, 9, 6, 5, 30), new Date(2026, 9, 6, 9, 0)], [new Date(2026, 9, 5, 23, 0), at3am]]) {
    const word = s.proofEyebrowFor(run.toISOString(), now);
    const sameNight = s.nightKey(run) === s.nightKey(now);
    const prevNight = s.nightKey(run) === s.nightKeyShift(s.nightKey(now), -1);
    assert.ok(sameNight ? ['TONIGHT', 'TODAY'].includes(word) : prevNight ? ['LAST NIGHT', 'YESTERDAY'].includes(word) : /^LATEST RUN/.test(word), `${word} agrees with nightKey`);
  }
  assert.equal(s.proofEyebrowFor(new Date(2026, 9, 6, 18, 0).toISOString(), new Date(2026, 9, 6, 19, 0)), 'TONIGHT');
  assert.equal(s.proofEyebrowFor(null, at2pm), 'LATEST RUN');
});

test('morningNoteFor: only a REAL Sleep / Hibernate / Shutdown main confirmed in the last 16 h', () => {
  const s = createSandbox();
  const now = Date.UTC(2026, 9, 6, 7, 0);
  const sevenHoursAgo = new Date(now - 7 * 3600 * 1000).toISOString();
  const base = { id: 'r_1759700000000_abc123', dryRun: false, action: 'sleep', result: 'power_executed', endedAt: sevenHoursAgo };
  const note = s.morningNoteFor(base, now);
  assert.ok(note);
  assert.equal(note.action, 'Sleep');
  assert.equal(note.shortId, 'R-abc123');
  for (const result of ['dry_run_completed', 'blocked', 'error', 'interrupted', 'cancelled', 'running', 'completing']) {
    assert.equal(s.morningNoteFor({ ...base, result }, now), null, `${result} never gets a morning note`);
  }
  assert.equal(s.morningNoteFor({ ...base, dryRun: true }, now), null, 'never for Test Mode');
  assert.equal(s.morningNoteFor({ ...base, action: 'lock' }, now), null, 'only sleep / hibernate / shutdown');
  assert.ok(s.morningNoteFor({ ...base, action: 'hibernate' }, now));
  assert.ok(s.morningNoteFor({ ...base, action: 'shutdown' }, now));
  assert.equal(s.morningNoteFor({ ...base, endedAt: new Date(now - 17 * 3600 * 1000).toISOString() }, now), null, 'older than 16 h');
  assert.equal(s.morningNoteFor({ ...base, endedAt: null }, now), null);
  assert.equal(s.morningNoteFor({ ...base, id: 'bad"id' }, now), null, 'a malformed id is never shown');
});

test('morningNoteFor: the lead word is only "Last night" for the previous night window', () => {
  const s = createSandbox();
  const base = { id: 'r_1759700000000_abc123', dryRun: false, action: 'sleep', result: 'power_executed' };
  const at = (d, now) => s.morningNoteFor({ ...base, endedAt: d.toISOString() }, now.getTime()).lead;
  assert.equal(at(new Date(2026, 9, 5, 23, 30), new Date(2026, 9, 6, 7, 0)), 'Last night');
  assert.equal(at(new Date(2026, 9, 6, 1, 30), new Date(2026, 9, 6, 7, 0)), 'Last night');
  assert.equal(at(new Date(2026, 9, 6, 13, 0), new Date(2026, 9, 6, 15, 0)), 'Earlier today', 'a 13:00 nap read at 15:00 is not "last night"');
  assert.equal(at(new Date(2026, 9, 5, 23, 0), new Date(2026, 9, 6, 2, 0)), 'Earlier tonight');
  assert.equal(at(new Date(2026, 9, 5, 14, 0), new Date(2026, 9, 6, 1, 0)), 'Latest');
});

test('buildNightStrip: 14 nights, priority real > test > cancel > bad > active, honest no-data', () => {
  const s = createSandbox();
  const now = new Date(2026, 9, 6, 9, 0); // tonight = night of Oct 6
  const at = (day, hour) => new Date(2026, 9, day, hour, 0).toISOString();
  const receipts = [
    { startedAt: at(5, 23), result: 'power_executed', dryRun: false },
    { startedAt: at(5, 22), result: 'dry_run_completed', dryRun: true },
    { startedAt: at(4, 23), result: 'dry_run_completed', dryRun: true },
    { startedAt: at(4, 22), result: 'cancelled', dryRun: true },
    { startedAt: at(3, 23), result: 'interrupted', dryRun: false },
    { startedAt: at(2, 23), result: 'blocked', dryRun: false },
    { startedAt: at(1, 2), result: 'running', dryRun: false }, // 02:00 Oct 1 -> night of Sep 30
    { startedAt: 'garbage', result: 'power_executed', dryRun: false }
  ];
  const { cells, hasReceipts } = s.buildNightStrip(receipts, now);
  assert.equal(cells.length, 14);
  assert.equal(hasReceipts, true);
  assert.equal(cells[13].key, '2026-10-06');
  assert.equal(cells[13].tonight, true);
  const byKey = Object.fromEntries(cells.map(c => [c.key, c.outcome]));
  assert.equal(byKey['2026-10-06'], 'none', 'tonight, inside the window, no run');
  assert.equal(byKey['2026-10-05'], 'real');
  assert.equal(byKey['2026-10-04'], 'test', 'test outranks cancel');
  assert.equal(byKey['2026-10-03'], 'cancel', 'interrupted counts with cancelled');
  assert.equal(byKey['2026-10-02'], 'bad');
  assert.equal(byKey['2026-10-01'], 'none');
  assert.equal(byKey['2026-09-30'], 'active');
  assert.equal(byKey['2026-09-29'], 'nodata', 'before the oldest receipt is no data, not "no run"');
  assert.equal(cells[0].key, '2026-09-23');
  // A Test Mode night is never drawn as real.
  assert.equal(s.nightOutcomeOf({ result: 'dry_run_completed', dryRun: true }), 'test');
  assert.equal(s.nightOutcomeOf({ result: 'completed', dryRun: true }), null);
  const empty = s.buildNightStrip([], now);
  assert.equal(empty.hasReceipts, false);
  assert.ok(empty.cells.every(c => c.outcome === 'nodata'));
});

test('renderNightStrip reads listReceipts(100) and the real streak; empty state', async () => {
  const calls = [];
  const s = createSandbox({
    api: {
      listReceipts: async n => { calls.push(n); return []; },
      getStreaks: async () => ({ streak: 0, bestStreak: 0, totalNights: 0 })
    }
  });
  await s.renderNightStrip();
  assert.deepEqual(calls, [100]);
  assert.equal(s.document.getElementById('night-strip').children.length, 14);
  assert.equal(s.document.getElementById('night-strip-empty').hidden, false);
  assert.equal(s.document.getElementById('night-strip-empty').textContent, 'No runs recorded on this PC yet');
  assert.equal(s.document.getElementById('routine-streak').textContent, "No real completions yet · Test Mode runs don't count");

  const s2 = createSandbox({
    api: {
      listReceipts: async () => [{ startedAt: new Date().toISOString(), result: 'power_executed', dryRun: false }],
      getStreaks: async () => ({ streak: 2, bestStreak: 5, totalNights: 9 })
    }
  });
  await s2.renderNightStrip();
  assert.equal(s2.document.getElementById('night-strip-empty').hidden, true);
  assert.equal(s2.document.getElementById('routine-streak').textContent, 'Real streak · 2 nights · best 5');
  const cell = s2.document.getElementById('night-strip').children[13];
  assert.match(cell.attrs['aria-label'], /1 real action sent/);
  // Only one receipt (tonight): the 13 older nights are 'no data', so only
  // that optional legend entry appears; 'bad' / 'active' stay hidden.
  assert.deepEqual(s2.document.legendItems.map(i => i.hidden), [true, true, false]);

  // A blocked run 3 nights ago: older nights are 'no data', so those two
  // legend entries appear; 'Not finished' stays hidden.
  const threeAgo = new Date();
  threeAgo.setDate(threeAgo.getDate() - 3);
  threeAgo.setHours(23, 0, 0, 0);
  const s3 = createSandbox({
    api: { listReceipts: async () => [{ startedAt: threeAgo.toISOString(), result: 'blocked', dryRun: false }], getStreaks: async () => ({}) }
  });
  await s3.renderNightStrip();
  const legend = Object.fromEntries(s3.document.legendItems.map(i => [i.dataset.legend, i.hidden]));
  assert.deepEqual(legend, { bad: false, active: true, nodata: false });
});

test('ledger stats: one ratio bar whose segments omit zeros; nothing at total 0', () => {
  const s = createSandbox();
  assert.equal(s.receiptStatsMarkup({ total: 0 }), '');
  assert.equal(s.receiptStatsMarkup(null), '');
  const html = s.receiptStatsMarkup({ total: 7, completed: 1, dryRun: 3, cancelled: 2, blocked: 0, interrupted: 1, other: 0 });
  assert.match(html, /role="img" aria-label="7 runs: 1 real completed, 3 Test Mode completed, 2 cancelled, 1 interrupted"/);
  assert.match(html, /<li data-tone="test"><b>3<\/b>Test completed<\/li>/, "the Test segment's legend reads 'Test completed'");
  assert.equal((html.match(/<span data-tone=/g) || []).length, 4, 'zero segments are omitted');
  assert.ok(!/data-tone="bad"|data-tone="running"/.test(html));
  // An older main without the new buckets: the remainder is 'unfinished'.
  const legacy = s.receiptStatsMarkup({ total: 3, completed: 1, dryRun: 1, cancelled: 0, blocked: 0 });
  assert.match(legacy, /1 unfinished/);
  // ...and no mode axis: no mode line, and the legend keeps its own total.
  assert.ok(!/receipt-mode-line/.test(legacy), 'no mode line without testRuns / realRuns');
  assert.match(legacy, /<li class="receipt-legend-total"><b>3<\/b>on this PC<\/li>/);
  assert.ok(!/receipt-mode-line/.test(html), 'stats without the mode fields never show a mode line');
});

test('Fire 10 ledger: the mode line separates Real / Test Mode from the outcome, colour by data-truth only', () => {
  const s = createSandbox();
  const html = s.receiptStatsMarkup({ total: 59, completed: 0, dryRun: 10, cancelled: 48, blocked: 0, interrupted: 1, other: 0, testRuns: 59, realRuns: 0, unknownModeRuns: 0 });
  assert.match(html, /^<p class="receipt-mode-line" aria-label="0 real and 59 Test Mode runs on this PC"><b data-truth="real" data-zero>0<\/b> real · <b data-truth="test">59<\/b> Test Mode · 59 on this PC<\/p><div class="receipt-ratio"/, 'the mode line sits above the outcome bar');
  assert.ok(!/receipt-legend-total/.test(html), 'the total is printed once (the mode line), not again in the legend');
  assert.ok(!/style="color/.test(html), 'no inline colour');
  const real = s.receiptStatsMarkup({ total: 5, completed: 2, dryRun: 1, cancelled: 2, blocked: 0, interrupted: 0, other: 0, testRuns: 2, realRuns: 2, unknownModeRuns: 1 });
  assert.match(real, /<b data-truth="real">2<\/b> real · <b data-truth="test">2<\/b> Test Mode · 5 on this PC · <span class="receipt-mode-unknown">1 mode unknown<\/span>/, 'a real count above 0 is not muted; unknown modes are muted, never folded into real');
  assert.match(real, /aria-label="2 real and 2 Test Mode runs on this PC, 1 mode unknown"/);
  // Non-numbers never render as a count.
  for (const bad of [{ testRuns: '5', realRuns: 0 }, { testRuns: NaN, realRuns: 0 }, { testRuns: 1 }, { realRuns: 1 }]) {
    const out = s.receiptStatsMarkup({ total: 5, completed: 0, dryRun: 0, cancelled: 5, blocked: 0, interrupted: 0, other: 0, ...bad });
    assert.ok(!/receipt-mode-line/.test(out), `no mode line for ${JSON.stringify(bad)}`);
  }
});

test('renderReceiptsModal: night groups, escaped ids, Test Mode chip, glyphs not emoji', () => {
  const s = createSandbox();
  const receipts = [
    { id: 'r_1_aaaaaa', startedAt: new Date(2026, 9, 5, 23, 0).toISOString(), result: 'cancelled', dryRun: true, action: 'shutdown', durationSeconds: 1500, origin: 'phone' },
    { id: 'r_2_bbbbbb', startedAt: new Date(2026, 9, 5, 22, 0).toISOString(), result: 'interrupted', dryRun: false, action: 'sleep', durationSeconds: 600 },
    { id: 'evil"><img>', startedAt: new Date(2026, 9, 3, 23, 0).toISOString(), result: 'power_executed', dryRun: false, forceShutdown: true, action: 'shutdown', durationSeconds: 60 }
  ];
  s.renderReceiptsModal(receipts, { total: 3, completed: 1, cancelled: 1, dryRun: 0, blocked: 0, interrupted: 1, other: 0 });
  const html = s.els.receiptsList.innerHTML;
  assert.equal((html.match(/class="receipt-night"/g) || []).length, 2, 'two nights, two headers');
  assert.match(html, /data-receipt-id="r_1_aaaaaa"/);
  assert.ok(!html.includes('evil') && !html.includes('<img>'), 'a malformed id never reaches the markup');
  assert.match(html, /<span class="receipt-meta-chip chip-test">Test Mode<\/span>/);
  assert.match(html, /<span class="receipt-meta-chip chip-forced">Forced<\/span>/);
  assert.match(html, /from your phone/);
  assert.match(html, />Interrupted</, 'humanized result text kept');
  assert.match(html, /<span class="receipt-id">R-aaaaaa<\/span>/);
  assert.ok(!EMOJI.test(html) && !EMOJI.test(s.els.receiptStats.innerHTML), 'no emoji in the ledger');
  assert.ok(!/style="color/.test(html + s.els.receiptStats.innerHTML), 'no inline colours');
  // Fire 10: no remainingSeconds recorded -> the planned length, said as such.
  assert.match(html, /<span class="receipt-meta-chip">25m planned<\/span>/);
  assert.ok(!/<span class="receipt-meta-chip">25m<\/span>/.test(html), 'a planned length is never shown as if it ran');
});

test('Fire 10 ledger chips: ran / planned for a known short run, planned otherwise; the Test chip is dryRun === true', () => {
  const s = createSandbox();
  const at = new Date(2026, 9, 5, 23, 0).toISOString();
  s.renderReceiptsModal([
    { id: 'r_1_aaaaaa', startedAt: at, result: 'cancelled', dryRun: true, action: 'shutdown', durationSeconds: 1500, remainingSeconds: 1490, snoozeCount: 0 },
    { id: 'r_2_bbbbbb', startedAt: at, result: 'dry_run_completed', dryRun: true, action: 'shutdown', durationSeconds: 5400, remainingSeconds: 0, snoozeCount: 0 },
    { id: 'r_3_cccccc', startedAt: at, result: 'cancelled', dryRun: 'yes', action: 'sleep', durationSeconds: 600, remainingSeconds: 1200, snoozeCount: 1 }
  ], { total: 3 });
  const html = s.els.receiptsList.innerHTML;
  assert.match(html, /<span class="receipt-meta-chip">&lt;1m \/ 25m<\/span>/, 'a known cancel shows ran / planned');
  assert.match(html, /<span class="receipt-meta-chip">1h 30m<\/span>/, 'a completed run shows its planned length, h/m from an hour up');
  assert.match(html, /<span class="receipt-meta-chip">10m planned<\/span>/, 'a snoozed run cannot say how long it ran');
  assert.equal((html.match(/chip-test/g) || []).length, 2, "the Test chip uses r.dryRun === true (a truthy 'yes' is not Test Mode)");
});

test('Fire 02 ledger: Night of headers, time-only rows in the 12h/24h setting, a +1 day marker after midnight', () => {
  const receipts = [
    { id: 'r_1_aaaaaa', startedAt: new Date(2026, 9, 7, 0, 16).toISOString(), result: 'cancelled', dryRun: true, action: 'shutdown', durationSeconds: 1500 },
    { id: 'r_2_bbbbbb', startedAt: new Date(2026, 9, 6, 17, 53).toISOString(), result: 'dry_run_completed', dryRun: true, action: 'shutdown', durationSeconds: 600 },
    { id: 'r_3_cccccc', startedAt: 'not a date', result: 'interrupted', dryRun: false, action: 'sleep', durationSeconds: 60 }
  ];
  const h24 = createSandbox({ state: { running: false, paused: false, clockFormat: '24h' } });
  h24.renderReceiptsModal(receipts, { total: 3 });
  const html24 = h24.els.receiptsList.innerHTML;
  const headers = [...html24.matchAll(/<h4 class="receipt-night">([^<]*)<\/h4>/g)].map(m => m[1]);
  assert.equal(headers.length, 2, 'one night plus the unknown group');
  assert.match(headers[0], /^Night of /, 'a night group says Night of');
  assert.ok(headers[0].includes('6'), 'the 00:16 run groups under the evening before (Oct 6)');
  assert.equal(headers[1], 'Unknown date', 'an unknown start keeps its header with no prefix');
  assert.ok(!/Tonight|Last night/.test(html24), 'never Tonight / Last night from the key alone');
  assert.match(html24, /<span class="receipt-row-date">00:16<span class="receipt-after-midnight" aria-label="next day">\+1 day<\/span><\/span>/);
  assert.match(html24, /<span class="receipt-row-date">17:53<\/span>/, 'a same-day run has no marker and no date');
  assert.match(html24, /<span class="receipt-row-date">Unknown time<\/span>/, 'an invalid start keeps Unknown time and no marker');
  assert.equal((html24.match(/receipt-after-midnight/g) || []).length, 1);

  const h12 = createSandbox({ state: { running: false, paused: false, clockFormat: '12h' } });
  h12.renderReceiptsModal(receipts, { total: 3 });
  const html12 = h12.els.receiptsList.innerHTML;
  assert.match(html12, /<span class="receipt-row-date">5:53 PM<\/span>/);
  assert.match(html12, /<span class="receipt-row-date">12:16 AM<span class="receipt-after-midnight"/);
  assert.doesNotMatch(html12, /\b0\d:\d\d [AP]M/, 'no zero-padded 12h hour');
});

test('Fire 02 Proof hero: Started / Cancelled follow the 12h/24h setting', async () => {
  const receipt = { id: 'r_1759700000000_q1w2e3', startedAt: new Date(2026, 9, 6, 17, 53).toISOString(), endedAt: new Date(2026, 9, 6, 18, 5).toISOString(), result: 'cancelled', dryRun: true, action: 'shutdown', durationSeconds: 1500 };
  // UI-R3 Fire 10: the times live in the strip's STARTED / ENDED cells (the
  // end label from endWord); the separate timestamp line is gone.
  const cells = s => [s.document.getElementById('ns-pill-start-val').textContent, s.document.getElementById('ns-pill-end-label').textContent, s.document.getElementById('ns-pill-end-val').textContent];
  const h24 = createSandbox({ api: { getReceiptStats: async () => ({ total: 1 }) }, state: { running: false, paused: false, clockFormat: '24h' } });
  await h24.renderMorningProof(receipt);
  assert.deepEqual(cells(h24), ['17:53', 'Cancelled', '18:05']);
  const h12 = createSandbox({ api: { getReceiptStats: async () => ({ total: 1 }) }, state: { running: false, paused: false, clockFormat: '12h' } });
  await h12.renderMorningProof(receipt);
  assert.deepEqual(cells(h12), ['5:53 PM', 'Cancelled', '6:05 PM']);
  assert.doesNotMatch(cells(h12).join(' '), /\b0\d:\d\d [AP]M/);
  const unset = createSandbox({ api: { getReceiptStats: async () => ({ total: 1 }) } });
  await unset.renderMorningProof(receipt);
  assert.deepEqual(cells(unset), ['17:53', 'Cancelled', '18:05'], 'no clockFormat reads 24h');
  // Invalid dates hide their cell; never a placeholder time.
  const bad = createSandbox({ api: { getReceiptStats: async () => ({ total: 1 }) } });
  await bad.renderMorningProof({ ...receipt, result: 'interrupted', startedAt: 'garbage', endedAt: null });
  assert.equal(bad.document.getElementById('ns-pill-start').style.display, 'none');
  assert.equal(bad.document.getElementById('ns-pill-end').style.display, 'none');
  assert.equal(bad.document.getElementById('ns-pill-end-label').textContent, 'Found interrupted');
});

test('renderMorningProof: tone, seal glyph, truth line, sub line, no inline colour, idle-only', async () => {
  const s = createSandbox({ api: { getReceiptStats: async () => ({ total: 4 }) } });
  const receipt = { id: 'r_1759700000000_q1w2e3', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), result: 'cancelled', dryRun: true, action: 'shutdown', forceShutdown: false, durationSeconds: 1500, pauseCount: 2, snoozeCount: 0, origin: 'phone' };
  await s.renderMorningProof(receipt);
  assert.equal(s.els.morningProofSection.style.display, '');
  assert.equal(s.els.proofCard.dataset.tone, 'cancel');
  assert.equal(s.document.getElementById('proof-seal-glyph').innerHTML, s.LO_GLYPHS.cross);
  assert.equal(s.document.getElementById('ns-proof-truth').textContent, 'TEST MODE · nothing ran');
  assert.equal(s.document.getElementById('ns-proof-truth').dataset.truth, 'test');
  assert.equal(s.document.getElementById('ns-proof-sub').textContent, 'Countdown · Shutdown · R-q1w2e3 · from your phone');
  assert.equal(s.document.getElementById('ns-proof-title').textContent, 'Run cancelled');
  assert.equal(s.els.proofBadge.textContent, 'Cancelled');
  assert.equal(s.els.proofBadge.style.color, undefined, 'no inline colour on the badge');
  // Fire 10: pauses / snoozes are one muted line under ACTION (the old
  // pills are gone); the total moved to the page head.
  const note = s.document.getElementById('ns-pill-action-note');
  assert.equal(note.textContent, '2 pauses');
  assert.equal(note.hidden, false);
  assert.equal(s.document.getElementById('ns-pill-action-val').textContent, 'ShutdownTEST', 'the action pill carries an amber TEST text badge, no emoji');
  assert.equal(s.document.getElementById('proof-page-meta').textContent, '4 receipts · this PC');
  assert.equal(s.document.getElementById('proof-page-meta').hidden, false);
  // No remainingSeconds on this receipt: the planned length, labelled so.
  assert.equal(s.document.getElementById('ns-pill-duration-label').textContent, 'PLANNED');
  assert.equal(s.document.getElementById('ns-pill-duration-val').textContent, '25m');
  assert.equal(s.document.getElementById('ns-pill-duration').attrs['aria-label'], 'Planned 25 minutes');
  assert.equal(s.document.getElementById('ns-pill-duration-of').hidden, true);
  // Open receipt targets this receipt's row.
  assert.equal(s.document.getElementById('btn-proof-details').dataset.receiptId, 'r_1759700000000_q1w2e3');
  assert.equal(s.document.getElementById('btn-proof-details').textContent, 'Open receipt');

  const real = { ...receipt, result: 'power_executed', dryRun: false, forceShutdown: true, origin: undefined, id: 42 };
  await s.renderMorningProof(real);
  assert.equal(s.els.proofCard.dataset.tone, 'done');
  assert.equal(s.document.getElementById('ns-proof-truth').textContent, 'REAL ACTION · Shutdown command sent');
  assert.equal(s.document.getElementById('ns-proof-sub').textContent, 'Countdown · Shutdown', 'a non-string id and a missing origin add nothing');
  assert.equal(s.document.getElementById('ns-pill-action-val').textContent, 'ShutdownForced');
  assert.equal(s.document.getElementById('btn-proof-details').dataset.receiptId, '', 'a malformed id never becomes a target');
  assert.equal(s.document.getElementById('btn-proof-details').textContent, 'View ledger');

  const interrupted = { ...receipt, result: 'interrupted', dryRun: false };
  await s.renderMorningProof(interrupted);
  assert.equal(s.els.proofCard.dataset.tone, 'warn');
  assert.equal(s.document.getElementById('proof-seal-glyph').innerHTML, s.LO_GLYPHS.warn);

  const busy = createSandbox({ api: { getReceiptStats: async () => ({ total: 1 }) }, state: { running: true, paused: false } });
  await busy.renderMorningProof(receipt);
  assert.equal(busy.els.morningProofSection.style.display, 'none', 'never un-hidden during a run');
});

test('loadMorningProof hides the hero when there is no receipt (after Delete all)', async () => {
  const s = createSandbox({ api: { getLatestReceipt: async () => null } });
  s.els.morningProofSection.style.display = '';
  await s.loadMorningProof();
  assert.equal(s.els.morningProofSection.style.display, 'none');
});

test('Fire 10 empty page: #proof-empty shows for a null latest receipt, never on a failed read', async () => {
  const none = createSandbox({ api: { getLatestReceipt: async () => null } });
  none.document.getElementById('proof-empty').hidden = true;
  await none.loadMorningProof();
  assert.equal(none.document.getElementById('proof-empty').hidden, false, "'No runs yet' for an empty ledger");
  assert.equal(none.document.getElementById('proof-page-meta').hidden, true, 'the page meta stays hidden at 0');
  assert.equal(none.document.getElementById('proof-page-meta').textContent, '');

  const failed = createSandbox({ api: { getLatestReceipt: async () => { throw new Error('disk'); } } });
  failed.document.getElementById('proof-empty').hidden = false;
  await failed.loadMorningProof();
  assert.equal(failed.document.getElementById('proof-empty').hidden, true, 'a failed read is not an empty ledger');

  const missing = createSandbox({ api: {} });
  await missing.loadMorningProof();
  assert.equal(missing.document.getElementById('proof-empty').hidden, true, 'no API (undefined) is not an empty ledger either');

  const some = createSandbox({ api: { getLatestReceipt: async () => ({ id: 'r_1_aaaaaa', result: 'cancelled', dryRun: true, action: 'shutdown', durationSeconds: 1500 }), getReceiptStats: async () => { throw new Error('x'); } } });
  some.document.getElementById('proof-empty').hidden = false;
  await some.loadMorningProof();
  assert.equal(some.document.getElementById('proof-empty').hidden, true, 'a receipt hides the empty state');
  assert.equal(some.document.getElementById('proof-page-meta').hidden, true, 'a failed count hides the page meta (never a fabricated 0)');
});

test('Fire 10 receiptRunSpan: known only for an honest countdown span', () => {
  const s = createSandbox();
  const span = r => JSON.parse(JSON.stringify(s.receiptRunSpan(r)));
  const cancelled = { result: 'cancelled', dryRun: true, durationSeconds: 1500, remainingSeconds: 1490, snoozeCount: 0 };
  assert.deepEqual(span(cancelled), { plannedSec: 1500, ranSec: 10, known: true });
  assert.equal(s.formatRunLength(10), '<1m');
  assert.equal(s.formatRunLength(1500), '25m');
  assert.equal(s.receiptRunDetail(cancelled), 'ran <1m of 25m');
  const done = { result: 'power_executed', dryRun: false, durationSeconds: 1500, remainingSeconds: 0, snoozeCount: 0 };
  assert.deepEqual(span(done), { plannedSec: 1500, ranSec: 1500, known: true });
  assert.equal(s.receiptRunDetail(done), '25m', 'a full run shows its length once');
  assert.equal(span({ ...done, result: 'dry_run_completed', dryRun: true }).known, true);
  // Not known: unfinished results, a missing remaining, and every snoozed run.
  for (const result of ['interrupted', 'running', 'completing', 'blocked', 'error', 'some_new_result', undefined]) {
    assert.equal(span({ ...cancelled, result }).known, false, `${result} is not a known span`);
  }
  assert.equal(span({ ...cancelled, remainingSeconds: null }).known, false);
  assert.equal(span({ ...cancelled, remainingSeconds: '1490' }).known, false, 'a string is not a number');
  assert.equal(span({ ...cancelled, remainingSeconds: -5 }).known, false, 'never clamp a negative to 0');
  const snoozed = { ...cancelled, snoozeCount: 1, remainingSeconds: 1700 };
  assert.equal(span(snoozed).known, false, 'a snooze raises remaining above the planned length');
  assert.equal(span({ ...done, snoozeCount: 2 }).known, false, 'a snoozed completion never claims exactly the planned length');
  assert.equal(s.receiptRunDetail({ ...cancelled, result: 'interrupted' }), '25m planned');
  // The formatter: h/m from an hour, '<1m' only for 1..59 s, '0m' only for 0.
  assert.equal(s.formatRunLength(0), '0m');
  assert.equal(s.formatRunLength(59), '<1m');
  assert.equal(s.formatRunLength(60), '1m');
  assert.equal(s.formatRunLength(5400), '1h 30m');
  assert.equal(s.formatRunLength(-1), '');
  assert.equal(s.formatRunLength(NaN), '');
});

test('Fire 10 hero: RAN <1m of 25m for a Test Mode run cancelled after 10 s; PLANNED otherwise', async () => {
  const s = createSandbox({ api: { getReceiptStats: async () => ({ total: 2 }) } });
  const receipt = { id: 'r_1759700000000_q1w2e3', startedAt: new Date(2026, 9, 6, 0, 16).toISOString(), endedAt: new Date(2026, 9, 6, 0, 16, 10).toISOString(), result: 'cancelled', dryRun: true, action: 'shutdown', durationSeconds: 1500, remainingSeconds: 1490, pauseCount: 0, snoozeCount: 0 };
  await s.renderMorningProof(receipt);
  const el = id => s.document.getElementById(id);
  assert.equal(el('ns-pill-duration-label').textContent, 'RAN');
  assert.equal(el('ns-pill-duration-val').textContent, '<1m');
  assert.equal(el('ns-pill-duration-of').textContent, 'of 25m');
  assert.equal(el('ns-pill-duration-of').hidden, false);
  assert.equal(el('ns-pill-duration-fill').style.width, '1%', 'the static track width comes from numbers only');
  assert.equal(el('ns-pill-duration').attrs['aria-label'], 'Countdown ran less than 1 minute of 25 minutes');
  assert.equal(el('ns-pill-duration').dataset.known, 'true');
  assert.equal(el('ns-pill-action-note').textContent, '', 'no pauses and no snoozes: no note');
  assert.equal(el('ns-pill-action-note').hidden, true);
  assert.equal(el('ns-proof-truth').textContent, 'TEST MODE · nothing ran', 'the truth mark is unchanged beside the ran value');
  assert.equal(el('proof-page-meta').textContent, '2 receipts · this PC');

  await s.renderMorningProof({ ...receipt, remainingSeconds: 0, result: 'dry_run_completed' });
  assert.equal(el('ns-pill-duration-label').textContent, 'RAN');
  assert.equal(el('ns-pill-duration-val').textContent, '25m');
  assert.equal(el('ns-pill-duration-of').hidden, true, 'no "of" line when it ran the whole plan');
  assert.equal(el('ns-pill-duration-fill').style.width, '100%');

  await s.renderMorningProof({ ...receipt, snoozeCount: 1, remainingSeconds: 1700 });
  assert.equal(el('ns-pill-duration-label').textContent, 'PLANNED');
  assert.equal(el('ns-pill-duration-val').textContent, '25m');
  assert.equal(el('ns-pill-duration-of').hidden, true);
  assert.equal(el('ns-pill-duration').dataset.known, 'false');
  assert.equal(el('ns-pill-action-note').textContent, '1 snooze');

  await s.renderMorningProof({ ...receipt, pauseCount: 3, snoozeCount: 2, remainingSeconds: 1800 });
  assert.equal(el('ns-pill-action-note').textContent, '3 pauses · 2 snoozes');
});

test('Fire 10 Routine: the streak line is muted until live; the live count is its own numeral node', async () => {
  const run = async streaks => {
    const s = createSandbox({ api: { listReceipts: async () => [], getStreaks: async () => { if (streaks instanceof Error) throw streaks; return streaks; } } });
    await s.renderNightStrip();
    return s.document.getElementById('routine-streak');
  };
  const empty = await run({ streak: 0, bestStreak: 0, totalNights: 0 });
  assert.equal(empty.dataset.state, 'empty');
  assert.equal(empty.textContent, "No real completions yet · Test Mode runs don't count");
  assert.equal(empty.children.length, 0, 'no numeral in the empty state');

  const broken = await run({ streak: 0, bestStreak: 5, totalNights: 9 });
  assert.equal(broken.dataset.state, 'broken');
  assert.equal(broken.textContent, 'Real streak · 0 nights · best 5');
  assert.equal(broken.children.length, 0, 'a zero never gets the big numeral');

  const live = await run({ streak: 2, bestStreak: 5, totalNights: 9 });
  assert.equal(live.dataset.state, 'live');
  assert.equal(live.textContent, 'Real streak · 2 nights · best 5');
  const num = live.children.find(c => typeof c === 'object');
  assert.ok(num && num.className === 'routine-streak-n' && num.textContent === '2', 'the current count is wrapped in b.routine-streak-n');

  const one = await run({ streak: 1, bestStreak: 1, totalNights: 1 });
  assert.equal(one.textContent, 'Real streak · 1 night · best 1');

  const failed = await run(new Error('x'));
  assert.equal(failed.textContent, '');
  assert.equal(failed.dataset.state, '', 'a failed read clears the state (no stale live)');
});

test('Fire 10 buildProofText: a complete receipt, the truth first, never a bare Completed for Test Mode', () => {
  const s = createSandbox({ state: { running: false, paused: false, clockFormat: '24h' } });
  const base = { id: 'r_1759700000000_q1w2e3', startedAt: new Date(2026, 9, 6, 0, 16).toISOString(), endedAt: new Date(2026, 9, 6, 0, 16, 10).toISOString(), action: 'shutdown', durationSeconds: 1500, pauseCount: 0, snoozeCount: 0, origin: 'phone', profileName: 'Weeknight', powerCommand: 'shutdown /s /t 0', notes: 'C:\\secret' };
  const cancelled = s.buildProofText({ ...base, result: 'cancelled', dryRun: true, remainingSeconds: 1490 });
  const lines = cancelled.split('\n');
  assert.equal(lines[0], 'Lights Out receipt R-q1w2e3');
  assert.equal(lines[1], 'TEST MODE · nothing ran', 'the truth line is the first fact');
  assert.equal(lines[2], 'Result: Run cancelled');
  assert.equal(lines[3], 'Action: Shutdown');
  assert.ok(lines.includes('Planned: 25m') && lines.includes('Ran: <1m'));
  assert.ok(lines.includes('Started: ' + new Date(base.startedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + ' 00:16'));
  assert.ok(lines.some(l => /^Ended: .* 00:16$/.test(l)));
  assert.ok(lines.includes('Profile: Weeknight') && lines.includes('Started from your phone'));
  assert.equal(lines.at(-1), 'Stored locally on this PC. No account, no cloud.');
  assert.ok(!/Pauses|Snoozes/.test(cancelled), 'zero pauses / snoozes are omitted');
  assert.ok(!/shutdown \/s|secret|Duration/.test(cancelled), 'no command, notes or "Duration"');
  assert.doesNotMatch(cancelled, /\bCompleted\b/);

  const dry = s.buildProofText({ ...base, result: 'dry_run_completed', dryRun: true, remainingSeconds: 0, snoozeCount: 1, pauseCount: 2, forceShutdown: true });
  assert.doesNotMatch(dry, /\bCompleted\b/, 'dry_run_completed never reads Completed');
  assert.match(dry, /^Result: Test run complete$/m);
  assert.match(dry, /TEST MODE · nothing ran/);
  assert.match(dry, /^Action: Shutdown \(forced\)$/m);
  assert.ok(!/^Ran:/m.test(dry), 'a snoozed run omits Ran');
  assert.match(dry, /^Pauses: 2$/m);
  assert.match(dry, /^Snoozes: 1$/m);

  const testCompleted = s.buildProofText({ ...base, result: 'completed', dryRun: true, remainingSeconds: 0 });
  assert.doesNotMatch(testCompleted, /\bCompleted\b|Run complete/, 'a Test Mode receipt with a completed result is still a test');
  assert.match(testCompleted, /TEST MODE · nothing ran/);

  const real = s.buildProofText({ ...base, result: 'power_executed', dryRun: false, remainingSeconds: 0, id: 'bad"id', startedAt: 'garbage', endedAt: null });
  assert.equal(real.split('\n')[0], 'Lights Out receipt', 'a malformed id is omitted');
  assert.match(real, /REAL ACTION · Shutdown command sent/);
  assert.ok(!/Invalid Date|Started:|Ended:/.test(real), 'invalid dates are omitted');
  const interrupted = s.buildProofText({ ...base, result: 'interrupted', dryRun: false });
  assert.ok(!/^Ran:/m.test(interrupted) && /^Planned: 25m$/m.test(interrupted), 'unknown spans print only Planned');
  assert.equal(s.buildProofText(null), '');
});

test('Fire 10 focusLedgerReceipt: scrolls to the row, outlines it for 900 ms, smooth only without reduced motion', () => {
  const make = reduce => createSandbox({ window: { matchMedia: () => ({ matches: reduce }) } });
  const s = make(false);
  const row = s.document.makeEl();
  row.dataset.receiptId = 'r_1_aaaaaa';
  const other = s.document.makeEl();
  other.dataset.receiptId = 'r_2_bbbbbb';
  s.els.receiptsList.rows = [other, row];
  assert.equal(s.focusLedgerReceipt('r_1_aaaaaa'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(row.scrolls)), [{ block: 'center', behavior: 'smooth' }]);
  assert.equal(row.classList.contains('is-focus'), true);
  assert.equal(other.classList.contains('is-focus'), false);
  assert.equal(s.timers.at(-1).ms, 900);
  s.timers.at(-1).fn();
  assert.equal(row.classList.contains('is-focus'), false, 'the outline is removed after 900 ms');
  assert.equal(s.focusLedgerReceipt('r_9_zzzzzz'), false, 'an id not in the list does nothing');
  assert.equal(s.focusLedgerReceipt('bad"id'), false, 'a malformed id does nothing');

  const r = make(true);
  const row2 = r.document.makeEl();
  row2.dataset.receiptId = 'r_1_aaaaaa';
  r.els.receiptsList.rows = [row2];
  r.focusLedgerReceipt('r_1_aaaaaa');
  assert.equal(row2.scrolls[0].behavior, 'auto', 'reduced motion jumps');
});

// Start from Proof and 'Plan tonight' (renderer.js): the real handlers, run
// in a sandbox with a fake navigation and start. A refused navigation starts
// nothing; 'Plan tonight' never starts anything.
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
function extractListener(id) {
  const head = `document.getElementById('${id}')?.addEventListener('click', `;
  const at = rendererSource.indexOf(head);
  if (at < 0) throw new Error(`listener ${id} not found`);
  let i = at + head.length;
  let depth = 1;
  for (; i < rendererSource.length && depth > 0; i++) {
    if (rendererSource[i] === '(') depth++;
    else if (rendererSource[i] === ')') depth--;
  }
  return rendererSource.slice(at, i) + ';';
}
async function runListener(id, navResult) {
  const calls = { nav: [], start: 0, focus: 0, startTimer: 0 };
  let handler = null;
  const playBtn = { focus() { calls.focus++; } };
  const context = vm.createContext({
    document: { getElementById: el => (el === id ? { addEventListener: (type, fn) => { handler = fn; } } : el === 'ns-play-btn' ? playBtn : null) },
    handleSidebarNavigation: async (tab, opts) => { calls.nav.push([tab, opts]); return navResult; },
    startTonightPlan: () => { calls.start++; return Promise.resolve(true); },
    startTimer: () => { calls.startTimer++; },
    els: { morningProofSection: { style: { display: '' } } }
  });
  vm.runInContext(extractListener(id), context);
  assert.equal(typeof handler, 'function');
  const ret = handler();
  assert.equal(ret, undefined, 'the click handler stays synchronous');
  for (let k = 0; k < 5; k++) await Promise.resolve();
  return { calls, context };
}

test('Fire 10 Start from Proof: lands on Tonight, then starts; a refused navigation starts nothing', async () => {
  const ok = await runListener('btn-proof-again', true);
  assert.deepEqual(JSON.parse(JSON.stringify(ok.calls.nav)), [['lib', { persist: false }]]);
  assert.equal(ok.calls.start, 1, 'starts through the shared startTonightPlan once Tonight is showing');
  assert.equal(ok.context.els.morningProofSection.style.display, '', 'no manual hero hide (render() owns it)');
  for (const refused of [false, undefined, 'yes']) {
    const no = await runListener('btn-proof-again', refused);
    assert.equal(no.calls.start, 0, `navigation result ${String(refused)} starts nothing`);
  }
});

test("Fire 10 'Plan tonight': opens Tonight and focuses Start; it never starts anything", async () => {
  const ok = await runListener('btn-proof-empty-plan', true);
  assert.equal(ok.calls.nav.length, 1);
  assert.equal(ok.calls.nav[0][0], 'lib');
  assert.equal(ok.calls.focus, 1);
  assert.equal(ok.calls.start + ok.calls.startTimer, 0);
  const no = await runListener('btn-proof-empty-plan', false);
  assert.equal(no.calls.focus, 0, 'a refused navigation focuses nothing');
  assert.equal(no.calls.start + no.calls.startTimer, 0);
});

test('Delete all: the first step only opens the confirm (Keep focused); only confirm deletes', async () => {
  let clears = 0;
  let listed = 0;
  const api = {
    getReceiptStats: async () => ({ total: 12 }),
    clearReceipts: async () => { clears++; return { cleared: true }; },
    listReceipts: async () => { listed++; return []; }
  };
  const s = createSandbox({ api });
  const confirmEl = s.document.getElementById('receipts-confirm');
  const actions = s.document.getElementById('receipts-actions');
  confirmEl.hidden = true;
  await s.openReceiptsClearConfirm();
  assert.equal(clears, 0, 'opening the confirm deletes nothing');
  assert.equal(confirmEl.hidden, false);
  assert.equal(actions.hidden, true);
  assert.equal(s.document.getElementById('receipts-confirm-q').textContent, 'Delete all 12 receipts from this PC?');
  assert.equal(s.document.active, s.document.getElementById('btn-clear-receipts-keep'), 'Keep is focused first');

  s.resetReceiptsClearConfirm({ restoreFocus: true });
  assert.equal(confirmEl.hidden, true);
  assert.equal(actions.hidden, false);
  assert.equal(s.document.active, s.els.btnClearReceipts);
  assert.equal(clears, 0);

  await s.openReceiptsClearConfirm();
  await s.confirmClearReceipts();
  assert.equal(clears, 1);
  assert.equal(listed, 1, 'the ledger re-renders from fresh data');
  assert.equal(confirmEl.hidden, true);
  assert.deepEqual(s.notes.at(-1), ['All receipts deleted from this PC', 'info']);
});

test('Delete all: a failed clear notifies and keeps the rows; a zero count opens nothing', async () => {
  let rendered = 0;
  const s = createSandbox({
    api: {
      getReceiptStats: async () => ({ total: 3 }),
      clearReceipts: async () => { throw new Error('disk'); },
      listReceipts: async () => { rendered++; return []; }
    }
  });
  s.els.receiptsList.innerHTML = '<div class="receipt-row">kept</div>';
  await s.openReceiptsClearConfirm();
  await s.confirmClearReceipts();
  assert.equal(rendered, 0, 'no re-render on failure');
  assert.equal(s.els.receiptsList.innerHTML, '<div class="receipt-row">kept</div>');
  assert.equal(s.notes.at(-1)[1], 'error');
  assert.equal(s.document.getElementById('btn-clear-receipts-confirm').disabled, false);

  const none = createSandbox({ api: { getReceiptStats: async () => ({ total: 0 }), clearReceipts: async () => { throw new Error('must not run'); } } });
  none.document.getElementById('receipts-confirm').hidden = true;
  await none.openReceiptsClearConfirm();
  assert.equal(none.document.getElementById('receipts-confirm').hidden, true);

  // A count that cannot be read is omitted, never guessed.
  const unknown = createSandbox({ api: { getReceiptStats: async () => { throw new Error('x'); } } });
  await unknown.openReceiptsClearConfirm();
  assert.equal(unknown.document.getElementById('receipts-confirm-q').textContent, 'Delete all receipts from this PC?');
});

test('the confirm button is disabled while the delete is in flight', async () => {
  let release;
  const s = createSandbox({
    api: {
      getReceiptStats: async () => ({ total: 2 }),
      clearReceipts: () => new Promise(r => { release = r; }),
      listReceipts: async () => []
    }
  });
  const btn = s.document.getElementById('btn-clear-receipts-confirm');
  const pending = s.confirmClearReceipts();
  assert.equal(btn.disabled, true);
  await s.confirmClearReceipts(); // a second press while in flight is ignored
  release({ cleared: true });
  await pending;
  assert.equal(btn.disabled, false);
});
