'use strict';
// Settings › Back and Cancel leave Settings immediately and then reload the
// hidden form from saved values. Awaiting the reload first made Back lag
// (CI: past the packaged lane's 300 ms) and let a late close bounce a user who
// had already navigated away (installed layout proof: Night Modes -> Tonight).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');

function handlerBody(el) {
  const start = src.indexOf(`els.${el}.addEventListener('click', () => {`);
  if (start < 0) return null;
  const end = src.indexOf('\n  });', start);
  return src.slice(start, end);
}

for (const [name, el] of [['Back', 'modalClose'], ['Cancel', 'btnCancelOpt']]) {
  test(`Settings ${name} closes first, then discards unsaved edits without awaiting`, () => {
    const body = handlerBody(el);
    assert.ok(body, `${name} handler found`);
    const closeAt = body.indexOf('closeSettingsPanel()');
    const discardAt = body.indexOf('discardSettingsPanelChanges()');
    assert.ok(closeAt >= 0 && discardAt > closeAt, 'closes before reloading');
    assert.doesNotMatch(body, /await /, 'nothing delays leaving Settings');
  });
}
