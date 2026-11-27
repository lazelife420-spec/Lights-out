'use strict';

const RULE_GROUP = 'Lights Out Companion';
const TCP_RULE = 'Lights Out Companion TCP';
const DISCOVERY_RULE = 'Lights Out Companion Discovery UDP';
const ownerPid = process.pid;
const ruleOwner = `${ownerPid}-${require('node:crypto').randomUUID()}`;
const tcpRuleName = `LightsOutCompanion-${ruleOwner}-TCP`;
const discoveryRuleName = `LightsOutCompanion-${ruleOwner}-UDP`;

// Exact shape of the per-process rule names above (randomUUID() is lowercase
// hex). Group 1 is the creating process id. .NET regex: case-sensitive, [0-9]
// rather than \d (which matches non-ASCII digits), \z rather than $ (which
// also matches before a trailing newline).
const OWNED_RULE_NAME_PATTERN = '^LightsOutCompanion-([1-9][0-9]{0,9})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?:TCP|UDP)\\z';
// Bounds for one stale-rule sweep; whatever is left is swept on the next configure.
const STALE_CLEANUP_MAX_REMOVALS = 256;
const STALE_CLEANUP_BUDGET_MS = 8000;

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

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

// Rule pairs leak whenever a process dies without a clean exit (routinely: the
// shutdown it triggers kills it). This sweep removes a rule only when ALL hold:
//   - its Group is exactly RULE_GROUP (case-sensitive) and its Name has the exact OWNED_RULE_NAME_PATTERN shape
//     (legacy names, other shapes and other groups are never candidates);
//   - it is not this process's own pair (that is handled by removeOwnedRulesCommand);
//   - its Program is exactly this executable (case-insensitive), so a QA/dev build
//     never touches the installed app's rules and vice versa (2026-10-05 class);
//   - its creating PID is not running, or is running a readable, different
//     executable (PID reuse).
// A live PID whose path cannot be read keeps its rule. Before any firewall query
// the sweep calibrates itself: Get-Process must report this process (ownerPid)
// running exactly this executable, and the full process list (taken after the
// rule list, so a rule seen there belongs to a process that existed by then)
// must contain it again. Any failure or inconsistency means "remove nothing";
// the sweep never blocks creating this process's pair.
// `limits` exists for tests; production uses the defaults.
function staleRulesCleanupCommand(executablePath, limits = {}) {
  if (typeof executablePath !== 'string' || !executablePath.trim()) return '';
  if (!Number.isInteger(ownerPid) || ownerPid < 1) return '';
  const maxRemovals = boundedInteger(limits.maxRemovals, STALE_CLEANUP_MAX_REMOVALS, 1, 1024);
  const budgetMs = boundedInteger(limits.budgetMs, STALE_CLEANUP_BUDGET_MS, 1, 60000);
  const program = quotePowerShell(executablePath);
  const group = quotePowerShell(RULE_GROUP);
  const own = `@(${quotePowerShell(tcpRuleName)}, ${quotePowerShell(discoveryRuleName)})`;
  const same = (a, b) => `[string]::Equals(${a}, ${b}, [StringComparison]::OrdinalIgnoreCase)`;
  return [
    'try {',
    '$loClock = [Diagnostics.Stopwatch]::StartNew()',
    `$loProgram = ${program}`,
    "$loSelfPath = ''",
    `foreach ($loProc in @(Get-Process -Id ${ownerPid} -ErrorAction SilentlyContinue)) { if ($null -ne $loProc -and [int]$loProc.Id -eq ${ownerPid}) { try { $loSelfPath = [string]$loProc.Path } catch { $loSelfPath = '' } } }`,
    `if ($loSelfPath.Length -gt 0 -and ${same('$loSelfPath', '$loProgram')}) {`,
    `$loOwn = ${own}`,
    `$loPattern = [regex]${quotePowerShell(OWNED_RULE_NAME_PATTERN)}`,
    '$loCandidates = @()',
    `foreach ($loRule in @(Get-NetFirewallRule -Group ${group} -ErrorAction SilentlyContinue)) {`,
    `if ($null -eq $loRule -or [string]$loRule.Group -cne ${group} -or $loOwn -contains [string]$loRule.Name) { continue }`,
    '$loMatch = $loPattern.Match([string]$loRule.Name)',
    'if (-not $loMatch.Success) { continue }',
    '$loNumber = [long]$loMatch.Groups[1].Value',
    'if ($loNumber -lt 1 -or $loNumber -gt [int]::MaxValue) { continue }',
    "$loCandidates += [pscustomobject]@{ Rule = $loRule; Name = [string]$loRule.Name; OwnerPid = [int]$loNumber; Program = '' }",
    '}',
    'if ($loCandidates.Count -gt 0) {',
    '$loNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)',
    'foreach ($loCand in $loCandidates) { [void]$loNames.Add($loCand.Name) }',
    '$loApps = @{}',
    'foreach ($loFilter in @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue)) { if ($null -ne $loFilter -and $loNames.Contains([string]$loFilter.InstanceID)) { $loApps[[string]$loFilter.InstanceID] = [string]$loFilter.Program } }',
    `$loMine = @(foreach ($loCand in $loCandidates) { $loRuleProgram = [string]$loApps[$loCand.Name]; if ($loRuleProgram.Length -gt 0 -and ${same('$loRuleProgram', '$loProgram')}) { $loCand.Program = $loRuleProgram; $loCand } })`,
    'if ($loMine.Count -gt 0) {',
    '$loProcs = @{}',
    'foreach ($loProc in @(Get-Process -ErrorAction Stop)) { if ($null -ne $loProc) { $loProcs[[int]$loProc.Id] = $loProc } }',
    "$loCheck = ''",
    `if ($loProcs.ContainsKey(${ownerPid})) { try { $loCheck = [string]$loProcs[${ownerPid}].Path } catch { $loCheck = '' } }`,
    `if ($loCheck.Length -gt 0 -and ${same('$loCheck', '$loProgram')}) {`,
    '$loStale = @()',
    'foreach ($loCand in $loMine) {',
    'if (-not $loProcs.ContainsKey($loCand.OwnerPid)) { $loStale += $loCand.Rule; continue }',
    "$loPath = ''",
    "try { $loPath = [string]$loProcs[$loCand.OwnerPid].Path } catch { $loPath = '' }",
    `if ($loPath.Length -gt 0 -and -not ${same('$loPath', '$loCand.Program')}) { $loStale += $loCand.Rule }`,
    '}',
    `foreach ($loRule in @($loStale | Select-Object -First ${maxRemovals})) {`,
    `if ($loClock.ElapsedMilliseconds -ge ${budgetMs}) { break }`,
    'try { $loRule | Remove-NetFirewallRule -ErrorAction Stop } catch { }',
    '}',
    '}',
    '}',
    '}',
    '}',
    '} catch { }'
  ].join('; ');
}

function configureOwnedRulesCommand(executablePath, port) {
  const safePort = validatePort(port);
  const program = quotePowerShell(executablePath);
  const group = quotePowerShell(RULE_GROUP);
  const remove = removeOwnedRulesCommand();
  const staleCleanup = staleRulesCleanupCommand(executablePath);
  return [
    "$ErrorActionPreference = 'Stop'",
    ...(staleCleanup ? [staleCleanup] : []),
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
  OWNED_RULE_NAME_PATTERN,
  STALE_CLEANUP_MAX_REMOVALS,
  STALE_CLEANUP_BUDGET_MS,
  quotePowerShell,
  removeOwnedRulesCommand,
  staleRulesCleanupCommand,
  configureOwnedRulesCommand,
  snapshotOwnedRulesCommand
};
