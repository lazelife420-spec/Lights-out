'use strict';
// QA installer scripts must launch Lights Out only with the QA power lock (and installer QA mode
// where they install), so a QA launch never runs a real power action and never touches the owner's
// per-user scheduled tasks (main.js disables the watchdog under either flag).
//
// Each case runs the real script in Windows PowerShell with Start-Process, Get-CimInstance,
// Start-Sleep (and, for verify-windows-release.ps1, node) replaced by recording stubs: nothing is
// installed or launched, and no process, registry or scheduled task is touched. The stubs record
// the environment every launch would have inherited. Task Scheduler and registry writes are stubs
// that throw, so no harness can change either.
// Review fixes covered here: verify-windows-release.ps1 survives proof stderr under Windows
// PowerShell 5.1, and uninstall-matrix -TestRegistration refuses beside an existing per-user task.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptsDir = path.join(__dirname, '..', 'scripts');
const windows = process.platform === 'win32';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const skip = !windows && 'Windows PowerShell scripts';

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-qa-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Stubs shared by both harnesses. Functions win over cmdlets and applications in PowerShell's
// command lookup, and the script under test runs in a child scope of the harness, so it calls
// these. State lives in $global: because $script: would resolve to the script under test.
const STUBS = String.raw`
$ErrorActionPreference = 'Stop'
$global:loLaunches = New-Object System.Collections.ArrayList
$global:loRunning = @{}
function global:Write-LoLaunch([string]$Kind, [string]$File, [string]$Arguments) {
  [void]$global:loLaunches.Add([pscustomobject]@{
    kind = $Kind; file = $File; args = $Arguments
    qaPowerLock = $env:LIGHTS_OUT_QA_POWER_LOCK; installerQa = $env:LIGHTS_OUT_INSTALLER_QA; packagedExe = $env:LIGHTS_OUT_PACKAGED_EXE
  })
}
$global:loForbidLaunch = $false
function global:Start-Process {
  [CmdletBinding()]
  param([string]$FilePath, [object[]]$ArgumentList, [string]$WindowStyle, [switch]$Wait, [switch]$PassThru)
  if ($global:loForbidLaunch) { throw "unexpected launch: $FilePath" }
  $joined = @($ArgumentList) -join ' '
  $leaf = Split-Path -Leaf $FilePath
  if ($leaf -eq 'taskkill.exe') {
    Write-LoLaunch 'taskkill' $FilePath $joined
    $global:loRunning.Clear()
  } elseif ($leaf -eq 'Uninstall.exe') {
    Write-LoLaunch 'uninstall' $FilePath $joined
    $dir = Split-Path -Parent $FilePath
    if (-not $global:loRunning.ContainsKey($dir)) { Remove-Item -LiteralPath $dir -Recurse -Force }
  } elseif ($leaf -eq 'Lights Out.exe') {
    Write-LoLaunch 'app' $FilePath $joined
    if ($joined -notmatch '--test-quit-after-start') { $global:loRunning[(Split-Path -Parent $FilePath)] = $true }
  } else {
    Write-LoLaunch 'install' $FilePath $joined
    $dir = (@($ArgumentList) | Where-Object { "$_" -like '/D=*' } | Select-Object -First 1).Substring(3)
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    foreach ($file in $global:loInstallFiles.Keys) {
      $target = Join-Path $dir $file
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      [IO.File]::WriteAllBytes($target, $global:loInstallFiles[$file])
    }
  }
  return [pscustomobject]@{ ExitCode = 0; Id = 3 }
}
function global:Get-CimInstance {
  [CmdletBinding()]
  param([Parameter(Position = 0)][string]$ClassName, [string]$Filter)
  return @($global:loRunning.Keys | ForEach-Object { [pscustomobject]@{ Name = 'Lights Out.exe'; ProcessId = 3; ExecutablePath = (Join-Path $_ 'Lights Out.exe') } })
}
function global:Start-Sleep {
  [CmdletBinding()]
  param([Parameter(Position = 0)][double]$Seconds, [int]$Milliseconds)
}
# Per-user scheduled tasks: none exist unless a harness names them, and a missing one fails the way
# the real cmdlet does. Nothing a harness runs may create or delete a task or a registry value.
$global:loExistingTasks = @()
$global:loTaskLookupFails = $false
function global:Get-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskPath, [string]$TaskName)
  if ($global:loTaskLookupFails) { throw 'Task Scheduler is unavailable' }
  if ($TaskPath -eq '\' -and $global:loExistingTasks -contains $TaskName) { return [pscustomobject]@{ TaskPath = '\'; TaskName = $TaskName; Actions = @() } }
  Write-Error -Message 'No MSFT_ScheduledTask objects found' -ErrorId 'CmdletizationQuery_NotFound' -Category ObjectNotFound
}
foreach ($name in @('Register-ScheduledTask', 'Unregister-ScheduledTask', 'New-ItemProperty', 'Remove-ItemProperty', 'Set-ItemProperty')) {
  Set-Item -Path "function:global:$name" -Value { throw "unexpected call: $($MyInvocation.MyCommand.Name)" }
}
$global:loError = $null
function global:Save-LoLaunches([string]$Path) {
  $after = [pscustomobject]@{ qaPowerLock = $env:LIGHTS_OUT_QA_POWER_LOCK; installerQa = $env:LIGHTS_OUT_INSTALLER_QA }
  $json = [pscustomobject]@{ launches = @($global:loLaunches); after = $after; error = $global:loError } | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText($Path, $json)
}
`;

function runHarness(t, harnessBody, { env = {}, args = [] } = {}) {
  const root = tempDir(t);
  const harness = path.join(root, 'harness.ps1');
  const log = path.join(root, 'launches.json');
  // param() must be the first statement of a PowerShell script.
  fs.writeFileSync(harness, 'param([string]$Root, [string]$Log, [string]$Matrix, [string]$Verify, [string]$Version)\n' + STUBS + harnessBody);
  const temp = path.join(root, 'temp');
  fs.mkdirSync(temp);
  const childEnv = { ...process.env, TEMP: temp, TMP: temp, ...env };
  for (const name of ['LIGHTS_OUT_QA_POWER_LOCK', 'LIGHTS_OUT_INSTALLER_QA', 'LIGHTS_OUT_PACKAGED_EXE']) if (!(name in env)) delete childEnv[name];
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, '-Root', root, '-Log', log, ...args],
    { env: childEnv, encoding: 'utf8', timeout: 150000, windowsHide: true });
  assert.ok(fs.existsSync(log), `harness did not finish (exit ${result.status}): ${result.stdout}\n${result.stderr}`);
  return { root, result, ...JSON.parse(fs.readFileSync(log, 'utf8')) };
}

test('every Lights Out the uninstall matrix launches carries the QA power lock and installer QA mode', { skip, timeout: 180000 }, t => {
  const matrix = path.join(scriptsDir, 'uninstall-matrix.ps1');
  const { root, launches, after } = runHarness(t, String.raw`
$global:loInstallFiles = @{ 'Lights Out.exe' = [byte[]](1); 'Uninstall.exe' = [byte[]](2) }
1..60 | ForEach-Object { $global:loInstallFiles["resources\app\file$_.txt"] = [byte[]](3) }
# The QA-isolated matrix never touches registration, so the owner's tasks do not stop it.
$global:loExistingTasks = @('LightsOut-AutopilotWatchdog', 'LightsOut_FirstLight')
$setup = Join-Path $Root 'Lights-Out-Setup-fixture.exe'
[IO.File]::WriteAllBytes($setup, [byte[]](0))
try {
  & $Matrix -SetupExe $setup -ReportPath (Join-Path $Root 'matrix.json') | Out-Null
} finally {
  Save-LoLaunches $Log
}
`, { env: { LIGHTS_OUT_QA_POWER_LOCK: '0' }, args: ['-Matrix', matrix] });

  const apps = launches.filter(entry => entry.kind === 'app');
  assert.ok(apps.length >= 3, `scenarios B, C and D launch the installed app (saw ${apps.length})`);
  for (const launch of apps) {
    assert.equal(launch.qaPowerLock, '1', `app launch ${launch.args} carries LIGHTS_OUT_QA_POWER_LOCK=1`);
    assert.equal(launch.installerQa, '1', `app launch ${launch.args} carries LIGHTS_OUT_INSTALLER_QA=1`);
    assert.match(launch.args, /--user-data-dir=/, 'each launch uses its own profile');
    assert.ok(path.resolve(launch.file).startsWith(path.join(root, 'temp') + path.sep), 'only the temporary QA install is launched');
  }
  for (const launch of launches.filter(entry => entry.kind === 'install' || entry.kind === 'uninstall')) {
    assert.equal(launch.installerQa, '1', `${launch.kind} runs in installer QA mode`);
    assert.equal(launch.qaPowerLock, '1');
  }
  assert.ok(launches.some(entry => entry.kind === 'install') && launches.some(entry => entry.kind === 'uninstall'));
  assert.deepEqual(after, { qaPowerLock: '0', installerQa: null }, 'the caller\'s environment is restored afterwards');
});

// -TestRegistration lets the uninstallers under test run their registration cleanup, so it refuses
// to start beside either per-user Lights Out task (fail closed when the lookup itself fails). Any
// launch, task or registry change is a stub that throws, and the production uninstall
// registration is hidden from the matrix so this refusal, not that one, is what is tested.
function runRegistrationMatrix(t, { existingTasks = [], lookupFails = false } = {}) {
  const matrix = path.join(scriptsDir, 'uninstall-matrix.ps1');
  return runHarness(t, String.raw`
$global:loForbidLaunch = $true
$global:loExistingTasks = @($env:LO_EXISTING_TASKS -split ',' | Where-Object { $_ })
$global:loTaskLookupFails = $env:LO_TASK_LOOKUP_FAILS -eq '1'
function global:Test-Path {
  [CmdletBinding()]
  param([Parameter(Position = 0)][string[]]$Path, [string[]]$LiteralPath, $PathType)
  if ("$LiteralPath" -like 'HKCU:*') { return $false }
  Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
$setup = Join-Path $Root 'Lights-Out-Setup-fixture.exe'
[IO.File]::WriteAllBytes($setup, [byte[]](0))
try {
  & $Matrix -SetupExe $setup -ReportPath (Join-Path $Root 'matrix.json') -TestRegistration | Out-Null
} catch {
  $global:loError = $_.Exception.Message
} finally {
  Save-LoLaunches $Log
}
`, { env: { LO_EXISTING_TASKS: existingTasks.join(','), LO_TASK_LOOKUP_FAILS: lookupFails ? '1' : '0' }, args: ['-Matrix', matrix] });
}

test('uninstall-matrix -TestRegistration refuses to run beside an existing per-user Lights Out task', { skip, timeout: 180000 }, t => {
  for (const task of ['LightsOut-AutopilotWatchdog', 'LightsOut_FirstLight']) {
    const { error, launches, after } = runRegistrationMatrix(t, { existingTasks: [task] });
    assert.match(error || '', new RegExp(`^Refusing -TestRegistration because a '${task}' scheduled task already exists`), `refuses beside ${task}`);
    assert.deepEqual(launches, [], 'nothing is installed or launched');
    assert.deepEqual(after, { qaPowerLock: null, installerQa: null }, 'it refuses before changing the environment');
  }
  const unreadable = runRegistrationMatrix(t, { lookupFails: true });
  assert.match(unreadable.error || '', /^Refusing -TestRegistration because a 'LightsOut-AutopilotWatchdog' scheduled task already exists \(or could not be checked\)/,
    'a task lookup that fails counts as an existing task');
  // With neither task present the refusal stays quiet: the matrix goes on to its first install,
  // which this harness forbids.
  const clean = runRegistrationMatrix(t);
  assert.match(clean.error || '', /^unexpected launch: .*Lights-Out-Setup-fixture\.exe$/, `a missing task is not mistaken for an existing one (${clean.error})`);
});

// The installed-runtime proof is stubbed as a real native process (cmd.exe) that writes to stderr
// the way Node does for a warning or a failure stack: Windows PowerShell 5.1 turns redirected
// native stderr into a terminating error under $ErrorActionPreference = 'Stop'.
function runVerifyHarness(t, proofCommand) {
  const verifyScript = path.join(scriptsDir, 'verify-windows-release.ps1');
  const version = require('../package.json').version;
  return runHarness(t, String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$output = Join-Path $Root 'dist-native'
New-Item -ItemType Directory -Path $output | Out-Null
$runtimeBytes = [Text.Encoding]::UTF8.GetBytes('fixture runtime')
$global:loInstallFiles = @{ 'Lights Out.exe' = $runtimeBytes; 'Uninstall.exe' = [byte[]](2) }
$sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($runtimeBytes)).Replace('-', '').ToLowerInvariant()
$zip = [IO.Compression.ZipFile]::Open((Join-Path $output "Lights-Out-Portable-v$Version-win-x64.zip"), 'Create')
try {
  $stream = $zip.CreateEntry('Lights Out.exe').Open()
  try { $stream.Write($runtimeBytes, 0, $runtimeBytes.Length) } finally { $stream.Dispose() }
} finally { $zip.Dispose() }
[IO.File]::WriteAllBytes((Join-Path $output "Lights-Out-Setup-v$Version.exe"), [byte[]](0))
$manifest = [pscustomobject]@{ version = $Version; artifacts = @(@{ name = 'setup' }, @{ name = 'zip' }); runtime = @(@{ path = 'Lights Out.exe'; sha256 = $sha }) }
[IO.File]::WriteAllText((Join-Path $output 'BUILD-MANIFEST.json'), ($manifest | ConvertTo-Json -Depth 4))
function global:node {
  $joined = $args -join ' '
  Write-LoLaunch 'node' ([string]$args[0]) $joined
  $global:LASTEXITCODE = 0
  if ($joined -match 'settings-layout-runtime-proof') { & cmd.exe /d /c $env:LO_PROOF_COMMAND }
}
try {
  & $Verify -OutputRoot $output | Out-Null
} catch {
  $global:loError = $_.Exception.Message
} finally {
  Save-LoLaunches $Log
}
`, { env: { LIGHTS_OUT_QA_POWER_LOCK: '0', LO_PROOF_COMMAND: proofCommand }, args: ['-Verify', verifyScript, '-Version', version] });
}

test('verify-windows-release.ps1 passes when the installed-runtime proof writes a benign warning to stderr', { skip, timeout: 180000 }, t => {
  const { root, result, error } = runVerifyHarness(t, 'echo node warning: benign stderr line 1>&2 & echo PASS 4 category/theme/viewport layouts');
  assert.equal(error, null, `a stderr line from a passing proof does not fail the gate (${error})`);
  assert.match(result.stderr, /node warning: benign stderr line/, 'the proof\'s stderr still reaches the console');
  assert.match(result.stdout, /PASS 4 category\/theme\/viewport layouts/, 'its stdout is still printed');
  const verification = JSON.parse(fs.readFileSync(path.join(root, 'dist-native', 'WINDOWS-VERIFICATION.json'), 'utf8'));
  assert.equal(verification.status, 'passed');
  assert.equal(verification.installedRuntime, '4 settings layout checks', 'the layout count is read from stdout');
});

test('verify-windows-release.ps1 reports a failing installed-runtime proof with its output and stack', { skip, timeout: 180000 }, t => {
  const { root, result, error, launches, after } = runVerifyHarness(t,
    'echo PASS 2 category/theme/viewport layouts & echo Error: layout proof failed at viewport 3 1>&2 & exit /b 7');
  assert.equal(error, 'Installed application runtime proof failed.', 'the exit code decides, through the gate\'s own failure path');
  assert.match(result.stdout, /PASS 2 category\/theme\/viewport layouts/, 'the PASS lines printed before the failure are shown');
  assert.match(result.stderr, /Error: layout proof failed at viewport 3/, 'and so is the failure stack');
  assert.equal(fs.existsSync(path.join(root, 'dist-native', 'WINDOWS-VERIFICATION.json')), false, 'no passing verification is recorded');
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist-native')).filter(name => name.startsWith('installer-qa-')), [], 'the QA install folder is removed');
  assert.equal(launches.filter(entry => entry.kind === 'uninstall').length, 0);
  assert.deepEqual(after, { qaPowerLock: '0', installerQa: null }, 'the caller\'s environment is restored afterwards');
});

test('the installed-runtime proof in verify-windows-release.ps1 runs under the QA power lock', { skip, timeout: 180000 }, t => {
  const { root, launches, after, error } = runVerifyHarness(t, 'echo PASS 4 category/theme/viewport layouts');
  assert.equal(error, null, error);

  const proof = launches.filter(entry => entry.kind === 'node' && /settings-layout-runtime-proof\.js$/.test(entry.file));
  assert.equal(proof.length, 1, 'the installed-runtime proof ran once');
  assert.equal(proof[0].qaPowerLock, '1', 'the installed app the proof launches inherits LIGHTS_OUT_QA_POWER_LOCK=1');
  assert.equal(proof[0].installerQa, '1', 'and LIGHTS_OUT_INSTALLER_QA=1');
  // CI temp roots can appear as 8.3 short names (RUNNER~1) or long names, in
  // any case: compare against every spelling of the real root.
  const roots = new Set([root, fs.realpathSync(root), fs.realpathSync.native(root)].map(r => path.join(r, 'dist-native', 'installer-qa-').toLowerCase()));
  const exe = String(proof[0].packagedExe || '').toLowerCase();
  assert.ok([...roots].some(prefix => exe.startsWith(prefix)), `the proof targets the QA install only (${proof[0].packagedExe})`);
  for (const launch of launches.filter(entry => entry.kind === 'install' || entry.kind === 'uninstall')) {
    assert.equal(launch.installerQa, '1', `${launch.kind} runs in installer QA mode`);
  }
  assert.equal(launches.filter(entry => entry.kind === 'uninstall').length, 1, 'the QA install is removed');
  const verification = JSON.parse(fs.readFileSync(path.join(root, 'dist-native', 'WINDOWS-VERIFICATION.json'), 'utf8'));
  assert.equal(verification.status, 'passed');
  assert.deepEqual(after, { qaPowerLock: '0', installerQa: null }, 'the caller\'s environment is restored afterwards');
});

test('the QA and provisioning PowerShell scripts parse without errors', { skip, timeout: 60000 }, () => {
  for (const name of ['uninstall-matrix.ps1', 'verify-windows-release.ps1', 'provision-nsis.ps1']) {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:LO_PARSE_FILE, [ref]$null, [ref]$errors); '
      + '$errors | ForEach-Object { $_.Message }; exit @($errors).Count'],
    { env: { ...process.env, LO_PARSE_FILE: path.join(scriptsDir, name) }, encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`);
  }
});
