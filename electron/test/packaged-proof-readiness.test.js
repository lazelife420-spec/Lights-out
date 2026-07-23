'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertOwnedEndpoint,
  exerciseMenuContract,
  waitForAuthoritativeReadiness
} = require('../scripts/packaged-proof-readiness');

const ready = generation => ({
  generation,
  documentReadyState: 'complete',
  proofExists: true,
  proofReady: true,
  menusReady: true,
  openModal: null
});

test('packaged proof waits through delayed renderer initialization', async () => {
  const states = [
    { ...ready('a'), proofReady: false, menusReady: false },
    { ...ready('a'), menusReady: false },
    ready('a'),
    ready('a')
  ];
  const result = await waitForAuthoritativeReadiness(
    async () => states.shift() || ready('a'),
    { intervalMs: 0, sleep: async () => {} }
  );
  assert.equal(result.generation, 'a');
});

test('packaged proof rejects stale generation and confirms the replacement', async () => {
  const states = [
    ready('old'),
    { ...ready('new'), proofReady: false },
    ready('new'),
    ready('new')
  ];
  const result = await waitForAuthoritativeReadiness(
    async () => states.shift() || ready('new'),
    { intervalMs: 0, sleep: async () => {} }
  );
  assert.equal(result.generation, 'new');
});

test('packaged proof cannot attach to the wrong CDP listener process', () => {
  assert.throws(() => assertOwnedEndpoint({
    spawnedPid: 100,
    listeningPid: 200,
    expectedExecutable: 'C:\\app\\Lights Out.exe',
    actualExecutable: 'C:\\app\\Lights Out.exe',
    expectedUserData: 'C:\\temp\\profile',
    commandLine: '"C:\\app\\Lights Out.exe" --user-data-dir=C:\\temp\\profile'
  }), /different process/);
});

test('menu interaction starts only after readiness and proves open, pointer, Escape, and focus', async () => {
  const actions = [];
  let state = {
    connected: true,
    visible: true,
    enabled: true,
    ariaExpanded: 'false',
    open: false,
    menuVisible: false,
    focusedId: null
  };
  const result = await exerciseMenuContract({
    menuId: 'menu-power',
    readReadiness: async () => {
      actions.push('ready');
      return { menusReady: true };
    },
    readMenu: async () => ({ ...state }),
    clickTrigger: async () => {
      actions.push('click');
      state = { ...state, ariaExpanded: 'true', open: true, menuVisible: true, focusedId: 'first-item' };
    },
    moveToFirstItem: async () => actions.push('move'),
    pressEscape: async () => {
      actions.push('escape');
      state = { ...state, ariaExpanded: 'false', open: false, menuVisible: false, focusedId: 'menu-power' };
    },
    full: true
  });
  assert.deepEqual(actions, ['ready', 'click', 'move', 'escape']);
  assert.equal(result.opened.open, true);
  assert.equal(result.pointerTransfer.open, true);
  assert.equal(result.closed.focusedId, 'menu-power');
});

test('handled menu keys do not invoke timer shortcuts and cleanup runs', async () => {
  let timerStarts = 0;
  let cleanup = 0;
  let state = {
    connected: true,
    visible: true,
    enabled: true,
    ariaExpanded: 'false',
    open: false,
    menuVisible: false,
    focusedId: null
  };
  try {
    await exerciseMenuContract({
      menuId: 'menu-help',
      readReadiness: async () => ({ menusReady: true }),
      readMenu: async () => ({ ...state }),
      clickTrigger: async () => {
        state = { ...state, ariaExpanded: 'true', open: true, menuVisible: true };
      },
      moveToFirstItem: async () => {},
      pressEscape: async () => {
        state = { ...state, ariaExpanded: 'false', open: false, menuVisible: false, focusedId: 'menu-help' };
      }
    });
  } finally {
    cleanup += 1;
  }
  assert.equal(timerStarts, 0);
  assert.equal(cleanup, 1);
});
