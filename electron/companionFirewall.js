'use strict';

const RULE_GROUP = 'Lights Out Companion';
const TCP_RULE = 'Lights Out Companion TCP';
const DISCOVERY_RULE = 'Lights Out Companion Discovery UDP';

function quotePowerShell(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid companion firewall port');
  return port;
}

function removeOwnedRulesCommand() {
  return `Get-NetFirewallRule -Group ${quotePowerShell(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop`;
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
    `New-NetFirewallRule -DisplayName ${quotePowerShell(TCP_RULE)} -Group ${group} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${safePort} -Program ${program} -Enabled True -Profile Private -ErrorAction Stop | Out-Null`,
    `New-NetFirewallRule -DisplayName ${quotePowerShell(DISCOVERY_RULE)} -Group ${group} -Direction Inbound -Action Allow -Protocol UDP -LocalPort 58733 -Program ${program} -Enabled True -Profile Private -ErrorAction Stop | Out-Null`,
    '} catch {',
    remove,
    'throw',
    '}'
  ].join('; ');
}

function snapshotOwnedRulesCommand() {
  const group = quotePowerShell(RULE_GROUP);
  return `$rules = Get-NetFirewallRule -Group ${group} -ErrorAction SilentlyContinue; @($rules | ForEach-Object { $port = $_ | Get-NetFirewallPortFilter; $app = $_ | Get-NetFirewallApplicationFilter; [pscustomobject]@{ DisplayName = $_.DisplayName; Group = $_.Group; Profile = [string]$_.Profile; Direction = [string]$_.Direction; Action = [string]$_.Action; Enabled = [string]$_.Enabled; Protocol = [string]$port.Protocol; LocalPort = [string]$port.LocalPort; Program = [string]$app.Program } }) | ConvertTo-Json -Compress`;
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
