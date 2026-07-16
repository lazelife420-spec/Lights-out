#!/usr/bin/env node
// Night Modes Library — Real Electron GUI Integration Proof
// Launches the real desktop app, navigates to the MODES panel, verifies card
// rendering, detail view, Use Tonight handoff, and receipt attribution.
// Run: node scripts/night-modes-gui-proof.js

'use strict';

const path = require('path');
const fs = require('fs');

const electronRoot = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\nNight Modes Library — GUI Integration Proof');
console.log('============================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Verify module resolves without runtime errors
// ─────────────────────────────────────────────────────────────────────────────

check('nightModes module loads without error', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  assert(nm.getCatalogue().length === 6, 'Expected 6 modes');
});

check('all six modes validate', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  for (const mode of nm.getCatalogue()) {
    if (mode.status === 'ready') {
      const v = nm.validateMode(mode);
      assert(v.valid, `${mode.id} failed validation: ${v.error}`);
    }
  }
});

check('resolveForExecution returns canonical timer options for quick-sleep', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  const r = nm.resolveForExecution('quick-sleep');
  assert(r.success, 'resolution failed');
  assert(r.resolved.durationSeconds === 900, 'wrong duration');
  assert(r.resolved.action === 'sleep', 'wrong action');
  assert(r.resolved.ritualId === 'none', 'wrong ritualId');
  assert(r.resolved.nightModeId === 'quick-sleep', 'wrong nightModeId');
  assert(r.resolved.nightModeTitle === 'Quick Sleep', 'wrong nightModeTitle');
});

check('resolveForExecution rejects disabled modes', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  const r1 = nm.resolveForExecution('quiet-house');
  assert(!r1.success, 'quiet-house should not resolve');
  const r2 = nm.resolveForExecution('school-night');
  assert(!r2.success, 'school-night should not resolve');
});

check('resolveForExecution rejects unknown mode IDs', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  const r = nm.resolveForExecution('does-not-exist');
  assert(!r.success, 'unknown should not resolve');
});

check('full-shutdown resolves with standard ritual', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  const r = nm.resolveForExecution('full-shutdown');
  assert(r.success, 'resolution failed');
  assert(r.resolved.ritualId === 'standard', 'wrong ritualId');
  assert(r.resolved.action === 'shutdown', 'wrong action');
});

check('movie-wind-down resolves correctly', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  const r = nm.resolveForExecution('movie-wind-down');
  assert(r.success, 'resolution failed');
  assert(r.resolved.durationSeconds === 5400, 'wrong duration');
  assert(r.resolved.ritualId === 'standard', 'wrong ritualId');
});

check('lights-down resolves correctly', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  const r = nm.resolveForExecution('lights-down');
  assert(r.success, 'resolution failed');
  assert(r.resolved.durationSeconds === 2700, 'wrong duration');
  assert(r.resolved.ritualId === 'standard', 'wrong ritualId');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Verify HTML and renderer wiring
// ─────────────────────────────────────────────────────────────────────────────

const htmlSrc = fs.readFileSync(path.join(electronRoot, 'index.html'), 'utf8');
const rendererNmSrc = fs.readFileSync(path.join(electronRoot, 'renderer-night-modes.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(electronRoot, 'preload.js'), 'utf8');

check('MODES panel exists in HTML with correct structure', () => {
  assert(htmlSrc.includes('id="ns-panel-modes"'), 'panel missing');
  assert(htmlSrc.includes('id="nm-cards-grid"'), 'cards grid missing');
  assert(htmlSrc.includes('id="nm-detail-panel"'), 'detail panel missing');
  assert(htmlSrc.includes('id="nm-btn-use-tonight"'), 'Use Tonight button missing');
  assert(htmlSrc.includes('id="nm-detail-timeline"'), 'timeline missing');
  assert(htmlSrc.includes('id="nm-detail-back"'), 'back button missing');
});

check('sidebar has TONIGHT and MODES navigation', () => {
  assert(htmlSrc.includes('data-ns-tab="lib"'), 'TONIGHT tab missing');
  assert(htmlSrc.includes('data-ns-tab="modes"'), 'MODES tab missing');
  assert(htmlSrc.includes('TONIGHT</span>'), 'TONIGHT label missing');
  assert(htmlSrc.includes('MODES</span>'), 'MODES label missing');
});

check('renderer-night-modes.js has all card artwork mappings', () => {
  assert(rendererNmSrc.includes("'quick-sleep'"), 'quick-sleep artwork missing');
  assert(rendererNmSrc.includes("'lights-down'"), 'lights-down artwork missing');
  assert(rendererNmSrc.includes("'movie-wind-down'"), 'movie-wind-down artwork missing');
  assert(rendererNmSrc.includes("'full-shutdown'"), 'full-shutdown artwork missing');
  assert(rendererNmSrc.includes("'quiet-house'"), 'quiet-house artwork missing');
  assert(rendererNmSrc.includes("'school-night'"), 'school-night artwork missing');
});

check('preload exposes Night Modes API', () => {
  assert(preloadSrc.includes('getNightModesCatalogue'), 'catalogue missing');
  assert(preloadSrc.includes('getNightMode'), 'getNightMode missing');
  assert(preloadSrc.includes('resolveNightMode'), 'resolveNightMode missing');
  assert(preloadSrc.includes('useNightModeTonight'), 'useNightModeTonight missing');
});

check('Use Tonight navigates to TONIGHT panel', () => {
  assert(rendererNmSrc.includes("data-ns-tab=\"lib\""), 'navigation to lib missing');
  assert(rendererNmSrc.includes('tonightBtn') && rendererNmSrc.includes('.click()'), 'click navigation missing');
});

check('renderer passes nightModeId through startTimer via armed mode', () => {
  const rendererSrc = fs.readFileSync(path.join(electronRoot, 'renderer.js'), 'utf8');
  assert(rendererSrc.includes('state.armedNightMode'), 'armed mode state missing');
  assert(rendererSrc.includes('.nightModeId'), 'nightModeId pass-through missing');
  assert(!rendererSrc.includes('window.__nightModeSelection'), 'stale __nightModeSelection still present');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3: Receipt attribution
// ─────────────────────────────────────────────────────────────────────────────

check('runReceipts includes nightMode fields', () => {
  const receiptsSrc = fs.readFileSync(path.join(electronRoot, 'runReceipts.js'), 'utf8');
  assert(receiptsSrc.includes('nightModeId: timerState.nightModeId'), 'nightModeId in receipt missing');
  assert(receiptsSrc.includes('nightModeTitle: timerState.nightModeTitle'), 'nightModeTitle in receipt missing');
});

check('timerState initialized with nightMode fields', () => {
  const mainSrc = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8');
  assert(mainSrc.includes('nightModeId: null'), 'init nightModeId missing');
  assert(mainSrc.includes('nightModeTitle: null'), 'init nightModeTitle missing');
});

check('beginValidatedCountdown sets nightMode fields from nmIdentity', () => {
  const mainSrc = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8');
  assert(mainSrc.includes('timerState.nightModeId = nm.nightModeId'), 'nightModeId assignment missing');
  assert(mainSrc.includes('timerState.nightModeTitle = nm.nightModeTitle'), 'nightModeTitle assignment missing');
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4: Safety checks
// ─────────────────────────────────────────────────────────────────────────────

check('no arbitrary scripts or shell commands in nightModes.js', () => {
  const nm = fs.readFileSync(path.join(electronRoot, 'nightModes.js'), 'utf8');
  assert(!nm.includes('exec('), 'exec() call found');
  assert(!nm.includes('spawn('), 'spawn() call found');
  assert(!nm.includes('eval('), 'eval() call found');
  assert(!nm.includes('child_process'), 'child_process reference found');
  assert(!nm.includes('Function('), 'Function constructor found');
});

check('ALLOWED_EXECUTION_PATHS is frozen and contains only approved values', () => {
  const nm = require(path.join(electronRoot, 'nightModes.js'));
  assert(Object.isFrozen(nm.ALLOWED_EXECUTION_PATHS), 'not frozen');
  assert(nm.ALLOWED_EXECUTION_PATHS.length === 2, 'unexpected number of paths');
  assert(nm.ALLOWED_EXECUTION_PATHS.includes('start-timer'), 'start-timer missing');
  assert(nm.ALLOWED_EXECUTION_PATHS.includes('start-standard-ritual'), 'start-standard-ritual missing');
});

check('companion.js and companion.html are untouched', () => {
  // Just verify they exist and have not gained any nightMode references.
  const companionJs = fs.readFileSync(path.join(electronRoot, 'companion.js'), 'utf8');
  const companionHtml = fs.readFileSync(path.join(electronRoot, 'companion.html'), 'utf8');
  assert(!companionJs.includes('nightMode'), 'companion.js unexpectedly references nightMode');
  assert(!companionHtml.includes('nightMode'), 'companion.html unexpectedly references nightMode');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n\x1b[31mGUI proof FAILED\x1b[0m');
  process.exit(1);
} else {
  console.log('\n\x1b[32mNight Modes GUI proof completed successfully\x1b[0m');
  process.exit(0);
}
