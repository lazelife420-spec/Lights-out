'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const firewall = require('../companionFirewall');

test('firewall creation is private-only, program-scoped, and grouped as app-owned', () => {
  const command = firewall.configureOwnedRulesCommand("C:\\Program Files\\Lights Out\\Lights Out.exe", 58732);
  assert.match(command, /-Profile Private/);
  assert.doesNotMatch(command, /Public|Profile Any|-Program Any/i);
  assert.match(command, /-Program 'C:\\Program Files\\Lights Out\\Lights Out\.exe'/);
  assert.match(command, /-Group 'Lights Out Companion'/);
  assert.match(command, /-LocalPort 58732/);
});

test('firewall rollback and removal target only the app-owned group', () => {
  const remove = firewall.removeOwnedRulesCommand();
  assert.equal(remove, "Get-NetFirewallRule -Group 'Lights Out Companion' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop");
  const command = firewall.configureOwnedRulesCommand('C:\\Lights Out.exe', 60001);
  assert.equal(command.split(remove).length - 1, 2, 'transaction should remove owned rules before create and on failure');
  assert.doesNotMatch(command, /Get-NetFirewallRule -DisplayName/);
});

test('firewall command rejects unsafe ports and escapes executable paths', () => {
  assert.throws(() => firewall.configureOwnedRulesCommand('C:\\app.exe', 80));
  const command = firewall.configureOwnedRulesCommand("C:\\A'B\\app.exe", 58732);
  assert.match(command, /C:\\A''B\\app\.exe/);
});

test('firewall snapshot is limited to the app-owned group', () => {
  const command = firewall.snapshotOwnedRulesCommand();
  assert.match(command, /Get-NetFirewallRule -Group 'Lights Out Companion'/);
  assert.match(command, /Program/);
});
