'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceCommit = process.env.RITUAL_OVERLAY_CONTRACT_COMMIT || null;

function readRepoFile(relativePath) {
  if (!sourceCommit) return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  return execFileSync('git', ['show', `${sourceCommit}:${relativePath.replaceAll('\\', '/')}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name)
  };
}

function createElement({ display = '' } = {}) {
  const attributes = new Map();
  return {
    style: { display },
    classList: createClassList(),
    textContent: '',
    innerHTML: '',
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name) ?? null
  };
}

function loadRitualLifecycle() {
  const els = {
    ritualOverlay: createElement({ display: 'none' }),
    ritualStepIcon: createElement(),
    ritualStepTitle: createElement(),
    ritualStepDesc: createElement(),
    ritualProgress: createElement(),
    btnRitualSkip: createElement(),
    btnRitualNext: createElement()
  };
  const context = vm.createContext({
    els,
    console,
    setTimeout,
    clearTimeout
  });
  const source = readRepoFile('electron/renderer-ritual-focus.js');
  vm.runInContext(`${source}\nthis.__ritualOverlayContract = { showRitualOverlay, updateRitualOverlay, hideRitualOverlay };`, context);
  return { els, ...context.__ritualOverlayContract, source };
}

function activeRitualState(overrides = {}) {
  return {
    active: true,
    currentStep: 0,
    totalSteps: 5,
    currentStepInfo: {
      id: 'breathe',
      label: 'Guided Breathing',
      skippable: true,
      auto: false
    },
    ...overrides
  };
}

test('showing a standard ritual establishes the visible active modal state', () => {
  const { els, showRitualOverlay } = loadRitualLifecycle();
  showRitualOverlay(activeRitualState());

  assert.equal(els.ritualOverlay.classList.contains('active'), true);
  assert.equal(els.ritualOverlay.style.display, '');
  assert.equal(els.ritualOverlay.getAttribute('aria-hidden'), 'false');
  assert.equal(els.ritualStepTitle.textContent, 'Guided Breathing');
});

test('main-process ritual step updates independently expose actionable controls', () => {
  const { els, updateRitualOverlay } = loadRitualLifecycle();
  updateRitualOverlay(activeRitualState({
    currentStep: 1,
    currentStepInfo: { id: 'block', label: 'Block Distractions', skippable: true, auto: true }
  }));

  assert.equal(els.ritualOverlay.classList.contains('active'), true);
  assert.equal(els.ritualOverlay.style.display, '');
  assert.equal(els.btnRitualSkip.style.display, '');
  assert.equal(els.btnRitualNext.textContent, 'Done');
});

test('hide, completion, and repeated reset remove every visible modal state', () => {
  const { els, showRitualOverlay, updateRitualOverlay, hideRitualOverlay } = loadRitualLifecycle();

  showRitualOverlay(activeRitualState());
  hideRitualOverlay();
  assert.equal(els.ritualOverlay.classList.contains('active'), false);
  assert.equal(els.ritualOverlay.style.display, 'none');
  assert.equal(els.ritualOverlay.getAttribute('aria-hidden'), 'true');

  showRitualOverlay(activeRitualState());
  updateRitualOverlay({ active: false, currentStepInfo: null, totalSteps: 5, currentStep: 5 });
  assert.equal(els.ritualOverlay.classList.contains('active'), false);
  assert.equal(els.ritualOverlay.style.display, 'none');
});

test('Escape follows supported ritual cancellation and the shared hide lifecycle', () => {
  const rendererSource = readRepoFile('electron/renderer.js');
  const branchStart = rendererSource.indexOf("else if (document.getElementById('ritual-overlay')?.classList.contains('active'))");
  const branchEnd = branchStart >= 0 ? rendererSource.indexOf('} else if', branchStart + 1) : -1;
  const escapeBranch = branchStart >= 0 && branchEnd > branchStart ? rendererSource.slice(branchStart, branchEnd) : '';

  assert.ok(escapeBranch.includes('hideRitualOverlay();'), 'ritual Escape branch must use the shared hide lifecycle');
  assert.match(escapeBranch, /await api\.ritualCancel\?\.\(\);/);
  assert.doesNotMatch(escapeBranch, /classList\.remove\('active'\)/);
});

test('standard Night Mode events converge on visibility without direct progression', () => {
  const rendererSource = readRepoFile('electron/renderer.js');
  const lifecycleSource = readRepoFile('electron/renderer-ritual-focus.js');

  assert.match(rendererSource, /onRitualStep\?\.\(\(data\) => \{[\s\S]*updateRitualOverlay\(data\.state\)/);
  assert.doesNotMatch(lifecycleSource, /ritualAdvance|electronAPI|ipcRenderer|shutdown\.exe|Stop-Computer/);
});

test('shutdown-labelled ritual state only changes overlay presentation', () => {
  const { els, updateRitualOverlay } = loadRitualLifecycle();
  updateRitualOverlay(activeRitualState({
    action: 'shutdown',
    dryRun: true,
    currentStepInfo: { id: 'timer', label: 'Start Wind-down Timer', skippable: false, auto: true }
  }));

  assert.equal(els.ritualOverlay.classList.contains('active'), true);
  assert.equal(els.btnRitualSkip.style.display, 'none');
  assert.equal(els.btnRitualNext.textContent, 'Done');
});
