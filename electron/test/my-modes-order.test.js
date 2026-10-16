'use strict';

// UI-R3 Fire 02: Ctrl+1..9 loads the My Mode shown on that card (pinned
// first, as the grid shows them) and never starts a timer. The real
// getMyModesOrder / myModesShortcutLive / onMyModesShortcut bodies
// (renderer-profiles.js) run in a vm sandbox with a recording applyProfile.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const profilesSource = fs.readFileSync(path.join(__dirname, '..', 'renderer-profiles.js'), 'utf8');

function extractFunction(source, name) {
  const head = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!head) throw new Error(`function ${name} not found`);
  let i = head.index + head[0].length;
  let parens = 1;
  while (parens > 0 && i < source.length) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')') parens--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(head.index, i + 1);
}

const A = { id: 'a', name: 'A' };
const B = { id: 'b', name: 'B', pinned: true };
const C = { id: 'c', name: 'C' };

function createSandbox({ profiles = [A, B], running = false, paused = false, preview = false, managerOpen = false, blocked = false } = {}) {
  const calls = { apply: [], start: 0 };
  const sandbox = {
    state: { profiles: profiles.map(p => ({ ...p })), running, paused },
    previewMode: preview,
    els: { profilesModal: { classList: { contains: c => c === 'active' && managerOpen } } },
    timerShortcutSurfaceBlocked: () => blocked,
    applyProfile: (id, opts) => { calls.apply.push({ id, opts }); },
    startTimer: () => { calls.start++; }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(profilesSource, 'getMyModesOrder'),
    extractFunction(profilesSource, 'myModesShortcutLive'),
    extractFunction(profilesSource, 'onMyModesShortcut'),
    'this.api = { getMyModesOrder, onMyModesShortcut };'
  ].join('\n'), sandbox);
  return { ...sandbox.api, calls, state: sandbox.state };
}

function ctrl(key, target = { tagName: 'BODY', isContentEditable: false }, extra = {}) {
  const event = { key, ctrlKey: true, metaKey: false, altKey: false, target, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; }, ...extra };
  return event;
}

test('getMyModesOrder: pinned first, otherwise as saved; state.profiles keeps its order', () => {
  const s = createSandbox({ profiles: [A, B, C] });
  assert.deepEqual(Array.from(s.getMyModesOrder(), p => p.id), ['b', 'a', 'c']);
  assert.deepEqual(Array.from(s.state.profiles, p => p.id), ['a', 'b', 'c'], 'never mutates state.profiles');
  const s2 = createSandbox({ profiles: [A, B] });
  assert.equal(s2.getMyModesOrder()[0].id, 'b');
});

test('Ctrl+1 applies the first card (the pinned B) and Ctrl+2 the second (A); load only', () => {
  const s = createSandbox();
  const e1 = ctrl('1');
  s.onMyModesShortcut(e1);
  s.onMyModesShortcut(ctrl('2'));
  assert.deepEqual(s.calls.apply.map(c => c.id), ['b', 'a']);
  assert.ok(s.calls.apply.every(c => c.opts === undefined), 'never { start: true }');
  assert.equal(s.calls.start, 0);
  assert.equal(e1.defaultPrevented, true);
  s.onMyModesShortcut(ctrl('3'));
  assert.equal(s.calls.apply.length, 2, 'no card 3, nothing happens');
});

test('Ctrl+digit does nothing from a text field, while running or paused, in preview, behind the manager or a dialog', () => {
  const targets = [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }];
  for (const target of targets) {
    const s = createSandbox();
    const e = ctrl('1', target);
    s.onMyModesShortcut(e);
    assert.equal(s.calls.apply.length, 0, target.tagName);
    assert.equal(e.defaultPrevented, false);
  }
  for (const opts of [{ running: true }, { paused: true }, { preview: true }, { managerOpen: true }, { blocked: true }]) {
    const s = createSandbox(opts);
    s.onMyModesShortcut(ctrl('1'));
    assert.equal(s.calls.apply.length, 0, JSON.stringify(opts));
  }
});

test('only Ctrl+digit: Ctrl+Alt, Ctrl+Meta, a plain digit and Ctrl+0 are not My Modes shortcuts', () => {
  const s = createSandbox();
  s.onMyModesShortcut(ctrl('1', undefined, { altKey: true }));
  s.onMyModesShortcut(ctrl('1', undefined, { metaKey: true }));
  s.onMyModesShortcut(ctrl('1', undefined, { ctrlKey: false }));
  s.onMyModesShortcut(ctrl('0'));
  assert.equal(s.calls.apply.length, 0);
});
