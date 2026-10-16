'use strict';

// Firewall ownership: a Lights Out process may remove the app-owned
// "Lights Out Companion" rules only if it opened them itself.
//
// Before this guard, startRemoteControl() always called stopRemoteControl(),
// which always ran Remove-NetFirewallRule on the whole group -- so every
// launch and every quit, even with Phone Companion Off, executed a firewall
// change (elevated when the app runs elevated) and could delete rules a
// different Lights Out instance (installed app vs. dev build) had opened.
//
// The real configureFirewallRules()/stopRemoteControl() bodies run in a vm
// sandbox whose executePowerShell is a recording mock: no PowerShell and no
// firewall command can execute from this file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractFunction(source, name) {
  const headerMatch = source.match(new RegExp(`(?:async\\s+)?function ${name}\\s*\\(`));
  if (!headerMatch) throw new Error(`function ${name} not found in main.js`);
  const start = headerMatch.index;
  let i = start + headerMatch[0].length;
  let parenDepth = 1;
  while (parenDepth > 0 && i < source.length) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') parenDepth--;
    i++;
  }
  while (i < source.length && source[i] !== '{') i++;
  i++;
  let braceDepth = 1;
  while (braceDepth > 0 && i < source.length) {
    if (source[i] === '{') braceDepth++;
    else if (source[i] === '}') braceDepth--;
    i++;
  }
  return source.slice(start, i);
}

function createSandbox({ failRemoval = false } = {}) {
  const commands = [];
  const sandbox = {
    console: { warn: () => {}, log: () => {}, error: () => {} },
    process: { execPath: 'C:\\Lights Out\\Lights Out.exe' },
    companionFirewallState: null,
    companion: { PWA_PORT: 58732, stop: async () => {} },
    family: { stop: () => {} },
    normalizeCompanionPort: port => port || 58732,
    companionFirewall: {
      configureOwnedRulesCommand: () => 'OPEN-OWNED-RULES',
      removeOwnedRulesCommand: () => 'REMOVE-OWNED-RULES'
    },
    executePowerShell: async command => {
      commands.push(command);
      if (failRemoval && command === 'REMOVE-OWNED-RULES') throw new Error('Access is denied');
      return '';
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext([
    'let firewallRulesOpenedByThisProcess = false;',
    extractFunction(mainSource, 'configureFirewallRules'),
    extractFunction(mainSource, 'stopRemoteControl'),
    'this.__fw = { configureFirewallRules, stopRemoteControl, opened: () => firewallRulesOpenedByThisProcess };'
  ].join('\n'), context);
  return { commands, ...context.__fw };
}

test('a launch or quit with Phone Companion off runs no firewall command at all', async () => {
  const fw = createSandbox();
  await fw.stopRemoteControl(); // startRemoteControl() always stops first
  await fw.stopRemoteControl(); // app quit
  assert.deepEqual([...fw.commands], []);
});

test('a process removes only the rules it opened, exactly once', async () => {
  const fw = createSandbox();
  await fw.configureFirewallRules(true, 58732);
  assert.equal(fw.opened(), true);
  await fw.stopRemoteControl();
  await fw.stopRemoteControl();
  assert.deepEqual([...fw.commands], ['OPEN-OWNED-RULES', 'REMOVE-OWNED-RULES']);
  assert.equal(fw.opened(), false);
});

test('a failed removal keeps ownership so the next stop retries', async () => {
  const fw = createSandbox({ failRemoval: true });
  await fw.configureFirewallRules(true, 58732);
  await fw.stopRemoteControl();
  assert.equal(fw.opened(), true, 'rules may still exist, so ownership must be kept');
  await fw.stopRemoteControl();
  assert.deepEqual([...fw.commands], ['OPEN-OWNED-RULES', 'REMOVE-OWNED-RULES', 'REMOVE-OWNED-RULES']);
});

test('local ("This PC only") mode removes rules only when this process owns them', () => {
  const localBranch = mainSource.match(/\} else if \(mode === 'local'\) \{[\s\S]*?\n {2}\}/);
  assert.ok(localBranch, 'local-mode branch not found');
  assert.match(localBranch[0], /if \(firewallRulesOpenedByThisProcess\) await configureFirewallRules\(false\);/);
  assert.doesNotMatch(localBranch[0], /^\s*await configureFirewallRules\(false\);/m);
});
