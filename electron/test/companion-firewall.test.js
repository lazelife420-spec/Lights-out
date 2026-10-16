'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const firewall = require('../companionFirewall');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

test('firewall creation is private-only, program-scoped, and grouped as app-owned', () => {
  const command = firewall.configureOwnedRulesCommand("C:\\Program Files\\Lights Out\\Lights Out.exe", 58732);
  assert.match(command, /-Profile Private/);
  assert.doesNotMatch(command, /Public|Profile Any|-Program Any/i);
  assert.match(command, /-Program 'C:\\Program Files\\Lights Out\\Lights Out\.exe'/);
  assert.match(command, /-Group 'Lights Out Companion'/);
  assert.match(command, /-LocalPort 58732/);
});

test('firewall rollback and removal target exact process-owned names within the app group', () => {
  const remove = firewall.removeOwnedRulesCommand();
  assert.match(remove, /Get-NetFirewallRule -Name @\('LightsOutCompanion-[^']+-TCP', 'LightsOutCompanion-[^']+-UDP'\)/);
  assert.match(remove, /Where-Object \{ \$_\.Group -eq 'Lights Out Companion' \}/);
  const command = firewall.configureOwnedRulesCommand('C:\\Lights Out.exe', 60001);
  assert.equal(command.split(remove).length - 1, 2, 'transaction should remove owned rules before create and on failure');
  assert.doesNotMatch(command, /Get-NetFirewallRule -DisplayName/);
});

test('real PowerShell pipelines preserve another instance and legacy rules during replace, rollback and removal', { skip: process.platform !== 'win32' }, () => {
  const secondModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'companionFirewall.js'), 'utf8'), {
    require, process, module: secondModule
  });
  const other = secondModule.exports;
  const executable = 'C:\\Lights Out\\Lights Out.exe';
  const script = `
    $script:rules = @{}
    $script:failUdp = $false
    function Get-NetFirewallRule {
      [CmdletBinding()] param([string[]]$Name)
      foreach ($key in $Name) { if ($script:rules.ContainsKey($key)) { $script:rules[$key] } }
    }
    function Remove-NetFirewallRule {
      [CmdletBinding()] param([Parameter(ValueFromPipeline=$true)]$InputObject)
      process { $script:rules.Remove($InputObject.Name) }
    }
    function New-NetFirewallRule {
      [CmdletBinding()] param($Name,$DisplayName,$Group,$Direction,$Action,$Protocol,$LocalPort,$Program,$Enabled,$Profile)
      if ($script:failUdp -and $Protocol -eq 'UDP') { throw 'Injected UDP creation failure' }
      $rule = [pscustomobject]@{Name=$Name;Group=$Group;Program=$Program;LocalPort=$LocalPort;Protocol=$Protocol}
      $script:rules[$Name] = $rule
      $rule
    }
    $script:rules['legacy'] = [pscustomobject]@{Name='legacy';Group='Lights Out Companion';Program='C:\\Original\\Lights Out.exe';LocalPort=58732;Protocol='TCP'}
    ${firewall.configureOwnedRulesCommand(executable, 60001)}
    ${other.configureOwnedRulesCommand(executable, 60002)}
    if ($script:rules.Count -ne 5) { throw 'Instances did not create separate rule pairs' }
    ${firewall.configureOwnedRulesCommand(executable, 60003)}
    if ($script:rules.Count -ne 5 -or @($script:rules.Values | Where-Object { $_.LocalPort -eq 60002 }).Count -ne 1) { throw 'Reconfigure removed the other instance' }
    $script:failUdp = $true
    try { ${firewall.configureOwnedRulesCommand(executable, 60004)} } catch { }
    if ($script:rules.Count -ne 3 -or -not $script:rules.ContainsKey('legacy')) { throw 'Rollback removed unowned rules' }
    $script:failUdp = $false
    ${firewall.removeOwnedRulesCommand()}
    if ($script:rules.Count -ne 3) { throw 'Removal touched the other instance' }
    ${other.removeOwnedRulesCommand()}
    if ($script:rules.Count -ne 1 -or -not $script:rules.ContainsKey('legacy')) { throw 'Legacy rule was removed' }
    'OWNERSHIP_PRESERVED'
  `;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 15000
  });
  assert.match(output, /OWNERSHIP_PRESERVED/);
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
