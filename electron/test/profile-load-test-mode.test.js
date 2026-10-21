'use strict';

// UI-R3 Fire 02: loading a My Mode can never switch Test Mode off. The real
// applyProfile() (renderer-profiles.js) runs in a vm sandbox whose api,
// notify, startTimer and render are recording stubs: nothing is persisted, no
// timer runs, no power action can execute from this file.

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

function createSandbox({ state = {}, profile = { id: 'p1', name: 'Hard Stop' }, timerOptions = {}, apiResult } = {}) {
  const calls = { api: [], notify: [], persist: [], renderProfiles: 0, setInput: [], setAction: [], startTimer: [], render: 0, saveSettings: 0 };
  const sandbox = {
    state: {
      settingsLoaded: true,
      dryRun: false,
      action: 'sleep',
      forceShutdown: false,
      muteSystem: false,
      graceMinutes: 2,
      running: false,
      paused: false,
      clockMode: false,
      profiles: [{ ...profile }],
      currentProfileId: null,
      lastLight: { enabled: false },
      ...state
    },
    api: {
      applyProfile: async id => {
        calls.api.push(id);
        if (apiResult instanceof Error) throw apiResult;
        return apiResult || { success: true, profile: { ...profile }, timerOptions: { action: 'shutdown', durationSeconds: 1800, gracePeriod: 2, ...timerOptions } };
      },
      saveAppSettings: async () => { calls.saveSettings++; }
    },
    notify: (message, type) => calls.notify.push({ message, type }),
    persistSelectedProfile: async id => { calls.persist.push(id); },
    renderProfiles: () => { calls.renderProfiles++; },
    setInputFromSeconds: s => calls.setInput.push(s),
    setAction: a => calls.setAction.push(a),
    startTimer: (...args) => calls.startTimer.push({ args, dryRun: sandbox.state.dryRun }),
    render: () => { calls.render++; }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    extractFunction(profilesSource, 'shouldStartOnProfileSelection'),
    extractFunction(profilesSource, 'applyProfile'),
    'this.applyProfile = applyProfile;'
  ].join('\n'), sandbox);
  return { calls, state: sandbox.state, applyProfile: sandbox.applyProfile };
}

test('Test Mode on + a REAL mode: Test Mode stays on, and the toast says why', async () => {
  const s = createSandbox({ state: { dryRun: true }, timerOptions: { dryRun: false } });
  const ok = await s.applyProfile('p1');
  assert.equal(ok, true);
  assert.equal(s.state.dryRun, true);
  assert.equal(s.calls.notify.at(-1).message, 'Hard Stop loaded in Test Mode. It runs for real only when Test Mode is off.');
  assert.ok(s.calls.render >= 1, 'render() runs so the footer and the Settings box follow at once');
  assert.equal(s.calls.saveSettings, 0, 'the app-wide setting is never persisted from a load');
});

test('Test Mode off + a mode saved in Test Mode turns Test Mode on', async () => {
  const s = createSandbox({ state: { dryRun: false }, timerOptions: { dryRun: true } });
  assert.equal(await s.applyProfile('p1'), true);
  assert.equal(s.state.dryRun, true);
  assert.equal(s.calls.notify.at(-1).message, 'Hard Stop loaded');
});

test('loading a 22-minute mode never hides the wall clock or changes an explicit face', async () => {
  for (const clockMode of [true, false]) {
    const s = createSandbox({ state: { clockMode, clockFace: 'analog' }, timerOptions: { durationSeconds: 1320 } });
    assert.equal(await s.applyProfile('p1'), true);
    assert.equal(s.state.clockMode, clockMode, 'legacy preference remains intact');
    assert.equal(s.state.clockFace, 'analog');
    assert.notEqual(s.state._clockDismissedByProfile, true);
    assert.equal(s.calls.startTimer.length, 0);
    assert.equal(s.calls.setInput.at(-1), 1320);
  }
});

test('Test Mode off + a REAL mode stays REAL (no change in behaviour)', async () => {
  const s = createSandbox({ state: { dryRun: false }, timerOptions: { dryRun: false } });
  assert.equal(await s.applyProfile('p1'), true);
  assert.equal(s.state.dryRun, false);
  assert.equal(s.calls.notify.at(-1).message, 'Hard Stop loaded');
});

test('a legacy mode without the dryRun field never turns Test Mode off', async () => {
  const s = createSandbox({ state: { dryRun: true }, timerOptions: {} });
  assert.equal(await s.applyProfile('p1'), true);
  assert.equal(s.state.dryRun, true);
  assert.match(s.calls.notify.at(-1).message, /loaded in Test Mode/);
});

test('settings not loaded yet: nothing is loaded and the api is never called', async () => {
  const s = createSandbox({ state: { settingsLoaded: false, dryRun: false }, timerOptions: { dryRun: false } });
  assert.equal(await s.applyProfile('p1'), false);
  assert.equal(s.calls.api.length, 0);
  assert.equal(s.calls.notify.at(-1).message, 'Loading your settings…');
  assert.equal(s.state.currentProfileId, null);
});

test('{ start: true } under Test Mode starts with Test Mode still on', async () => {
  const s = createSandbox({ state: { dryRun: true }, timerOptions: { dryRun: false } });
  assert.equal(await s.applyProfile('p1', { start: true }), true);
  assert.equal(s.calls.startTimer.length, 1);
  assert.equal(s.calls.startTimer[0].dryRun, true, 'the start sees Test Mode on');
  const plain = createSandbox({ state: { dryRun: true }, timerOptions: { dryRun: false } });
  await plain.applyProfile('p1');
  assert.equal(plain.calls.startTimer.length, 0, 'a load alone never starts');
});

test('return values: false on an api refusal and on a thrown error', async () => {
  const refused = createSandbox({ apiResult: { success: false, error: 'Profile not found' } });
  assert.equal(await refused.applyProfile('p1'), false);
  assert.equal(refused.calls.notify.at(-1).type, 'error');
  const thrown = createSandbox({ apiResult: new Error('ipc down') });
  assert.equal(await thrown.applyProfile('p1'), false);
  assert.match(thrown.calls.notify.at(-1).message, /ipc down/);
  assert.equal(thrown.state.dryRun, false, 'a failure changes nothing');
});
