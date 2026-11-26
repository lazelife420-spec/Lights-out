'use strict';

const RULE_GROUP = 'Lights Out Companion';
const TCP_RULE = 'Lights Out Companion TCP';
const DISCOVERY_RULE = 'Lights Out Companion Discovery UDP';
const ruleOwner = `${process.pid}-${require('node:crypto').randomUUID()}`;
const tcpRuleName = `LightsOutCompanion-${ruleOwner}-TCP`;
const discoveryRuleName = `LightsOutCompanion-${ruleOwner}-UDP`;

function quotePowerShell(value) {
  // PowerShell treats Unicode curly single quotes as string delimiters as well
  // as ASCII apostrophes, so double all of them inside single-quoted literals.
  return `'${String(value || '').replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`;
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid companion firewall port');
  return port;
}

function removeOwnedRulesCommand() {
  const names = `@(${quotePowerShell(tcpRuleName)}, ${quotePowerShell(discoveryRuleName)})`;
  return `Get-NetFirewallRule -Name ${names} -ErrorAction SilentlyContinue | Where-Object { $_.Group -eq ${quotePowerShell(RULE_GROUP)} } | Remove-NetFirewallRule -ErrorAction Stop`;
}

function configureOwnedRulesCommand(executablePath, port) {
  const safePort = validatePort(port);
  const program = quotePowerShell(executablePath);
  const group = quotePowerShell(RULE_GROUP);
  const remove = removeOwnedRulesCommand();
  return [
    "$ErrorActionPreference = 'Stop'",
    remove,
    'try {',
    `New-NetFirewallRule -Name ${quotePowerShell(tcpRuleName)} -DisplayName ${quotePowerShell(TCP_RULE)} -Group ${group} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${safePort} -Program ${program} -Enabled True -Profile Private -ErrorAction Stop | Out-Null`,
    `New-NetFirewallRule -Name ${quotePowerShell(discoveryRuleName)} -DisplayName ${quotePowerShell(DISCOVERY_RULE)} -Group ${group} -Direction Inbound -Action Allow -Protocol UDP -LocalPort 58733 -Program ${program} -Enabled True -Profile Private -ErrorAction Stop | Out-Null`,
    '} catch {',
    remove,
    'throw',
    '}'
  ].join('; ');
}

function snapshotOwnedRulesCommand() {
  const group = quotePowerShell(RULE_GROUP);
  // Bulk-load application and port filters once and join by unique rule Name (InstanceID)
  // so hosts with many existing rules stay well inside snapshot timeouts, and silence
  // progress streams so stderr stays free of CLIXML noise.
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    `$rules = @(Get-NetFirewallRule -Group ${group} -ErrorAction SilentlyContinue | Where-Object { $null -ne $_ })`,
    "if ($rules.Count -eq 0) { '[]' } else {",
    '$ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)',
    'foreach ($r in $rules) { if ($r.Name) { [void]$ids.Add([string]$r.Name) } }',
    '$apps = @{}',
    'foreach ($a in @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue)) { if ($null -ne $a -and $ids.Contains([string]$a.InstanceID)) { $apps[[string]$a.InstanceID] = $a.Program } }',
    '$ports = @{}',
    'foreach ($p in @(Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)) { if ($null -ne $p -and $ids.Contains([string]$p.InstanceID)) { $ports[[string]$p.InstanceID] = $p } }',
    '@($rules | ForEach-Object { $p = $ports[[string]$_.Name]; [pscustomobject]@{ Name = [string]$_.Name; DisplayName = $_.DisplayName; Group = $_.Group; Profile = [string]$_.Profile; Direction = [string]$_.Direction; Action = [string]$_.Action; Enabled = [string]$_.Enabled; Protocol = [string]$p.Protocol; LocalPort = ($p.LocalPort -join \',\'); Program = [string]$apps[[string]$_.Name] } }) | ConvertTo-Json -Compress',
    '}'
  ].join('; ');
}

module.exports = {
  RULE_GROUP,
  TCP_RULE,
  DISCOVERY_RULE,
  quotePowerShell,
  removeOwnedRulesCommand,
  configureOwnedRulesCommand,
  snapshotOwnedRulesCommand
};
