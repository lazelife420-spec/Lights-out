'use strict';

// M4 (2026-11-27 audit): quitting used to call stopRemoteControl() without
// waiting, and stopRemoteControl() only removes this process's firewall pair
// after the companion server has closed, so Electron exited first and the
// uniquely named pair leaked on every quit. The quit now holds for it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const quitStart = mainSource.indexOf("app.on('before-quit', (event) => {");
const handler = mainSource.slice(quitStart, mainSource.indexOf('\n});', quitStart));

test('before-quit holds the quit until this process\'s firewall pair is removed (bounded, once)', () => {
  assert.ok(quitStart > 0, 'the main before-quit handler exists');
  const hold = handler.indexOf('if (!quitFirewallCleanupAttempted && firewallRulesOpenedByThisProcess) {');
  assert.ok(hold > 0, 'a firewall cleanup hold exists');
  const block = handler.slice(hold, handler.indexOf('return;', hold));
  assert.match(block, /quitFirewallCleanupAttempted = true;/, 'attempted once');
  assert.match(block, /event\.preventDefault\(\);/, 'the quit is held');
  assert.match(block, /stopRemoteControl\(\)\.then\(/, 'the removal is awaited');
  assert.match(block, /setTimeout\(\(\) => resolve\(\{ success: false, timedOut: true \}\), QUIT_FIREWALL_CLEANUP_TIMEOUT_MS\)/, 'bounded');
  assert.match(block, /\.finally\(\(\) => app\.quit\(\)\)/, 'then quits for real');
  assert.ok(hold < handler.indexOf("writeTimerLifecycle('App quitting');"), 'before the final teardown');
  assert.match(mainSource, /const QUIT_FIREWALL_CLEANUP_TIMEOUT_MS = 8000;/);
});

test('stopRemoteControl removes the pair only when this process opened it', () => {
  const fn = mainSource.slice(mainSource.indexOf('async function stopRemoteControl()'), mainSource.indexOf('async function findCompanionPortOwner('));
  assert.match(fn, /if \(firewallRulesOpenedByThisProcess\) await configureFirewallRules\(false\);/);
});
