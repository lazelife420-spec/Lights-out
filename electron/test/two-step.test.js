'use strict';

// UI-R3 Fire 08: one two-step machine for inline "press again to confirm".
// twoStepNext (renderer-utils.js) is pure; the My Modes manager's delete and
// overwrite use it instead of the native confirm() dialog. The real
// renderer-profiles.js bodies run in a vm sandbox whose api, notify and DOM
// are recording stubs: nothing is deleted or saved from this file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'renderer-utils.js'), 'utf8');
const profilesSource = fs.readFileSync(path.join(root, 'renderer-profiles.js'), 'utf8');

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

const box = {};
vm.createContext(box);
vm.runInContext(`${extractFunction(utilsSource, 'twoStepNext')} this.twoStepNext = twoStepNext;`, box);
const { twoStepNext } = box;

test('twoStepNext: the first press arms', () => {
  const r = twoStepNext(null, 'delete:a', 1000);
  assert.equal(r.decision, 'arm');
  assert.deepEqual({ ...r.pending }, { key: 'delete:a', at: 1000 });
});

test('twoStepNext: a second press on the same key within 4 s confirms and disarms', () => {
  const armed = twoStepNext(null, 'delete:a', 1000).pending;
  const r = twoStepNext(armed, 'delete:a', 4999);
  assert.equal(r.decision, 'confirm');
  assert.equal(r.pending, null);
  assert.equal(twoStepNext(armed, 'delete:a', 5000).decision, 'confirm', 'the window is inclusive');
});

test('twoStepNext: a different key re-arms on that key', () => {
  const armed = twoStepNext(null, 'delete:a', 1000).pending;
  const r = twoStepNext(armed, 'delete:b', 1500);
  assert.equal(r.decision, 'arm');
  assert.equal(r.pending.key, 'delete:b');
  assert.equal(twoStepNext(r.pending, 'delete:a', 1600).decision, 'arm', 'the first key is no longer armed');
});

test('twoStepNext: the window lapses, and a clock that went backwards never confirms', () => {
  const armed = twoStepNext(null, 'save:x', 1000).pending;
  const late = twoStepNext(armed, 'save:x', 5001);
  assert.equal(late.decision, 'arm');
  assert.equal(late.pending.at, 5001, 'a late press arms afresh');
  assert.equal(twoStepNext(armed, 'save:x', 999).decision, 'arm');
  assert.equal(twoStepNext(armed, 'save:x', 2000, 500).decision, 'arm', 'a custom window is honoured');
  assert.equal(twoStepNext({ key: 'save:x', at: NaN }, 'save:x', 1000).decision, 'arm');
});

// --- The manager's Delete ------------------------------------------------------

function fakeButton(profileId) {
  const classes = new Set(['profile-item-btn', 'delete-btn']);
  const attrs = {};
  const row = { dataset: { profileId } };
  return {
    textContent: 'Delete',
    classList: {
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      contains: c => classes.has(c)
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    closest: sel => (sel === '.profile-item' ? row : null),
    attrs
  };
}

function managerSandbox() {
  const calls = { deleteProfile: [], notify: [], timers: 0 };
  const buttons = [];
  const sandbox = {
    Date,
    twoStepNext,
    escapeHtml: s => String(s),
    setTimeout: () => { calls.timers++; return calls.timers; },
    clearTimeout: () => {},
    state: { profiles: [{ id: 'a', name: 'Hard Stop' }, { id: 'b', name: 'Movie Night' }], currentProfileId: null },
    els: { profilesList: { querySelectorAll: () => buttons.filter(b => b.classList.contains('is-confirming')) } },
    api: { deleteProfile: async id => { calls.deleteProfile.push(id); return { success: true }; } },
    notify: (m, t) => calls.notify.push({ m, t }),
    persistSelectedProfile: async () => {},
    loadProfiles: async () => {},
    renderProfiles: () => {},
    renderProfilesList: () => {}
  };
  vm.createContext(sandbox);
  const constLine = profilesSource.match(/const PROFILE_TWO_STEP_MS = [^\n]*;/)[0];
  vm.runInContext([
    constLine,
    'let profileDeletePending = null;',
    'let profileDeleteTimer = null;',
    extractFunction(profilesSource, 'profileNameFor'),
    extractFunction(profilesSource, 'setProfileDeleteArmed'),
    extractFunction(profilesSource, 'disarmProfileDelete'),
    extractFunction(profilesSource, 'requestProfileDelete'),
    extractFunction(profilesSource, 'deleteProfile'),
    'this.requestProfileDelete = requestProfileDelete; this.disarm = disarmProfileDelete;'
  ].join('\n'), sandbox);
  const button = id => { const b = fakeButton(id); buttons.push(b); return b; };
  return { calls, sandbox, button };
}

test('manager Delete: one click arms and deletes nothing', async () => {
  const m = managerSandbox();
  const btn = m.button('a');
  assert.equal(await m.sandbox.requestProfileDelete(btn, 'a'), false);
  assert.equal(m.calls.deleteProfile.length, 0, 'one click never deletes');
  assert.equal(btn.textContent, 'Delete?');
  assert.equal(btn.classList.contains('is-confirming'), true);
  assert.equal(btn.attrs['aria-label'], 'Confirm delete Hard Stop');
});

test('manager Delete: two clicks on the same row delete it exactly once', async () => {
  const m = managerSandbox();
  const btn = m.button('a');
  await m.sandbox.requestProfileDelete(btn, 'a');
  assert.equal(await m.sandbox.requestProfileDelete(btn, 'a'), true);
  assert.deepEqual([...m.calls.deleteProfile], ['a']);
  assert.equal(btn.textContent, 'Delete', 'the button is disarmed after the delete');
  await m.sandbox.requestProfileDelete(btn, 'a');
  assert.equal(m.calls.deleteProfile.length, 1, 'a third click only arms again');
});

test('manager Delete: arming another row, or disarming, never deletes the first', async () => {
  const m = managerSandbox();
  const a = m.button('a');
  const b = m.button('b');
  await m.sandbox.requestProfileDelete(a, 'a');
  await m.sandbox.requestProfileDelete(b, 'b');
  assert.equal(a.textContent, 'Delete', 'arming B disarms A');
  await m.sandbox.requestProfileDelete(a, 'a');
  assert.equal(m.calls.deleteProfile.length, 0);
  m.sandbox.disarm();
  await m.sandbox.requestProfileDelete(a, 'a');
  assert.equal(m.calls.deleteProfile.length, 0, 'Escape / blur / timeout (disarm) resets the machine');
});

test('no native confirm() is left in any renderer script', () => {
  for (const file of fs.readdirSync(root).filter(f => /^renderer.*\.js$/.test(f))) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(src, /(^|[^.\w])confirm\(/, `${file} calls confirm(`);
  }
});
