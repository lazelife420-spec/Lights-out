'use strict';
// Settings › Cancel reloads saved settings asynchronously. Closing the panel
// after that reload must not bounce a user who already moved to another page
// back to the pre-Settings tab (caught by the installed layout proof: Night
// Modes snapped back to Tonight at 900x640).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Settings Cancel closes the panel only while Settings is still the visible view', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
  const handler = src.match(/els\.btnCancelOpt\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(handler, 'Cancel handler found');
  const body = handler[1];
  const discardAt = body.indexOf('await discardSettingsPanelChanges()');
  const guardAt = body.indexOf("document.body?.dataset.view === 'set'");
  assert.ok(discardAt >= 0 && guardAt > discardAt, 'guard is checked after the async reload');
  assert.match(body, /if \(document\.body\?\.dataset\.view === 'set'\) closeSettingsPanel\(\);/);
  assert.match(src, /document\.body\.dataset\.view = panel;/, 'applyMainPanelVisibility records the visible view');
});
