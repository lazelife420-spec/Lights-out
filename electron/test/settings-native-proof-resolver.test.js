'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'scripts', 'settings-native-proof.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

test('settings-native-proof resolves the packaged executable through the shared resolver', () => {
  assert.ok(
    scriptSource.includes("require('./packaged-artifact-resolver')"),
    'settings-native-proof.js should require the shared packaged-artifact-resolver'
  );
  assert.doesNotMatch(
    scriptSource,
    /['"]dist['"]\s*,\s*['"]win-unpacked['"]/,
    'settings-native-proof.js should not hardcode the legacy dist/win-unpacked path'
  );
  assert.doesNotMatch(
    scriptSource,
    /dist[\\/]win-unpacked[\\/]Lights Out\.exe/,
    'settings-native-proof.js should not contain a literal legacy packaged executable path'
  );
});
