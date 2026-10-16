'use strict';

// UI-R3 P05: dialog layers and the session announcer, as behaviour.
//
// 1) renderer-utils.js runs in a vm sandbox with a tiny fake DOM and a
//    recording MutationObserver: opening a dialog makes .cockpit (and only
//    .cockpit) inert and puts focus on the dialog TITLE (never an action);
//    closing the last layer removes inert and restores focus only when focus
//    was lost; a warning -> override hand-off keeps the page inert.
// 2) The real announce / announceSessionEvent bodies from renderer.js run
//    against a simulated 10-minute session: no per-second announcements,
//    minute marks only at 5 minutes and below, none while paused, and the
//    completion sentence never claims a power action ran.
//
// Nothing here launches Electron or touches the real app.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
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

// ---- A minimal DOM: just what the dialog-layer code touches. ---------------
function createDom() {
  const byId = new Map();
  const doc = { activeElement: null };

  function makeEl({ id = '', classes = [], display = '', parent = null, focusable = false } = {}) {
    const attrs = new Map();
    const classes_ = new Set(classes);
    const el = {
      id,
      parent,
      children: [],
      isConnected: true,
      disabled: false,
      style: { display },
      classList: {
        add: (...n) => { n.forEach(c => classes_.add(c)); },
        remove: (...n) => { n.forEach(c => classes_.delete(c)); },
        contains: c => classes_.has(c),
        toggle: (c, on) => { (on ?? !classes_.has(c)) ? classes_.add(c) : classes_.delete(c); }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      hasAttribute: k => attrs.has(k),
      removeAttribute: k => attrs.delete(k),
      contains(other) {
        for (let n = other; n; n = n.parent) if (n === el) return true;
        return false;
      },
      focus() { doc.activeElement = el; },
      checkVisibility() {
        for (let n = el; n; n = n.parent) {
          if (n.style.display === 'none') return false;
          if (n.classList.contains('modal') && !n.classList.contains('active') && n.style.display !== 'flex') return false;
          if (n.classList.contains('breathing-overlay') && !n.classList.contains('active')) return false;
        }
        return true;
      },
      getClientRects() { return el.checkVisibility() ? [{}] : []; },
      focusable
    };
    if (parent) parent.children.push(el);
    if (id) byId.set(id, el);
    return el;
  }

  const body = makeEl({ id: '__body' });
  const html = makeEl({ id: '__html' });
  doc.body = body;
  doc.documentElement = html;
  doc.activeElement = body;
  const cockpit = makeEl({ classes: ['cockpit'], parent: body });
  const startBtn = makeEl({ id: 'ns-play-btn', parent: cockpit, focusable: true });
  const notifBtn = makeEl({ id: 'btn-notif', parent: cockpit, focusable: true });

  function dialog(id, titleId, { modal = true } = {}) {
    const d = makeEl({ id, classes: modal ? ['modal'] : ['breathing-overlay'], parent: body });
    if (titleId) {
      d.setAttribute('aria-labelledby', titleId);
      const t = makeEl({ id: titleId, parent: d });
      t.setAttribute('tabindex', '-1');
    }
    return d;
  }
  const warning = dialog('warning-modal', 'warning-modal-title');
  makeEl({ id: 'warning-snooze', parent: warning, focusable: true });
  makeEl({ id: 'warning-cancel', parent: warning, focusable: true });
  makeEl({ id: 'warning-override', parent: warning, focusable: true });
  const override = dialog('override-modal', 'override-modal-title');
  makeEl({ id: 'btn-override-confirm', parent: override, focusable: true });
  dialog('snooze-tax-modal', 'snooze-tax-title');
  const ritual = dialog('ritual-overlay', 'ritual-step-title');
  ritual.style.display = 'none';
  const breathing = dialog('breathing-overlay', null, { modal: false });
  breathing.setAttribute('aria-label', 'Guided breathing');
  for (const [id, t] of [['profiles-modal', 'profiles-modal-title'], ['lan-warning-modal', 'lan-warning-title'], ['receipts-modal', 'receipts-modal-title'], ['about-modal', 'about-modal-title'], ['notif-drawer', 'notif-drawer-title'], ['streak-celebration-modal', 'streak-celebration-title']]) dialog(id, t);
  const announcer = makeEl({ id: 'session-announcer', parent: body });

  doc.getElementById = id => byId.get(id) || null;
  doc.querySelector = sel => (sel === '.cockpit' ? cockpit : null);
  return { doc, body, cockpit, startBtn, notifBtn, warning, override, ritual, breathing, announcer, byId };
}

function loadDialogLayers() {
  const dom = createDom();
  let observerCallback = null;
  const observed = [];
  class FakeMutationObserver {
    constructor(cb) { observerCallback = cb; }
    observe(el, opts) { observed.push({ el, opts }); }
  }
  const context = vm.createContext({
    document: dom.doc,
    MutationObserver: FakeMutationObserver,
    getComputedStyle: el => ({
      display: el.style.display === 'none' ? 'none'
        : (el.classList.contains('modal') && !el.classList.contains('active') && el.style.display === '') ? 'none' : 'flex'
    }),
    window: {},
    console
  });
  vm.runInContext(`${utilsSource}\nthis.__p05 = { syncDialogLayers, loDialogStack };`, context);
  // The real observer would fire after each attribute change; tests flush it.
  const flush = () => observerCallback([]);
  return { ...dom, flush, observed, api: context.__p05 };
}

test('the dialog-layer observer watches only class/style on every dialog container', () => {
  const { observed } = loadDialogLayers();
  const ids = observed.map(o => o.el.id).sort();
  assert.deepEqual(ids, ['about-modal', 'lan-warning-modal', 'notif-drawer', 'override-modal', 'profiles-modal', 'receipts-modal', 'ritual-overlay', 'snooze-tax-modal', 'streak-celebration-modal', 'warning-modal']);
  for (const o of observed) assert.deepEqual([...o.opts.attributeFilter].sort(), ['class', 'style']);
});

test('opening the heads-up dialog makes .cockpit inert and focuses its title, never an action', () => {
  const t = loadDialogLayers();
  t.startBtn.focus();
  t.warning.classList.add('active');
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), true, '.cockpit must be inert while a dialog is open');
  assert.equal(t.body.hasAttribute('inert'), false, 'only .cockpit is made inert');
  assert.equal(t.doc.activeElement.id, 'warning-modal-title', 'focus goes to the dialog title');
  for (const id of ['warning-snooze', 'warning-cancel', 'warning-override']) assert.notEqual(t.doc.activeElement.id, id);
  assert.equal(t.cockpit.contains(t.announcer), false, 'the session announcer sits outside the inert .cockpit');
});

test('closing the last layer removes inert and restores focus to the opener only when focus was lost', () => {
  const t = loadDialogLayers();
  t.startBtn.focus();
  t.warning.classList.add('active');
  t.flush();
  t.warning.classList.remove('active'); // Escape / Dismiss: the focused title is now hidden
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), false);
  assert.equal(t.doc.activeElement, t.startBtn, 'focus returns to the opener');

  // closeHelpPanel-style: the dialog's own code already restored focus.
  t.notifBtn.focus();
  t.byId.get('about-modal').classList.add('active');
  t.flush();
  t.byId.get('about-modal').classList.remove('active');
  const helpTarget = t.byId.get('btn-notif');
  t.startBtn.focus(); // the dialog's own restore picked a different, visible target
  t.flush();
  assert.equal(t.doc.activeElement, t.startBtn, 'a dialog that restores focus itself stays in charge');
  assert.notEqual(t.doc.activeElement, helpTarget);
});

test('warning -> override hand-off keeps the page inert and moves focus to the override title', () => {
  const t = loadDialogLayers();
  t.startBtn.focus();
  t.warning.classList.add('active');
  t.flush();
  t.byId.get('warning-override').focus();
  // setupWarningHandlers: hideWarningModal(); showOverrideModal(); in one task.
  t.warning.classList.remove('active');
  t.override.classList.add('active');
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), true);
  assert.equal(t.doc.activeElement.id, 'override-modal-title', 'never the destructive confirm control');
  t.override.classList.remove('active');
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), false);
  assert.equal(t.doc.activeElement, t.startBtn, 'focus returns to the original opener');
});

test('inline rituals handle focus; a removed guide is not a dialog layer', () => {
  const t = loadDialogLayers();
  t.startBtn.focus();
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), false, 'nothing is open at rest');
  t.ritual.style.display = '';
  t.ritual.classList.add('active');
  t.flush();
  assert.equal(t.doc.activeElement.id, 'ritual-step-title');
  t.breathing.classList.add('active');
  t.flush();
  assert.equal(t.doc.activeElement.id, 'ritual-step-title', 'the removed guide does not trap focus');
  t.breathing.classList.remove('active');
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), true, 'the ritual is still open below');
  assert.equal(t.doc.activeElement.id, 'ritual-step-title', 'focus falls back into the remaining layer');
  t.ritual.classList.remove('active');
  t.ritual.style.display = 'none';
  t.flush();
  assert.equal(t.cockpit.hasAttribute('inert'), false);
  assert.equal(t.doc.activeElement, t.startBtn);
});

// ---- Session announcer --------------------------------------------------------
function loadAnnouncer({ dryRun = true, action = 'shutdown' } = {}) {
  const announcer = { textContent: '' };
  const spoken = [];
  const state = { dryRun, action, running: false, paused: false, remainingSeconds: 0, totalSeconds: 0 };
  const context = vm.createContext({
    state,
    document: { getElementById: id => (id === 'session-announcer' ? announcer : null) },
    actionLabel: () => ({ shutdown: 'Shutdown', sleep: 'Sleep' }[state.action] || 'Shutdown'),
    setTimeout: fn => { fn(); spoken.push(announcer.textContent); },
    Date
  });
  const src = [
    'let lastAnnouncedMinute = null;',
    "let lastAnnouncement = { text: '', at: 0 };",
    extractFunction(rendererSource, 'spokenDuration'),
    extractFunction(rendererSource, 'announce'),
    extractFunction(rendererSource, 'announceSessionEvent'),
    'this.__announce = { announceSessionEvent };'
  ].join('\n');
  vm.runInContext(src, context);
  return { state, spoken, event: context.__announce.announceSessionEvent };
}

test('a running session is never announced per second: only start and the 5..1 minute marks', () => {
  const a = loadAnnouncer({ dryRun: true });
  Object.assign(a.state, { running: true, totalSeconds: 600, remainingSeconds: 600 });
  a.event({ type: 'started' });
  for (let r = 599; r >= 1; r--) {
    a.state.remainingSeconds = r;
    a.event({ type: 'tick' });
  }
  assert.deepEqual(a.spoken, [
    'Test Mode session started, 10 minutes, no power action',
    '5 minutes left, Test Mode',
    '4 minutes left, Test Mode',
    '3 minutes left, Test Mode',
    '2 minutes left, Test Mode',
    '1 minute left, Test Mode'
  ]);
});

test('nothing is announced while paused; a snooze re-arms the minute marks', () => {
  const a = loadAnnouncer({ dryRun: false, action: 'shutdown' });
  Object.assign(a.state, { running: true, totalSeconds: 360, remainingSeconds: 360 });
  a.event({ type: 'started' });
  assert.equal(a.spoken[0], 'REAL Shutdown session started, 6 minutes');
  a.state.remainingSeconds = 300;
  a.event({ type: 'tick' });
  assert.equal(a.spoken.at(-1), '5 minutes left');
  a.state.paused = true;
  a.event({ type: 'paused' });
  assert.equal(a.spoken.at(-1), 'REAL Shutdown session paused');
  const before = a.spoken.length;
  a.state.remainingSeconds = 240;
  a.event({ type: 'tick' });
  assert.equal(a.spoken.length, before, 'no minute mark while paused');
  a.state.paused = false;
  a.state.remainingSeconds = 540;
  a.event({ type: 'snoozed', addedSeconds: 300 });
  assert.equal(a.spoken.at(-1), 'Snoozed 5 minutes, 9 minutes left');
  a.state.remainingSeconds = 300;
  a.event({ type: 'tick' });
  assert.equal(a.spoken.at(-1), '5 minutes left', 'the 5-minute mark is spoken again after a snooze');
});

test('phase, cancel and completion sentences come from state and never claim a power action ran', () => {
  const real = loadAnnouncer({ dryRun: false, action: 'sleep' });
  Object.assign(real.state, { running: true, totalSeconds: 600, remainingSeconds: 120 });
  real.event({ type: 'phase', phase: 'dim' });
  real.event({ type: 'phase', phase: 'lastlight' });
  real.event({ type: 'complete' });
  assert.deepEqual(real.spoken, ['Winding Down, REAL Sleep at the end', 'Last Light, REAL Sleep at the end', 'Session complete']);
  const test_ = loadAnnouncer({ dryRun: true });
  test_.event({ type: 'complete' });
  test_.event({ type: 'cancelled' });
  assert.deepEqual(test_.spoken, ['Test Mode session complete', 'Session cancelled']);
  for (const s of [...real.spoken, ...test_.spoken]) assert.ok(!/shut down|went to sleep|powered off|\bran\b/i.test(s), `no past-tense power claim: ${s}`);
});

test("a local event and main's echo of it are spoken once", () => {
  const a = loadAnnouncer({ dryRun: true });
  Object.assign(a.state, { running: true, totalSeconds: 300, remainingSeconds: 300 });
  a.event({ type: 'cancelled' });
  a.event({ type: 'cancelled' });
  assert.equal(a.spoken.length, 1);
});
