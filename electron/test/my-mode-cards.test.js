'use strict';

// UI-R3 Fire 08: My Mode cards are keyboard-reachable instruments, and a
// card click / Enter while idle loads the mode and lands on Tonight. The real
// applyProfile / bindProfileCard / onProfileCardActivate bodies
// (renderer-profiles.js) run in a vm sandbox with recording stubs: nothing is
// persisted, no timer runs, no page navigates for real.

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

function createSandbox({ state = {}, apiResult } = {}) {
  const calls = { nav: [], clearArmed: 0, startTimer: 0, notify: [] };
  const sandbox = {
    state: {
      settingsLoaded: true, dryRun: true, action: 'sleep', running: false, paused: false, clockMode: false,
      profiles: [{ id: 'p1', name: 'Hard Stop', action: 'shutdown', seconds: 2700 }], currentProfileId: null,
      lastLight: { enabled: false }, armedNightMode: null, ...state
    },
    api: {
      applyProfile: async () => (apiResult instanceof Error ? Promise.reject(apiResult)
        : apiResult || { success: true, profile: { id: 'p1', name: 'Hard Stop' }, timerOptions: { action: 'shutdown', durationSeconds: 2700, dryRun: true } })
    },
    notify: (m, t) => calls.notify.push({ m, t }),
    persistSelectedProfile: async () => {},
    renderProfiles: () => {},
    setInputFromSeconds: () => {},
    setAction: () => {},
    render: () => {},
    startTimer: () => { calls.startTimer++; },
    clearArmedNightMode: () => { calls.clearArmed++; sandbox.state.armedNightMode = null; },
    handleSidebarNavigation: tab => { calls.nav.push(tab); return Promise.resolve(true); },
    formatAction: a => ({ shutdown: 'Shutdown', sleep: 'Sleep' })[a] || a,
    formatDuration: s => `${Math.round(s / 60)} min`
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(profilesSource, 'shouldStartOnProfileSelection'),
    extractFunction(profilesSource, 'applyProfile'),
    extractFunction(profilesSource, 'onProfileCardActivate'),
    extractFunction(profilesSource, 'getProfileHint'),
    extractFunction(profilesSource, 'profileCardLabel'),
    extractFunction(profilesSource, 'bindProfileCard'),
    extractFunction(profilesSource, 'profileDurationText'),
    extractFunction(profilesSource, 'profileActionGlyphName'),
    'this.api2 = { applyProfile, onProfileCardActivate, bindProfileCard, profileDurationText, profileActionGlyphName };'
  ].join('\n'), sandbox);
  return { calls, state: sandbox.state, ...sandbox.api2 };
}

function fakeCard() {
  const listeners = {};
  const attrs = {};
  const card = {
    attrs,
    setAttribute: (k, v) => { attrs[k] = v; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire: (type, event) => listeners[type](event)
  };
  return card;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('card activation while idle loads the mode, clears an armed preset and lands on Tonight', async () => {
  const s = createSandbox({ state: { armedNightMode: { nightModeId: 'quick-sleep' } } });
  assert.equal(await s.onProfileCardActivate('p1'), true);
  assert.deepEqual([...s.calls.nav], ['lib']);
  assert.equal(s.calls.clearArmed, 1, 'Tonight never titles the plan with the old preset');
  assert.equal(s.calls.startTimer, 0, 'loading never starts a timer');
});

test('no navigation while running or paused, after a failed load, or without opts.navigate', async () => {
  for (const state of [{ running: true }, { paused: true, running: true }]) {
    const s = createSandbox({ state });
    await s.onProfileCardActivate('p1');
    assert.equal(s.calls.nav.length, 0, JSON.stringify(state));
  }
  const refused = createSandbox({ apiResult: { success: false, error: 'Preview mode' } });
  assert.equal(await refused.onProfileCardActivate('p1'), false);
  assert.equal(refused.calls.nav.length, 0, 'a failed load never navigates');
  const thrown = createSandbox({ apiResult: new Error('ipc down') });
  assert.equal(await thrown.onProfileCardActivate('p1'), false);
  assert.equal(thrown.calls.nav.length, 0);
  const unloaded = createSandbox({ state: { settingsLoaded: false } });
  assert.equal(await unloaded.onProfileCardActivate('p1'), false);
  assert.equal(unloaded.calls.nav.length, 0);
  const plain = createSandbox();
  await plain.applyProfile('p1');
  await plain.applyProfile('p1', { start: true });
  assert.equal(plain.calls.nav.length, 0, 'Ctrl+N, the manager Load and Load and start never navigate');
  assert.equal(plain.calls.clearArmed, 0);
});

test('Enter and Space on the card itself activate it once; repeats and inner targets do not', async () => {
  const s = createSandbox();
  const card = fakeCard();
  s.bindProfileCard(card, { id: 'p1', name: 'Hard Stop', action: 'shutdown', seconds: 2700 }, [{ text: 'Test' }], true);
  assert.equal(card.attrs['aria-pressed'], 'true');
  assert.equal(card.attrs['aria-label'], 'Hard Stop: Shutdown · 45 min, Test', 'the name, the hint and the truth chips');
  let prevented = 0;
  const key = (k, extra = {}) => ({ key: k, target: card, repeat: false, preventDefault() { prevented++; }, ...extra });
  card.fire('keydown', key('Enter'));
  await settle();
  card.fire('keydown', key(' '));
  await settle();
  assert.equal(prevented, 2, 'Space never scrolls the page');
  card.fire('keydown', key('Enter', { repeat: true }));
  card.fire('keydown', key('Enter', { target: {} }));
  card.fire('keydown', key('a'));
  await settle();
  assert.deepEqual([...s.calls.nav], ['lib', 'lib']);
  card.fire('click', {});
  await settle();
  assert.equal(s.calls.nav.length, 3, 'a click activates too');
});

test('the card duration speaks the Night Modes vocabulary; the badge is neutral by action', () => {
  const s = createSandbox();
  assert.equal(s.profileDurationText({ mode: 'duration', seconds: 900 }), '15 min');
  assert.equal(s.profileDurationText({ mode: 'clock', clock: '23:30' }), 'at 23:30');
  assert.deepEqual(['shutdown', 'restart', 'logout', 'hibernate', 'sleep', 'lock'].map(a => s.profileActionGlyphName(a)), ['power', 'power', 'power', 'power', 'moon', 'lamp']);
});
