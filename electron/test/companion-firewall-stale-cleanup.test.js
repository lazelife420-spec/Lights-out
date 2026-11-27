'use strict';

// Stale per-process firewall rule cleanup (companionFirewall.js).
//
// Every app process creates LightsOutCompanion-<pid>-<uuid>-(TCP|UDP) in the
// "Lights Out Companion" group and removes only its own pair on a clean exit.
// The shutdown the app triggers routinely kills it, so pairs leak. Configuring
// rules now first sweeps stale pairs, and must never remove a pair whose PID is
// a live process running that rule's program (2026-10-05 incident class).
//
// SAFETY: no real firewall cmdlet can run from this file.
//   - Parse tests hand the generated text to the PowerShell *parser* only
//     (via an environment variable, never executed).
//   - The behavior harness explicitly imports only Microsoft.PowerShell.Utility,
//     then disables module autoloading, so the NetSecurity module (the real
//     firewall cmdlets) cannot load. It verifies that every firewall/process
//     command resolves to a marker-tagged mock defined in the harness, and that
//     NetSecurity is still not loaded afterwards; otherwise it throws before or
//     after running anything.
//   - Get-Process is mocked too, so the PIDs and paths are entirely fake.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const firewall = require('../companionFirewall');

const isWindows = process.platform === 'win32';
const EXE = 'C:\\Program Files\\Lights Out\\Lights Out.exe';
const QA_EXE = 'C:\\QA\\dist-native-rc\\win-unpacked\\Lights Out.exe';
const GROUP = firewall.RULE_GROUP;
const OWNER_PID = process.pid;

const ownNames = (() => {
  const names = firewall.removeOwnedRulesCommand().match(/'(LightsOutCompanion-[^']+)'/g).map(value => value.slice(1, -1));
  assert.equal(names.length, 2);
  return { tcp: names.find(name => name.endsWith('-TCP')), udp: names.find(name => name.endsWith('-UDP')) };
})();

let nextFakePid = 1999990000;
function fakePid() {
  nextFakePid += 4;
  assert.notEqual(nextFakePid, OWNER_PID);
  return nextFakePid;
}
function ruleName(pid, protocol = 'TCP', uuid = crypto.randomUUID()) {
  return `LightsOutCompanion-${pid}-${uuid}-${protocol}`;
}
function pair(pid, program, group = GROUP) {
  const uuid = crypto.randomUUID();
  return [
    { Name: ruleName(pid, 'TCP', uuid), Group: group, Program: program },
    { Name: ruleName(pid, 'UDP', uuid), Group: group, Program: program }
  ];
}
const list = value => (value == null ? [] : Array.isArray(value) ? value : [value]);
const sorted = values => list(values).slice().sort();

// ---------------------------------------------------------------------------
// PowerShell helpers (parse-only, and mocked evaluation)
// ---------------------------------------------------------------------------

function runPowerShell(script, env = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...process.env, ...env }
  });
}

const PARSE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
# Targets arrive as UTF-16 environment variables; return results as UTF-8 so
# non-ASCII paths survive the trip back to Node unchanged.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ids = $env:LO_PARSE_IDS | ConvertFrom-Json
$out = for ($index = 0; $index -lt @($ids).Count; $index++) {
  $t = [pscustomobject]@{ id = @($ids)[$index]; text = [Environment]::GetEnvironmentVariable('LO_PARSE_' + $index) }
  if ($null -eq $t.text) { throw ('missing parse target ' + $index) }
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput([string]$t.text, [ref]$tokens, [ref]$errors)
  $commands = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $name = $_.GetCommandName(); if ($null -eq $name) { '<dynamic>' } else { $name } })
  $programs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object {
    $els = $_.CommandElements
    for ($i = 0; $i -lt $els.Count - 1; $i++) { if ($els[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and $els[$i].ParameterName -eq 'Program') { $els[$i + 1].Value } }
  })
  $assigned = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$loProgram' }, $true) | ForEach-Object { $_.Right.Expression.Value })
  [pscustomobject]@{ id = $t.id; errors = @($errors | ForEach-Object { $_.Message }); commands = $commands; programs = $programs; assigned = $assigned }
}
ConvertTo-Json -InputObject @($out) -Depth 5 -Compress
`;

// One environment variable per target: Windows caps each variable at 32,767 chars.
function parseWithPowerShell(targets) {
  const env = { LO_PARSE_IDS: JSON.stringify(targets.map(target => target.id)) };
  targets.forEach((target, index) => {
    assert.ok(target.text.length < 32000, `${target.id} is too long for one environment variable`);
    env[`LO_PARSE_${index}`] = target.text;
  });
  const output = runPowerShell(PARSE_SCRIPT, env);
  return list(JSON.parse(output.trim()));
}

// Each scenario: rules [{Name, Group, Program, NoApp}], bulk {count, program},
// procs [{Id, Path, PathMode: ok|null|throw}] used for `Get-Process -Id`, and
// fullProcs (defaults to procs) used for the full `Get-Process` list; failure
// switches idProcThrow, fullProcThrow, appFilterThrow, groupQueryThrow;
// removeFail [names]; removeDelayMs; runs (how many times to run the command).
const HARNESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility
$PSModuleAutoLoadingPreference = 'None'
if (Get-Module -Name NetSecurity) { throw 'UNSAFE: NetSecurity module is loaded before the harness ran' }

function New-FakeProcess($spec) {
  $o = [pscustomobject]@{ Id = [int]$spec.Id }
  if ($spec.PathMode -eq 'throw') { $o | Add-Member -MemberType ScriptProperty -Name Path -Value { throw 'Access is denied' } }
  elseif ($spec.PathMode -eq 'null') { $o | Add-Member -MemberType NoteProperty -Name Path -Value $null }
  else { $o | Add-Member -MemberType NoteProperty -Name Path -Value ([string]$spec.Path) }
  $o
}

function Get-NetFirewallRule {
  [CmdletBinding()] param([string[]]$Name, [string]$Group)
  # LIGHTS-OUT-TEST-MOCK
  if ($PSBoundParameters.ContainsKey('Group')) {
    $script:groupQueries++
    if ($script:s.groupQueryThrow) { throw 'Injected group query failure' }
    @($script:rules.Values) | Where-Object { $_.Group -eq $Group }
  } elseif ($PSBoundParameters.ContainsKey('Name')) {
    foreach ($key in $Name) { if ($script:rules.Contains($key)) { $script:rules[$key] } }
  } else { throw 'Unscoped Get-NetFirewallRule' }
}
function Get-NetFirewallApplicationFilter {
  [CmdletBinding()] param()
  # LIGHTS-OUT-TEST-MOCK
  if ($script:s.appFilterThrow) { throw 'Injected application filter failure' }
  [pscustomobject]@{ InstanceID = '{00000000-unrelated}'; Program = 'C:\Other\app.exe' }
  foreach ($r in @($script:rules.Values)) { if (-not $r.NoApp) { [pscustomobject]@{ InstanceID = $r.Name; Program = $r.Program } } }
}
function Get-Process {
  [CmdletBinding()] param([int[]]$Id)
  # LIGHTS-OUT-TEST-MOCK
  if ($PSBoundParameters.ContainsKey('Id')) {
    if ($script:s.idProcThrow) { throw 'Injected Get-Process -Id failure' }
    foreach ($p in $script:idProcs) { if ($Id -contains $p.Id) { $p } }
  } else {
    if ($script:s.fullProcThrow) { throw 'Injected Get-Process failure' }
    $script:fullProcs
  }
}
function Remove-NetFirewallRule {
  [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    # LIGHTS-OUT-TEST-MOCK
    $script:attempted.Add([string]$InputObject.Name)
    if ($script:s.removeDelayMs) { Start-Sleep -Milliseconds ([int]$script:s.removeDelayMs) }
    if (@($script:s.removeFail) -contains $InputObject.Name) { throw 'Injected removal failure' }
    if (-not $script:rules.Contains([string]$InputObject.Name)) { throw 'No such rule' }
    $script:rules.Remove([string]$InputObject.Name)
    $script:removed.Add([string]$InputObject.Name)
  }
}
function New-NetFirewallRule {
  [CmdletBinding()] param($Name, $DisplayName, $Group, $Direction, $Action, $Protocol, $LocalPort, $Program, $Enabled, $Profile)
  # LIGHTS-OUT-TEST-MOCK
  $rule = [pscustomobject]@{ Name = [string]$Name; Group = [string]$Group; Program = [string]$Program; NoApp = $false; Profile = [string]$Profile; LocalPort = $LocalPort }
  $script:rules[[string]$Name] = $rule
  $script:created.Add([string]$Name)
  $rule
}

foreach ($n in 'Get-NetFirewallRule', 'Get-NetFirewallApplicationFilter', 'Get-Process', 'Remove-NetFirewallRule', 'New-NetFirewallRule') {
  $cmd = Get-Command -Name $n -ErrorAction Stop
  if ($cmd.CommandType -ne 'Function' -or -not [string]::IsNullOrEmpty($cmd.ModuleName) -or $cmd.ScriptBlock.ToString() -notmatch 'LIGHTS-OUT-TEST-MOCK') {
    throw ('UNSAFE: ' + $n + ' does not resolve to the harness mock')
  }
}

$command = [scriptblock]::Create($env:LO_FIREWALL_COMMAND)
# Windows PowerShell 5.1 emits a JSON array as ONE pipeline object; assign, then enumerate.
$scenarios = $env:LO_SCENARIOS | ConvertFrom-Json
$results = foreach ($s in $scenarios) {
  $script:s = $s
  $script:rules = [ordered]@{}
  foreach ($r in @($s.rules)) { if ($null -ne $r) { $script:rules[[string]$r.Name] = [pscustomobject]@{ Name = [string]$r.Name; Group = [string]$r.Group; Program = [string]$r.Program; NoApp = [bool]$r.NoApp } } }
  if ($s.bulk) {
    for ($i = 0; $i -lt [int]$s.bulk.count; $i++) {
      $name = 'LightsOutCompanion-' + (1900000000 + 4 * $i) + '-' + [guid]::NewGuid().ToString() + '-TCP'
      $script:rules[$name] = [pscustomobject]@{ Name = $name; Group = 'Lights Out Companion'; Program = [string]$s.bulk.program; NoApp = $false }
    }
  }
  $script:idProcs = @(foreach ($p in @($s.procs)) { if ($null -ne $p) { New-FakeProcess $p } })
  $fullSpec = if ($null -ne $s.PSObject.Properties['fullProcs']) { @($s.fullProcs) } else { @($s.procs) }
  $script:fullProcs = @(foreach ($p in $fullSpec) { if ($null -ne $p) { New-FakeProcess $p } })
  $script:attempted = [System.Collections.Generic.List[string]]::new()
  $script:removed = [System.Collections.Generic.List[string]]::new()
  $script:created = [System.Collections.Generic.List[string]]::new()
  $script:groupQueries = 0
  $runs = if ($s.runs) { [int]$s.runs } else { 1 }
  $errorText = $null
  $clock = [Diagnostics.Stopwatch]::StartNew()
  for ($run = 0; $run -lt $runs; $run++) {
    try { & $command | Out-Null } catch { $errorText = [string]$_ }
  }
  [pscustomobject]@{
    id = $s.id
    error = $errorText
    attempted = @($script:attempted)
    removed = @($script:removed)
    created = @($script:created)
    remaining = @($script:rules.Keys)
    groupQueries = $script:groupQueries
    elapsedMs = $clock.ElapsedMilliseconds
  }
}
if (Get-Module -Name NetSecurity) { throw 'UNSAFE: NetSecurity module was loaded during the harness' }
ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
`;

function runScenarios(command, scenarios) {
  const output = runPowerShell(HARNESS_SCRIPT, {
    LO_FIREWALL_COMMAND: command,
    LO_SCENARIOS: JSON.stringify(scenarios)
  });
  const results = list(JSON.parse(output.trim()));
  assert.equal(results.length, scenarios.length);
  return Object.fromEntries(results.map(result => [result.id, result]));
}

const self = (path = EXE, extra = {}) => ({ Id: OWNER_PID, Path: path, ...extra });

// ---------------------------------------------------------------------------
// Pure JS: command shape
// ---------------------------------------------------------------------------

test('configure sweeps stale rules inside the same PowerShell command, before removing and creating its own pair', () => {
  const command = firewall.configureOwnedRulesCommand(EXE, 58732);
  const cleanup = firewall.staleRulesCleanupCommand(EXE);
  assert.ok(cleanup.length > 0);
  const at = command.indexOf(cleanup);
  assert.ok(at > 0, 'configure must embed the stale sweep verbatim');
  assert.ok(at < command.indexOf(firewall.removeOwnedRulesCommand()), 'sweep must run before the owned-pair replace');
  assert.ok(at < command.indexOf('New-NetFirewallRule'), 'sweep must run before creation');
  assert.ok(command.startsWith("$ErrorActionPreference = 'Stop'; try {"));
  assert.match(cleanup, /\} catch \{ \}$/, 'sweep failures must never block creating this process\'s pair');
  assert.match(cleanup, /Get-NetFirewallRule -Group 'Lights Out Companion' -ErrorAction SilentlyContinue/);
  assert.match(cleanup, new RegExp(`Get-Process -Id ${OWNER_PID} `), 'sweep must calibrate against this process');
  assert.match(cleanup, /\$loOwn -contains/, 'own pair must be excluded from the stale sweep');
  // Production passes the text through `powershell.exe -Command` argv; with no
  // double quotes, Windows argument quoting cannot alter it.
  assert.doesNotMatch(command, /"/);
  assert.doesNotMatch(command, /NetSecurity\\|Invoke-Expression|\biex\b|Start-Process|Set-NetFirewall|Disable-NetFirewall/i);
  assert.doesNotMatch(command, /Public|Profile Any|-Program Any/i);
  assert.equal(command.split(firewall.removeOwnedRulesCommand()).length - 1, 2, 'owned remove still appears exactly before create and on rollback');
});

test('this process\'s own rule names have the exact shape other instances sweep', () => {
  const pattern = new RegExp(firewall.OWNED_RULE_NAME_PATTERN.replace(/\\z$/, '$'));
  assert.match(ownNames.tcp, pattern);
  assert.match(ownNames.udp, pattern);
  assert.equal(pattern.exec(ownNames.tcp)[1], String(OWNER_PID));
  for (const bad of [
    'Lights Out Companion TCP',
    `LightsOutCompanion-123-${crypto.randomUUID().toUpperCase()}-TCP`,
    `lightsoutcompanion-123-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-0123-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-0-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-12345678901-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-123-${crypto.randomUUID()}-TCP-old`,
    `LightsOutCompanion-123-${crypto.randomUUID()}-ICMP`,
    'LightsOutCompanion-123-a-TCP'
  ]) assert.doesNotMatch(bad, pattern, bad);
});

test('sweep limits are bounded and an unusable program path disables the sweep', () => {
  const max = firewall.STALE_CLEANUP_MAX_REMOVALS;
  const budget = firewall.STALE_CLEANUP_BUDGET_MS;
  assert.ok(max >= 1 && max <= 1024);
  assert.ok(budget >= 1 && budget <= 60000);
  assert.match(firewall.staleRulesCleanupCommand(EXE), new RegExp(`Select-Object -First ${max}\\)`));
  assert.match(firewall.staleRulesCleanupCommand(EXE), new RegExp(`-ge ${budget}\\)`));
  for (const limits of [{ maxRemovals: 0 }, { maxRemovals: 1e9 }, { maxRemovals: 2.5 }, { maxRemovals: 'all' }]) {
    assert.match(firewall.staleRulesCleanupCommand(EXE, limits), new RegExp(`Select-Object -First ${max}\\)`));
  }
  for (const limits of [{ budgetMs: -1 }, { budgetMs: 1e9 }, { budgetMs: 'forever' }]) {
    assert.match(firewall.staleRulesCleanupCommand(EXE, limits), new RegExp(`-ge ${budget}\\)`));
  }
  assert.equal(firewall.staleRulesCleanupCommand(''), '');
  assert.equal(firewall.staleRulesCleanupCommand('   '), '');
  assert.equal(firewall.staleRulesCleanupCommand(null), '');
  assert.doesNotMatch(firewall.configureOwnedRulesCommand('', 58732), /Get-Process|Get-NetFirewallRule -Group/);
});

// ---------------------------------------------------------------------------
// PowerShell parser: syntax and command allowlist (parse only, never executed)
// ---------------------------------------------------------------------------

test('generated commands parse cleanly, round-trip tricky paths and invoke only allowlisted commands', { skip: !isWindows }, () => {
  const paths = [
    EXE,
    "C:\\Users\\O'Brien\\Lights Out.exe",
    'C:\\Users\\O\u2019Connor\\Lights \u2018Out\u2019 \u201Abeta\u201B.exe',
    'C:\\Apps\\$env:TEMP `n [1] $(Get-Item x) @(1)\\Lights Out.exe',
    'D:\\Lumi\u00e8res \u00e9teintes\\\u65e5\u672c\\Lights Out.exe'
  ];
  const targets = [];
  paths.forEach((exe, index) => {
    targets.push({ id: `configure-${index}`, text: firewall.configureOwnedRulesCommand(exe, 58732), exe });
    targets.push({ id: `cleanup-${index}`, text: firewall.staleRulesCleanupCommand(exe), exe });
  });
  targets.push({ id: 'remove', text: firewall.removeOwnedRulesCommand() });
  targets.push({ id: 'snapshot', text: firewall.snapshotOwnedRulesCommand() });

  const allowed = new Set([
    'Get-NetFirewallRule', 'Get-NetFirewallApplicationFilter', 'Get-NetFirewallPortFilter', 'Get-Process',
    'Remove-NetFirewallRule', 'New-NetFirewallRule', 'Where-Object', 'ForEach-Object', 'Select-Object',
    'Out-Null', 'ConvertTo-Json'
  ]);
  const results = parseWithPowerShell(targets.map(({ id, text }) => ({ id, text })));
  assert.equal(results.length, targets.length);
  for (const result of results) {
    const target = targets.find(item => item.id === result.id);
    assert.deepEqual(list(result.errors), [], `${result.id} has PowerShell syntax errors`);
    const commands = list(result.commands);
    for (const name of commands) assert.ok(allowed.has(name), `${result.id} invokes non-allowlisted command ${name}`);
    if (result.id.startsWith('cleanup-')) {
      assert.deepEqual(list(result.assigned), [target.exe], `${result.id}: $loProgram must parse back to the exact path`);
      assert.equal(commands.filter(name => name === 'Remove-NetFirewallRule').length, 1);
      assert.equal(commands.filter(name => name === 'New-NetFirewallRule').length, 0);
    }
    if (result.id.startsWith('configure-')) {
      assert.deepEqual(list(result.assigned), [target.exe]);
      assert.deepEqual(list(result.programs), [target.exe, target.exe], `${result.id}: -Program must parse back to the exact path`);
      assert.equal(commands.filter(name => name === 'Remove-NetFirewallRule').length, 3, 'sweep + owned replace + rollback');
    }
  }
});

// ---------------------------------------------------------------------------
// Mocked evaluation of the real generated text
// ---------------------------------------------------------------------------

test('configure removes leaked and PID-reused pairs for this executable and keeps every live instance', { skip: !isWindows }, () => {
  const leaked = pair(fakePid(), EXE);
  const leakedCase = [{ Name: ruleName(fakePid()), Group: GROUP, Program: 'c:\\program files\\lights out\\LIGHTS OUT.EXE' }];
  const livePid = fakePid();
  const live = pair(livePid, EXE); // e.g. the owner's running app
  const liveCasePid = fakePid();
  const liveCase = pair(liveCasePid, EXE);
  const reusedPid = fakePid();
  const reused = pair(reusedPid, EXE);
  const unreadablePid = fakePid();
  const unreadable = pair(unreadablePid, EXE);
  const nullPathPid = fakePid();
  const nullPath = pair(nullPathPid, EXE);
  const otherProgram = pair(fakePid(), QA_EXE); // dead, but another executable's rules
  const outsideGroup = pair(fakePid(), EXE, 'Some Other Group');
  const groupCase = [{ Name: ruleName(fakePid()), Group: 'lights out companion', Program: EXE }];
  const legacy = [
    { Name: 'Lights Out Companion TCP', Group: GROUP, Program: EXE },
    { Name: 'Lights Out Companion Discovery UDP', Group: GROUP, Program: EXE }
  ];
  const dead = fakePid();
  const shapes = [
    `LightsOutCompanion-${dead}-${crypto.randomUUID().toUpperCase()}-TCP`,
    `LightsOutCompanion-${dead}-${crypto.randomUUID()}-TCP-old`,
    `lightsoutcompanion-${dead}-${crypto.randomUUID()}-TCP`,
    `XLightsOutCompanion-${dead}-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-0${dead}-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-0-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-4294967292-${crypto.randomUUID()}-TCP`,
    `LightsOutCompanion-12345678901-${crypto.randomUUID()}-UDP`,
    `LightsOutCompanion-${dead}-${crypto.randomUUID()}-ICMP`,
    `LightsOutCompanion-${dead}-not-a-uuid-TCP`
  ].map(Name => ({ Name, Group: GROUP, Program: EXE }));
  const noApp = [{ Name: ruleName(fakePid()), Group: GROUP, Program: EXE, NoApp: true }];
  const emptyProgram = [{ Name: ruleName(fakePid()), Group: GROUP, Program: '' }];

  const keep = [...live, ...liveCase, ...unreadable, ...nullPath, ...otherProgram, ...outsideGroup, ...groupCase, ...legacy, ...shapes, ...noApp, ...emptyProgram];
  const stale = [...leaked, ...leakedCase, ...reused];
  const procs = [
    self(),
    { Id: livePid, Path: EXE },
    { Id: liveCasePid, Path: 'C:\\PROGRAM FILES\\Lights Out\\lights out.exe' },
    { Id: reusedPid, Path: 'C:\\Windows\\System32\\svchost.exe' },
    { Id: unreadablePid, PathMode: 'throw' },
    { Id: nullPathPid, PathMode: 'null' }
  ];
  const command = firewall.configureOwnedRulesCommand(EXE, 58732);
  const results = runScenarios(command, [
    { id: 'once', rules: [...keep, ...stale], procs },
    { id: 'twice', rules: [...keep, ...stale], procs, runs: 2 }
  ]);
  for (const id of ['once', 'twice']) {
    const result = results[id];
    assert.equal(result.error, null, `${id}: ${result.error}`);
    const sweptOrReplaced = new Set(list(result.attempted));
    const ownSet = new Set([ownNames.tcp, ownNames.udp]);
    const sweptOther = sorted(list(result.removed).filter(name => !ownSet.has(name)));
    assert.deepEqual(sweptOther, sorted(stale.map(rule => rule.Name)), `${id}: exactly the stale rules are removed`);
    for (const rule of keep) {
      assert.ok(!sweptOrReplaced.has(rule.Name), `${id}: removal attempted on protected rule ${rule.Name}`);
      assert.ok(list(result.remaining).includes(rule.Name), `${id}: protected rule ${rule.Name} is gone`);
    }
    assert.deepEqual(sorted(list(result.remaining).filter(name => ownSet.has(name))), sorted([...ownSet]), `${id}: own pair exists once`);
    assert.equal(list(result.remaining).length, keep.length + 2);
  }
  assert.deepEqual(sorted(results.twice.created), sorted([ownNames.tcp, ownNames.udp, ownNames.tcp, ownNames.udp]));
});

test('a QA or dev build at another path never touches the installed app\'s rules, live or leaked (2026-10-05 class)', { skip: !isWindows }, () => {
  const installedLivePid = fakePid();
  const installedLive = pair(installedLivePid, EXE);
  const installedLeaked = [...pair(fakePid(), EXE), ...pair(fakePid(), EXE), ...pair(fakePid(), EXE)];
  const qaLivePid = fakePid();
  const qaLive = pair(qaLivePid, QA_EXE);
  const secondInstalledPid = fakePid();
  const secondInstalled = pair(secondInstalledPid, EXE);
  const rules = [...installedLive, ...installedLeaked, ...qaLive, ...secondInstalled];

  // The QA candidate (this process runs QA_EXE) configures its rules.
  const qa = runScenarios(firewall.configureOwnedRulesCommand(QA_EXE, 58740), [{
    id: 'qa', rules, procs: [self(QA_EXE), { Id: installedLivePid, Path: EXE }, { Id: qaLivePid, Path: QA_EXE }, { Id: secondInstalledPid, Path: EXE }]
  }]).qa;
  assert.equal(qa.error, null);
  assert.deepEqual(list(qa.attempted).filter(name => !name.startsWith(`LightsOutCompanion-${OWNER_PID}-`)), [], 'QA build attempted to remove another executable\'s rules');
  for (const rule of rules) assert.ok(list(qa.remaining).includes(rule.Name), `QA build removed ${rule.Name}`);

  // The installed app (this process runs EXE) configures: only its own leaked pairs go.
  const installed = runScenarios(firewall.configureOwnedRulesCommand(EXE, 58732), [{
    id: 'installed', rules, procs: [self(EXE), { Id: installedLivePid, Path: EXE }, { Id: qaLivePid, Path: QA_EXE }, { Id: secondInstalledPid, Path: EXE }]
  }]).installed;
  assert.equal(installed.error, null);
  assert.deepEqual(sorted(list(installed.removed).filter(name => !name.startsWith(`LightsOutCompanion-${OWNER_PID}-`))), sorted(installedLeaked.map(rule => rule.Name)));
  for (const rule of [...installedLive, ...qaLive, ...secondInstalled]) {
    assert.ok(!list(installed.attempted).includes(rule.Name), `live instance rule ${rule.Name} was targeted`);
  }
});

test('the sweep fails closed when process or firewall data is missing, unreadable or inconsistent', { skip: !isWindows }, () => {
  const leaked = pair(fakePid(), EXE);
  const liveOther = { Id: fakePid(), Path: EXE };
  const base = { rules: leaked };
  // Scenarios where `Get-Process -Id <this process>` cannot confirm this exact
  // executable: the sweep must not even query the firewall.
  const uncalibrated = new Set(['owner-not-running', 'id-lookup-lacks-owner', 'owner-short-path', 'owner-path-throws', 'owner-path-null', 'id-query-throws']);
  const scenarios = [
    { id: 'control', ...base, procs: [self(), liveOther] },
    { id: 'owner-not-running', ...base, procs: [liveOther] },
    { id: 'id-lookup-lacks-owner', ...base, procs: [liveOther], fullProcs: [self(), liveOther] },
    { id: 'owner-short-path', ...base, procs: [self('C:\\PROGRA~1\\LIGHTS~1\\LIGHTS~1.EXE'), liveOther] },
    { id: 'owner-path-throws', ...base, procs: [self(EXE, { PathMode: 'throw' }), liveOther] },
    { id: 'owner-path-null', ...base, procs: [self(EXE, { PathMode: 'null' }), liveOther] },
    { id: 'id-query-throws', ...base, procs: [self(), liveOther], idProcThrow: true },
    { id: 'full-list-throws', ...base, procs: [self(), liveOther], fullProcThrow: true },
    { id: 'full-list-empty', ...base, procs: [self(), liveOther], fullProcs: [] },
    { id: 'full-list-lacks-owner', ...base, procs: [self(), liveOther], fullProcs: [liveOther] },
    { id: 'full-list-owner-other-path', ...base, procs: [self(), liveOther], fullProcs: [self('C:\\Elsewhere\\Lights Out.exe'), liveOther] },
    { id: 'app-filter-throws', ...base, procs: [self(), liveOther], appFilterThrow: true },
    { id: 'group-query-throws', ...base, procs: [self(), liveOther], groupQueryThrow: true }
  ];
  const results = runScenarios(firewall.configureOwnedRulesCommand(EXE, 58732), scenarios);
  assert.deepEqual(sorted(list(results.control.removed).filter(name => !name.startsWith(`LightsOutCompanion-${OWNER_PID}-`))), sorted(leaked.map(rule => rule.Name)), 'control scenario must sweep the leaked pair');
  for (const { id } of scenarios.slice(1)) {
    const result = results[id];
    assert.equal(result.error, null, `${id}: sweep failure leaked out of the command: ${result.error}`);
    for (const rule of leaked) assert.ok(!list(result.attempted).includes(rule.Name), `${id}: removed ${rule.Name} without verified process data`);
    assert.deepEqual(sorted(result.created), sorted([ownNames.tcp, ownNames.udp]), `${id}: own pair must still be created`);
    if (uncalibrated.has(id)) assert.equal(result.groupQueries, 0, `${id}: firewall was queried before this process was verified`);
  }
  assert.equal(results.control.groupQueries, 1);
});

test('one failed stale removal neither stops the others nor blocks creating this process\'s pair', { skip: !isWindows }, () => {
  const first = pair(fakePid(), EXE);
  const second = pair(fakePid(), EXE);
  const result = runScenarios(firewall.configureOwnedRulesCommand(EXE, 58732), [{
    id: 'partial', rules: [...first, ...second], procs: [self()], removeFail: [first[0].Name]
  }]).partial;
  assert.equal(result.error, null);
  assert.deepEqual(sorted(list(result.removed).filter(name => !name.startsWith(`LightsOutCompanion-${OWNER_PID}-`))), sorted([first[1].Name, ...second.map(rule => rule.Name)]));
  assert.ok(list(result.remaining).includes(first[0].Name));
  assert.deepEqual(sorted(result.created), sorted([ownNames.tcp, ownNames.udp]));
});

test('one sweep is bounded by a removal cap and a time budget', { skip: !isWindows }, () => {
  const cap = firewall.STALE_CLEANUP_MAX_REMOVALS;
  const capped = runScenarios(firewall.configureOwnedRulesCommand(EXE, 58732), [{
    id: 'cap', rules: [], bulk: { count: cap + 44, program: EXE }, procs: [self()]
  }]).cap;
  assert.equal(capped.error, null);
  const sweptByCap = list(capped.removed).filter(name => !name.startsWith(`LightsOutCompanion-${OWNER_PID}-`));
  assert.equal(sweptByCap.length, cap, 'removal cap not applied');
  assert.equal(list(capped.remaining).length, 44 + 2);

  const budgetMs = 1200;
  const delayMs = 200;
  const timed = runScenarios(firewall.staleRulesCleanupCommand(EXE, { budgetMs }), [{
    id: 'budget', rules: [], bulk: { count: 30, program: EXE }, procs: [self()], removeDelayMs: delayMs
  }]).budget;
  assert.equal(timed.error, null);
  const attempts = list(timed.attempted).length;
  assert.ok(attempts >= 1, 'budget scenario should start removing');
  assert.ok(attempts <= Math.ceil(budgetMs / delayMs) + 1, `time budget not applied: ${attempts} removals`);
  assert.ok(attempts < 30);
});
