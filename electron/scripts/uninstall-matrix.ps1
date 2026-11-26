# Repeatable uninstall/install matrix for Lights Out native NSIS Windows installer.
# Safe by default: runs in LIGHTS_OUT_INSTALLER_QA=1 mode so any existing production
# registration, shortcuts, and running Lights Out instance outside the temp QA install
# folder are NEVER touched. Pass -TestRegistration only on a clean machine without a
# production Lights Out installation.
# Every Lights Out the matrix launches also inherits LIGHTS_OUT_QA_POWER_LOCK=1 (in every
# mode, -TestRegistration included): the app then never runs a real power action and never
# creates, repoints or deletes the owner's per-user scheduled tasks (autopilot watchdog).
#
# Scenarios:
# A - Install, no launch, uninstall
# B - Install, launch, clean quit via --test-quit-after-start, uninstall
# C - Install, launch, leave running, uninstall (expected abort with files intact)
# D - Install, launch, taskkill /F /T (scoped to QA PID only), uninstall
# E - Install, then install over same directory (upgrade/reinstall)
# F - Install into directory containing unrelated sibling file keep-me.txt, uninstall (keep-me.txt MUST survive)
# G - Install, plant files only an older build shipped, upgrade, uninstall (old app-owned files gone, keep-me.txt kept)
# H - Only with -PreviousSetupExe: install that older release (for example v11.2.0), upgrade, uninstall (nothing left)
# I - Only with -TestRegistration: the uninstaller removes the Run-at-login value Electron writes for this install
#     (electron.app.<exe ProductName>) and keeps a login item that launches another Lights Out copy; likewise it
#     removes a (disabled, fixture) scheduled task that launches this install and keeps one that launches another copy.
#     -TestRegistration refuses to start when either per-user Lights Out task already exists.

param(
  [string]$SetupExe,
  [string]$ReportPath = (Join-Path $env:TEMP 'lightsout-uninstall-matrix.json'),
  [switch]$TestRegistration,
  [string]$PreviousSetupExe
)

$ErrorActionPreference = 'Stop'
$electronDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$pkg = Get-Content -LiteralPath (Join-Path $electronDir 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version

if (-not $SetupExe) {
  $SetupExe = Join-Path (Join-Path (Split-Path -Parent $electronDir) 'dist-native') "Lights-Out-Setup-v$version.exe"
}
$SetupExe = [IO.Path]::GetFullPath($SetupExe)
if (-not (Test-Path -LiteralPath $SetupExe -PathType Leaf)) {
  throw "NSIS installer not found: $SetupExe"
}
if ($PreviousSetupExe) {
  $PreviousSetupExe = [IO.Path]::GetFullPath($PreviousSetupExe)
  if (-not (Test-Path -LiteralPath $PreviousSetupExe -PathType Leaf)) {
    throw "Previous NSIS installer not found: $PreviousSetupExe"
  }
}

$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LightsOut'
if ($TestRegistration -and (Test-Path -LiteralPath $regPath)) {
  throw "Refusing -TestRegistration because a production Lights Out registration already exists at $regPath."
}

# The per-user scheduled tasks Lights Out arms (watchdog.js, alarm.js). Their names are per Windows
# user, not per install. The uninstaller removes one only when it launches the install being
# removed, but -TestRegistration still refuses to run beside an existing one, since a regression
# there would delete another copy's watchdog or wake alarm.
$userTaskNames = @('LightsOut-AutopilotWatchdog', 'LightsOut_FirstLight')

# Fails closed: a task that cannot be looked up counts as present.
function Test-UserTaskPresent([string]$Name) {
  try {
    $null = Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction Stop
    return $true
  } catch {
    return -not ("$($_.FullyQualifiedErrorId)" -like 'CmdletizationQuery_NotFound*')
  }
}

if ($TestRegistration) {
  foreach ($taskName in $userTaskNames) {
    if (Test-UserTaskPresent $taskName) {
      throw "Refusing -TestRegistration because a '$taskName' scheduled task already exists (or could not be checked) for this Windows user."
    }
  }
}

function Get-ScopedLightsOutProcesses([string]$InstallDir) {
  $norm = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  return @(Get-CimInstance Win32_Process -Filter "Name = 'Lights Out.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and ([IO.Path]::GetFullPath((Split-Path -Parent $_.ExecutablePath)).TrimEnd('\') -ieq $norm)
  })
}

function Stop-ScopedLightsOut([string]$InstallDir) {
  foreach ($proc in Get-ScopedLightsOutProcesses $InstallDir) {
    Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/F', '/T', '/PID', "$($proc.ProcessId)") -WindowStyle Hidden -Wait | Out-Null
  }
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline -and (Get-ScopedLightsOutProcesses $InstallDir).Count -gt 0) {
    Start-Sleep -Milliseconds 150
  }
}

function New-TestRoot {
  $guid = [guid]::NewGuid().ToString('n')
  $root = Join-Path $env:TEMP "lo-matrix-$guid"
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  return $root
}

function Remove-TestRoot([string]$Root) {
  if ($Root -and (Test-Path -LiteralPath $Root)) {
    Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Install-Setup([string]$Dir) {
  # Note: NSIS requires /D= to be the final unquoted argument (even when $Dir contains spaces).
  $proc = Start-Process -FilePath $SetupExe -ArgumentList @('/S', "/D=$Dir") -WindowStyle Hidden -Wait -PassThru
  return $proc.ExitCode
}

function Uninstall-Setup([string]$Dir) {
  $unins = Join-Path $Dir 'Uninstall.exe'
  if (-not (Test-Path -LiteralPath $unins)) { return $null }
  # Pass _?=$Dir so Uninstall.exe runs synchronously and returns its real exit code!
  # Wait: when _?= is passed, NSIS cannot self-delete Uninstall.exe, so omit _?= for
  # normal cleanup and wait on the directory removal, except for abort detection where
  # un.onInit runs synchronously in the copied temp uninstaller before exit.
  $proc = Start-Process -FilePath $unins -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru
  Wait-NsisUninstallerCopy
  return $proc.ExitCode
}

# Uninstall.exe hands over to a copy of itself under %TEMP%\~nsu<X>.tmp and exits at once. That
# copy removes the registration (login items, then one PowerShell run per scheduled task) only after
# the install folder is gone, so wait for it before checking registration.
function Wait-NsisUninstallerCopy([int]$TimeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline -and @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -like '*\~nsu*.tmp\*'
  }).Count -gt 0) {
    Start-Sleep -Milliseconds 250
  }
}

function Wait-UntilRemoved([string]$Dir, [int]$TimeoutSec = 10) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline -and (Test-Path -LiteralPath $Dir)) {
    Start-Sleep -Milliseconds 200
  }
}

function Get-RemainingCount([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir)) { return 0 }
  return (Get-ChildItem -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object).Count
}

function Get-RegistryKeyPresent {
  return Test-Path -LiteralPath $regPath
}

function Invoke-ScenarioA {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $result = @{ scenario = 'A'; description = 'Install, no launch, uninstall' }
  try {
    $result.installExit = Install-Setup $installDir
    $result.uninstallExit = Uninstall-Setup $installDir
    Wait-UntilRemoved $installDir 10
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.registryKeyPresent = Get-RegistryKeyPresent
    $result.processesAfter = (Get-ScopedLightsOutProcesses $installDir).Count
    $regOk = if ($TestRegistration) { -not $result.registryKeyPresent } else { $true }
    $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0 -and $result.processesAfter -eq 0 -and $regOk)
  } finally {
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioB {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $userData = Join-Path $root 'userData'
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $oldSuppress = $env:LIGHTS_OUT_SUPPRESS_TRAY
  $env:LIGHTS_OUT_SUPPRESS_TRAY = '1'
  $result = @{ scenario = 'B'; description = 'Install, launch, clean quit, uninstall' }
  try {
    $result.installExit = Install-Setup $installDir
    $app = Start-Process -FilePath (Join-Path $installDir 'Lights Out.exe') -ArgumentList @('--minimized', '--no-auto-start', '--test-quit-after-start=2500', "--user-data-dir=$userData") -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and (Get-ScopedLightsOutProcesses $installDir).Count -gt 0) { Start-Sleep -Milliseconds 150 }
    Stop-ScopedLightsOut $installDir
    Start-Sleep -Milliseconds 500
    $result.uninstallExit = Uninstall-Setup $installDir
    Wait-UntilRemoved $installDir 10
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.registryKeyPresent = Get-RegistryKeyPresent
    $result.processesAfter = (Get-ScopedLightsOutProcesses $installDir).Count
    $regOk = if ($TestRegistration) { -not $result.registryKeyPresent } else { $true }
    $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0 -and $result.processesAfter -eq 0 -and $regOk)
  } finally {
    $env:LIGHTS_OUT_SUPPRESS_TRAY = $oldSuppress
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioC {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $userData = Join-Path $root 'userData'
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $oldSuppress = $env:LIGHTS_OUT_SUPPRESS_TRAY
  $env:LIGHTS_OUT_SUPPRESS_TRAY = '1'
  $result = @{ scenario = 'C'; description = 'Install, launch, leave running, uninstall (should abort and keep files intact)' }
  try {
    $result.installExit = Install-Setup $installDir
    Start-Process -FilePath (Join-Path $installDir 'Lights Out.exe') -ArgumentList @('--minimized', '--no-auto-start', "--user-data-dir=$userData") -WindowStyle Hidden -PassThru | Out-Null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and (Get-ScopedLightsOutProcesses $installDir).Count -eq 0) { Start-Sleep -Milliseconds 150 }
    Start-Sleep -Seconds 2
    $result.uninstallExit = Uninstall-Setup $installDir
    Start-Sleep -Seconds 2
    $result.exeStillPresent = Test-Path -LiteralPath (Join-Path $installDir 'Lights Out.exe')
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.registryKeyPresent = Get-RegistryKeyPresent
    $regOk = if ($TestRegistration) { $result.registryKeyPresent } else { $true }
    # Note: NSIS outer Uninstall.exe spawns temp Au_.exe asynchronously; even if outer returns 0,
    # un.onInit aborts before deleting any file, so Lights Out.exe and full install must remain intact.
    $result.pass = ($result.installExit -eq 0 -and $result.exeStillPresent -and $result.leftoverCount -gt 50 -and $regOk)
  } finally {
    $env:LIGHTS_OUT_SUPPRESS_TRAY = $oldSuppress
    Stop-ScopedLightsOut $installDir
    # Clean up the still-intact QA install properly via Uninstall.exe so nothing is orphaned
    if (Test-Path -LiteralPath (Join-Path $installDir 'Uninstall.exe')) {
      Uninstall-Setup $installDir | Out-Null
      Wait-UntilRemoved $installDir 8
    }
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioD {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $userData = Join-Path $root 'userData'
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $oldSuppress = $env:LIGHTS_OUT_SUPPRESS_TRAY
  $env:LIGHTS_OUT_SUPPRESS_TRAY = '1'
  $result = @{ scenario = 'D'; description = 'Install, launch, taskkill QA PID, uninstall' }
  try {
    $result.installExit = Install-Setup $installDir
    $app = Start-Process -FilePath (Join-Path $installDir 'Lights Out.exe') -ArgumentList @('--minimized', '--no-auto-start', "--user-data-dir=$userData") -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and (Get-ScopedLightsOutProcesses $installDir).Count -eq 0) { Start-Sleep -Milliseconds 150 }
    Start-Sleep -Seconds 2
    Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/F', '/T', '/PID', "$($app.Id)") -WindowStyle Hidden -Wait | Out-Null
    Stop-ScopedLightsOut $installDir
    Start-Sleep -Seconds 1
    $result.uninstallExit = Uninstall-Setup $installDir
    Wait-UntilRemoved $installDir 10
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.registryKeyPresent = Get-RegistryKeyPresent
    $result.processesAfter = (Get-ScopedLightsOutProcesses $installDir).Count
    $regOk = if ($TestRegistration) { -not $result.registryKeyPresent } else { $true }
    $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0 -and $result.processesAfter -eq 0 -and $regOk)
  } finally {
    $env:LIGHTS_OUT_SUPPRESS_TRAY = $oldSuppress
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioE {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $result = @{ scenario = 'E'; description = 'Install over existing install (upgrade/reinstall) then uninstall' }
  try {
    $result.installExit = Install-Setup $installDir
    Start-Sleep -Seconds 1
    $result.install2Exit = Install-Setup $installDir
    $result.filesAfterReinstall = Get-RemainingCount $installDir
    $result.uninstallExit = Uninstall-Setup $installDir
    Wait-UntilRemoved $installDir 10
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.pass = ($result.installExit -eq 0 -and $result.install2Exit -eq 0 -and $result.filesAfterReinstall -gt 50 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0)
  } finally {
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioF {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $sibling = Join-Path $installDir 'keep-me.txt'
  $result = @{ scenario = 'F'; description = 'Manifest-only uninstall preserves unrelated sibling files (never RMDir /r)' }
  try {
    $result.installExit = Install-Setup $installDir
    Set-Content -LiteralPath $sibling -Value 'owner-data-must-survive' -Encoding utf8
    $result.uninstallExit = Uninstall-Setup $installDir
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline -and (Test-Path -LiteralPath (Join-Path $installDir 'Lights Out.exe'))) { Start-Sleep -Milliseconds 200 }
    Start-Sleep -Milliseconds 500
    $result.exeRemoved = -not (Test-Path -LiteralPath (Join-Path $installDir 'Lights Out.exe'))
    $result.siblingSurvived = (Test-Path -LiteralPath $sibling) -and ((Get-Content -LiteralPath $sibling -Raw).Trim() -eq 'owner-data-must-survive')
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.exeRemoved -and $result.siblingSurvived -and $result.leftoverCount -eq 1)
  } finally {
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioG {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  # Files only an older build shipped (v11.2.0 shipped sharp and its libvips DLLs); the new
  # manifest-only uninstaller does not know them, so the upgrade itself must remove them.
  $staleFiles = @(
    (Join-Path $installDir 'resources\app\node_modules\sharp\lib\index.js'),
    (Join-Path $installDir 'resources\app\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll'),
    (Join-Path $installDir 'locales\stale-older-build.pak')
  )
  $sibling = Join-Path $installDir 'keep-me.txt'
  $result = @{ scenario = 'G'; description = 'Upgrade over an older build removes its app-owned runtime files, keeps other files, then uninstalls cleanly' }
  try {
    $result.installExit = Install-Setup $installDir
    foreach ($stale in $staleFiles) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $stale) -Force | Out-Null
      Set-Content -LiteralPath $stale -Value 'stale-from-older-build' -Encoding utf8
    }
    Set-Content -LiteralPath $sibling -Value 'owner-data-must-survive' -Encoding utf8
    $result.upgradeExit = Install-Setup $installDir
    $result.staleLeftAfterUpgrade = @($staleFiles | Where-Object { Test-Path -LiteralPath $_ }).Count
    $result.siblingSurvivedUpgrade = Test-Path -LiteralPath $sibling
    $result.exeAfterUpgrade = Test-Path -LiteralPath (Join-Path $installDir 'Lights Out.exe')
    $result.uninstallExit = Uninstall-Setup $installDir
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline -and (Test-Path -LiteralPath (Join-Path $installDir 'Lights Out.exe'))) { Start-Sleep -Milliseconds 200 }
    Start-Sleep -Milliseconds 500
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.siblingSurvived = Test-Path -LiteralPath $sibling
    $result.pass = ($result.installExit -eq 0 -and $result.upgradeExit -eq 0 -and $result.staleLeftAfterUpgrade -eq 0 -and $result.siblingSurvivedUpgrade -and $result.exeAfterUpgrade -and
      $result.uninstallExit -eq 0 -and $result.siblingSurvived -and $result.leftoverCount -eq 1)
  } finally {
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Invoke-ScenarioH {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $result = @{ scenario = 'H'; description = 'Install the previous release, upgrade with this build, uninstall: nothing left'; previousSetupExe = $PreviousSetupExe }
  try {
    # The previous installer honours LIGHTS_OUT_INSTALLER_QA too (v11.2.0 does), so it registers nothing.
    $previous = Start-Process -FilePath $PreviousSetupExe -ArgumentList @('/S', "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
    $result.previousInstallExit = $previous.ExitCode
    $result.filesAfterPrevious = Get-RemainingCount $installDir
    $result.upgradeExit = Install-Setup $installDir
    $result.uninstallExit = Uninstall-Setup $installDir
    Wait-UntilRemoved $installDir 10
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.pass = ($result.previousInstallExit -eq 0 -and $result.filesAfterPrevious -gt 50 -and $result.upgradeExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0)
  } finally {
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

function Get-RegistryValuePresent([string]$Key, [string]$Name) {
  return $null -ne (Get-ItemProperty -LiteralPath $Key -Name $Name -ErrorAction SilentlyContinue)
}

# The program a per-user task launches, or $null when there is no such task.
function Get-UserTaskExecute([string]$Name) {
  $task = Get-ScheduledTask -TaskPath '\' -TaskName $Name -ErrorAction SilentlyContinue
  if ($task) { return [string](@($task.Actions)[0].Execute) }
  return $null
}

# A disabled fixture task, due only in a year, so it can never run during or after the matrix.
function Register-FixtureTask([string]$Name, [string]$Execute) {
  $action = New-ScheduledTaskAction -Execute $Execute -Argument '--minimized --no-auto-start'
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(1)
  $settings = New-ScheduledTaskSettingsSet -Disable
  Register-ScheduledTask -TaskPath '\' -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Description 'Lights Out uninstall matrix fixture (disabled)' | Out-Null
}

function Invoke-ScenarioI {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $exe = Join-Path $installDir 'Lights Out.exe'
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
  # Another Lights Out copy's login item under the package.json-name form, which the uninstaller
  # also checks: it launches a different exe, so this uninstall must leave it alone.
  $foreignName = "electron.app.$($pkg.name)"
  $otherExe = Join-Path $root 'Other Copy\Lights Out.exe'
  $created = @()
  # Scheduled tasks under the real per-user names (the top-level refusal guarantees neither existed):
  # the watchdog in the quoted schtasks /TR form watchdog.js writes, launching this install, must be
  # removed; the First Light task in the unquoted form alarm.js writes, launching another copy, kept.
  $ownedTask = 'LightsOut-AutopilotWatchdog'
  $ownedTaskExecute = '"' + $exe + '"'
  $foreignTask = 'LightsOut_FirstLight'
  $foreignTaskExecute = $otherExe
  $plantedTasks = @{}
  $result = @{ scenario = 'I'; description = 'Uninstall removes the Run-at-login value and the scheduled task that launch this install, and keeps another copy''s' }
  try {
    $result.installExit = Install-Setup $installDir
    # app.setLoginItemSettings() without a name writes the value under the default AppUserModelId,
    # which Electron builds from the running exe's ProductName: electron.app.<ProductName>.
    $valueName = 'electron.app.' + (Get-Item -LiteralPath $exe).VersionInfo.ProductName
    $result.valueName = $valueName
    $result.foreignValueName = $foreignName
    foreach ($name in @($valueName, $foreignName)) {
      if ((Get-RegistryValuePresent $runKey $name) -or (Get-RegistryValuePresent $approvedKey $name)) {
        $result.refused = "a '$name' login item already exists on this machine; nothing was planted"
      }
    }
    if ($valueName -eq $foreignName) { $result.refused = "the exe ProductName gives the same value name as the package.json name ($valueName)" }
    if (-not $result.refused) {
      if (-not (Test-Path -LiteralPath $approvedKey)) { New-Item -Path $approvedKey -Force | Out-Null }
      $enabled = [byte[]](2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      $created = @($valueName, $foreignName)
      New-ItemProperty -LiteralPath $runKey -Name $valueName -PropertyType String -Value ('"' + $exe + '" --minimized --no-auto-start') | Out-Null
      New-ItemProperty -LiteralPath $approvedKey -Name $valueName -PropertyType Binary -Value $enabled | Out-Null
      New-ItemProperty -LiteralPath $runKey -Name $foreignName -PropertyType String -Value ('"' + $otherExe + '" --minimized --no-auto-start') | Out-Null
      New-ItemProperty -LiteralPath $approvedKey -Name $foreignName -PropertyType Binary -Value $enabled | Out-Null
      $plantedTasks[$ownedTask] = $ownedTaskExecute
      Register-FixtureTask $ownedTask $ownedTaskExecute
      $plantedTasks[$foreignTask] = $foreignTaskExecute
      Register-FixtureTask $foreignTask $foreignTaskExecute
    }
    # Uninstall even when refused, so the registration this install wrote is cleaned up. The
    # uninstaller deletes a login item only when it launches this install's exe.
    $result.uninstallExit = Uninstall-Setup $installDir
    Wait-UntilRemoved $installDir 10
    $result.runValueRemoved = -not (Get-RegistryValuePresent $runKey $valueName)
    $result.approvedValueRemoved = -not (Get-RegistryValuePresent $approvedKey $valueName)
    $result.foreignRunValueKept = Get-RegistryValuePresent $runKey $foreignName
    $result.foreignApprovedValueKept = Get-RegistryValuePresent $approvedKey $foreignName
    $result.ownedTaskRemoved = -not (Test-UserTaskPresent $ownedTask)
    $result.foreignTaskKept = (Get-UserTaskExecute $foreignTask) -eq $foreignTaskExecute
    $result.leftoverCount = Get-RemainingCount $installDir
    $result.pass = (-not $result.refused -and $result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.runValueRemoved -and
      $result.approvedValueRemoved -and $result.foreignRunValueKept -and $result.foreignApprovedValueKept -and
      $result.ownedTaskRemoved -and $result.foreignTaskKept -and $result.leftoverCount -eq 0)
  } finally {
    foreach ($name in $created) {
      Remove-ItemProperty -LiteralPath $runKey -Name $name -ErrorAction SilentlyContinue
      Remove-ItemProperty -LiteralPath $approvedKey -Name $name -ErrorAction SilentlyContinue
    }
    # Remove only a fixture task that still launches what the matrix planted.
    foreach ($name in @($plantedTasks.Keys)) {
      if ((Get-UserTaskExecute $name) -eq $plantedTasks[$name]) {
        Unregister-ScheduledTask -TaskPath '\' -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
      }
    }
    Stop-ScopedLightsOut $installDir
    Remove-TestRoot $root
  }
  return $result
}

$results = @()
$oldQa = $env:LIGHTS_OUT_INSTALLER_QA
$oldPowerLock = $env:LIGHTS_OUT_QA_POWER_LOCK
try {
  # Installers, uninstallers and every app launch below inherit these (Start-Process passes the
  # current environment). Only -TestRegistration lets the installer register; the power lock
  # stays on regardless, so no launched app touches power or the owner's scheduled tasks.
  $env:LIGHTS_OUT_INSTALLER_QA = if ($TestRegistration) { $null } else { '1' }
  $env:LIGHTS_OUT_QA_POWER_LOCK = '1'
  $results += Invoke-ScenarioA
  $results += Invoke-ScenarioB
  $results += Invoke-ScenarioC
  $results += Invoke-ScenarioD
  $results += Invoke-ScenarioE
  $results += Invoke-ScenarioF
  $results += Invoke-ScenarioG
  if ($PreviousSetupExe) { $results += Invoke-ScenarioH }
  if ($TestRegistration) { $results += Invoke-ScenarioI }
} finally {
  $env:LIGHTS_OUT_INSTALLER_QA = $oldQa
  $env:LIGHTS_OUT_QA_POWER_LOCK = $oldPowerLock
}

$report = @{
  generatedAt = (Get-Date -Format 'o')
  version = $version
  setupExe = $SetupExe
  qaIsolated = (-not $TestRegistration)
  qaPowerLock = $true
  scenarios = $results
  summary = @{
    total = $results.Count
    passed = ($results | Where-Object { $_.pass }).Count
    failed = ($results | Where-Object { -not $_.pass }).Count
  }
} | ConvertTo-Json -Depth 10

$report | Out-File -FilePath $ReportPath -Encoding utf8
Write-Host "`nUninstall matrix report: $ReportPath" -ForegroundColor Cyan
Write-Host $report

$failed = $results | Where-Object { -not $_.pass }
if ($failed) { exit 1 }
