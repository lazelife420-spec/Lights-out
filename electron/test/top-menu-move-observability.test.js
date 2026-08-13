'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  appendSequenced,
  composeMoveDiagnostics,
  decideFocusTraceInstallation
} = require('../scripts/top-menu-move-observability');

test('foreground chronology and move correlation survive diagnostic composition', () => {
  const foregroundChronology = [
    { name: 'before-set-foreground-window', elapsedMs: 1, windowHandle: 10 },
    { name: 'before-worker-response', elapsedMs: 2, windowHandle: 20 }
  ];
  const diagnostics = composeMoveDiagnostics({
    correlationId: 'move-1',
    selector: '#menu-settings .submenu',
    before: { settingsOpen: true },
    native: { foregroundChronology },
    after: { settingsOpen: false }
  });
  assert.equal(diagnostics.correlationId, 'move-1');
  assert.deepEqual(diagnostics.native.foregroundChronology, foregroundChronology);
});

test('native move worker retains all five required foreground chronology stages', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'native-input-worker.ps1'), 'utf8');
  for (const stage of [
    'before-set-foreground-window',
    'after-set-foreground-window',
    'before-set-cursor-pos',
    'after-set-cursor-pos',
    'before-worker-response'
  ]) {
    assert.match(source, new RegExp(`Sample-Foreground '${stage}'`));
  }
  assert.match(source, /foregroundChronology=\$foregroundChronology/);
});

test('post-move state and hit-test ancestry are retained before an assertion can inspect them', () => {
  const hitAncestry = [
    { tag: 'DIV', id: 'toggle-dryrun', classes: 'submenu-item toggle' },
    { tag: 'DIV', id: 'menu-settings', classes: 'menu-item open' }
  ];
  const diagnostics = composeMoveDiagnostics({
    correlationId: 'move-2',
    after: {
      settingsOpen: false,
      ariaExpanded: 'false',
      hit: { tag: 'DIV', id: 'toggle-dryrun', classes: 'submenu-item toggle' },
      hitAncestry
    }
  });
  assert.equal(diagnostics.after.settingsOpen, false);
  assert.equal(diagnostics.after.hit.id, 'toggle-dryrun');
  assert.deepEqual(diagnostics.after.hitAncestry, hitAncestry);
});

test('focus trace sequence ordering is deterministic and bounded', () => {
  const trace = [];
  appendSequenced(trace, { type: 'focus' }, 2);
  appendSequenced(trace, { type: 'blur' }, 2);
  appendSequenced(trace, { type: 'visibilitychange' }, 2);
  assert.deepEqual(trace.map(event => [event.sequence, event.type]), [
    [2, 'blur'],
    [3, 'visibilitychange']
  ]);
});

test('focus listener installation decision rejects duplicate installation', () => {
  assert.deepEqual(decideFocusTraceInstallation(false), { install: true, reason: 'first-install' });
  assert.deepEqual(decideFocusTraceInstallation(true), { install: false, reason: 'already-installed' });
});

test('live trace installs one dedicated listener for each focus-state event', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'desktop-ux-functional-gate.js'), 'utf8');
  assert.equal(source.match(/window\.addEventListener\('focus', addFocusState, true\)/g)?.length, 1);
  assert.equal(source.match(/window\.addEventListener\('blur', addFocusState, true\)/g)?.length, 1);
  assert.equal(source.match(/document\.addEventListener\('visibilitychange', addFocusState, true\)/g)?.length, 1);
});

test('pointer-transfer diagnostics are serialized before the unchanged assertion', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'desktop-ux-functional-gate.js'), 'utf8');
  const serializedAt = source.indexOf("results.mouse.push({ step: 'pointer-transfer-diagnostics'");
  const assertedAt = source.indexOf("'Settings menu remains open inside submenu'");
  assert.ok(serializedAt >= 0);
  assert.ok(assertedAt > serializedAt);
  assert.match(source, /await waitFor\(`document\.getElementById\('menu-settings'\)\.classList\.contains\('open'\)`, 'Settings menu remains open inside submenu'\)/);
});

test('browser events and focus trace retain the move correlation ID', () => {
  const diagnostics = composeMoveDiagnostics({
    correlationId: 'move-3',
    browserEvents: [{ type: 'pointermove', moveCorrelationId: 'move-3' }],
    focusTrace: [{ sequence: 1, type: 'blur', moveCorrelationId: 'move-3' }]
  });
  assert.equal(diagnostics.browserEvents[0].moveCorrelationId, diagnostics.correlationId);
  assert.equal(diagnostics.focusTrace[0].moveCorrelationId, diagnostics.correlationId);
});
