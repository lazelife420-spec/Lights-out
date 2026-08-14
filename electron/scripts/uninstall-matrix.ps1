# Repeatable uninstall/install matrix for Lights Out native Windows packaging.
# Scenarios:
# A - Install, no launch, uninstall
# B - Install, launch, clean quit via --test-quit-after-start, uninstall
# C - Install, launch, leave running, uninstall (expected abort)
# D - Install, launch, taskkill /F /T, uninstall
# E - Install, then install over same directory (upgrade/reinstall)

param(
  [string]$SetupExe = (Resolve-Path (Join-Path (Join-Path (Join-Path (Join-Path $PSScriptRoot '..') '..') 'dist-native') 'Lights-Out-Setup-11.1.2.exe')),
  [string]$ReportPath = (Join-Path $env:TEMP 'lightsout-uninstall-matrix.json')
)

$ErrorActionPreference = 'Stop'
$results = @()

function Test-LightsOutRunning {
  return (Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count -gt 0
}

function Stop-AllLightsOut {
  while ((Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count -gt 0) {
    Get-Process 'Lights Out' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 200
  }
}

function New-TestRoot {
  $guid = [guid]::NewGuid().ToString('n')
  $root = Join-Path $env:TEMP "lo-matrix-$guid"
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  return $root
}

function Install-Setup {
  param($Root, $Dir, [ref]$Log)
  $installLog = Join-Path $Root 'install.log'
  $Log.Value = $installLog
  $proc = Start-Process -FilePath $SetupExe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=`"$Dir`"","/LOG=`"$installLog`"" -Wait -PassThru
  return $proc.ExitCode
}

function Uninstall-Setup {
  param($Dir, [ref]$Log)
  $uninstallLog = Join-Path (Split-Path $Dir -Parent) 'uninstall.log'
  $Log.Value = $uninstallLog
  $unins = Join-Path $Dir 'unins000.exe'
  if (-not (Test-Path $unins)) { return $null }
  $proc = Start-Process -FilePath $unins -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$uninstallLog`"" -Wait -PassThru
  return $proc.ExitCode
}

function Get-RemainingCount {
  param($Dir)
  if (-not (Test-Path $Dir)) { return 0 }
  return (Get-ChildItem $Dir -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
}

function Get-RegistryKeyPresent {
  $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.lightsout.sleep-timer_is1'
  return Test-Path $regPath
}

function Invoke-ScenarioA {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $installLog = $null
  $uninstallLog = $null
  $result = @{ scenario = 'A'; description = 'Install, no launch, uninstall' }
  try {
    $result.installExit = Install-Setup -Root $root -Dir $installDir -Log ([ref]$installLog)
    $result.uninstallExit = Uninstall-Setup -Dir $installDir -Log ([ref]$uninstallLog)
  } finally { }
  Start-Sleep -Seconds 2
  $result.leftoverCount = Get-RemainingCount -Dir $installDir
  $result.registryKeyPresent = Get-RegistryKeyPresent
  $result.processesAfter = (Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count
  Stop-AllLightsOut
  $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0 -and -not $result.registryKeyPresent)
  return $result
}

function Invoke-ScenarioB {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $userData = Join-Path $root 'userData'
  $installLog = $null
  $uninstallLog = $null
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $env:LIGHTS_OUT_SUPPRESS_TRAY = '1'
  $result = @{ scenario = 'B'; description = 'Install, launch, clean quit, uninstall' }
  try {
    $result.installExit = Install-Setup -Root $root -Dir $installDir -Log ([ref]$installLog)
    $app = Start-Process -FilePath (Join-Path $installDir 'Lights Out.exe') -ArgumentList '--test-quit-after-start=3000',"--user-data-dir=`"$userData`"" -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and (Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 100 }
    if (Get-Process -Id $app.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $app.Id -Force }
    Start-Sleep -Seconds 2
    $result.uninstallExit = Uninstall-Setup -Dir $installDir -Log ([ref]$uninstallLog)
  } finally { $env:LIGHTS_OUT_SUPPRESS_TRAY = $null }
  Start-Sleep -Seconds 2
  $result.leftoverCount = Get-RemainingCount -Dir $installDir
  $result.registryKeyPresent = Get-RegistryKeyPresent
  $result.processesAfter = (Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count
  Stop-AllLightsOut
  $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0 -and -not $result.registryKeyPresent)
  return $result
}

function Invoke-ScenarioC {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $userData = Join-Path $root 'userData'
  $installLog = $null
  $uninstallLog = $null
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $env:LIGHTS_OUT_SUPPRESS_TRAY = '1'
  $result = @{ scenario = 'C'; description = 'Install, launch, leave running, uninstall (should abort)' }
  try {
    $result.installExit = Install-Setup -Root $root -Dir $installDir -Log ([ref]$installLog)
    Start-Process -FilePath (Join-Path $installDir 'Lights Out.exe') -ArgumentList '--minimized',"--user-data-dir=`"$userData`"" -PassThru | Out-Null
    Start-Sleep -Seconds 5
    $result.uninstallExit = Uninstall-Setup -Dir $installDir -Log ([ref]$uninstallLog)
  } finally { $env:LIGHTS_OUT_SUPPRESS_TRAY = $null }
  Start-Sleep -Seconds 2
  Stop-AllLightsOut
  $result.leftoverCount = Get-RemainingCount -Dir $installDir
  $result.registryKeyPresent = Get-RegistryKeyPresent
  $result.processesAfter = (Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count
  # Scenario C is expected to abort (non-zero exit) and leave files intact
  $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -ne 0 -and $result.leftoverCount -gt 600 -and $result.registryKeyPresent)
  return $result
}

function Invoke-ScenarioD {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $userData = Join-Path $root 'userData'
  $installLog = $null
  $uninstallLog = $null
  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $env:LIGHTS_OUT_SUPPRESS_TRAY = '1'
  $result = @{ scenario = 'D'; description = 'Install, launch, taskkill /F /T, uninstall' }
  try {
    $result.installExit = Install-Setup -Root $root -Dir $installDir -Log ([ref]$installLog)
    Start-Process -FilePath (Join-Path $installDir 'Lights Out.exe') -ArgumentList '--minimized',"--user-data-dir=`"$userData`"" -PassThru | Out-Null
    Start-Sleep -Seconds 5
    Start-Process -FilePath 'taskkill' -ArgumentList '/F','/T','/IM','"Lights Out.exe"' -Wait
    Start-Sleep -Seconds 3
    $result.uninstallExit = Uninstall-Setup -Dir $installDir -Log ([ref]$uninstallLog)
  } finally { $env:LIGHTS_OUT_SUPPRESS_TRAY = $null }
  Start-Sleep -Seconds 2
  $result.leftoverCount = Get-RemainingCount -Dir $installDir
  $result.registryKeyPresent = Get-RegistryKeyPresent
  $result.processesAfter = (Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count
  Stop-AllLightsOut
  $result.pass = ($result.installExit -eq 0 -and $result.uninstallExit -eq 0 -and $result.leftoverCount -eq 0 -and -not $result.registryKeyPresent)
  return $result
}

function Invoke-ScenarioE {
  $root = New-TestRoot
  $installDir = Join-Path $root 'Programs\Lights Out'
  $installLog1 = $null
  $installLog2 = $null
  $result = @{ scenario = 'E'; description = 'Install over existing per-user install' }
  $result.installExit = Install-Setup -Root $root -Dir $installDir -Log ([ref]$installLog1)
  Start-Sleep -Seconds 1
  $result.install2Exit = Install-Setup -Root $root -Dir $installDir -Log ([ref]$installLog2)
  $result.leftoverCount = Get-RemainingCount -Dir $installDir
  $result.registryKeyPresent = Get-RegistryKeyPresent
  $result.processesAfter = (Get-Process 'Lights Out' -ErrorAction SilentlyContinue).Count
  Stop-AllLightsOut
  $result.pass = ($result.installExit -eq 0 -and $result.install2Exit -eq 0 -and $result.leftoverCount -gt 0 -and $result.registryKeyPresent)
  return $result
}

Stop-AllLightsOut

$results += Invoke-ScenarioA
$results += Invoke-ScenarioB
$results += Invoke-ScenarioC
$results += Invoke-ScenarioD
$results += Invoke-ScenarioE

$report = @{
  generatedAt = (Get-Date -Format 'o')
  setupExe = $SetupExe
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
