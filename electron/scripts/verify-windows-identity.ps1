#!/usr/bin/env pwsh
# Verifies that the packaged Windows executable has the Lights Out identity
# and does not retain generic Electron branding.
param(
    [string]$ExePath = (Join-Path (Join-Path (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path '..') 'dist-native') 'win-unpacked\Lights Out.exe'),
    [string]$ExpectedCompanyName = 'The Proof Foundry',
    [string]$ExpectedProductName = 'Lights Out',
    [string]$ExpectedFileDescription = 'Lights Out',
    [string]$ExpectedInternalName = 'Lights Out',
    [string]$ExpectedOriginalFilename = 'Lights Out.exe',
    [string]$ExpectedFileVersion = '11.1.3.0',
    [string]$ExpectedProductVersion = '11.1.3'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $ExePath)) { throw "Executable not found: $ExePath" }

$vi = (Get-ItemProperty $ExePath).VersionInfo
$failures = @()

function Assert-Equal($Name, $Actual, $Expected) {
    if ($Actual -ne $Expected) {
        $script:failures += "$Name expected '$Expected' but got '$Actual'"
    }
}

Assert-Equal 'CompanyName' $vi.CompanyName $ExpectedCompanyName
Assert-Equal 'ProductName' $vi.ProductName $ExpectedProductName
Assert-Equal 'FileDescription' $vi.FileDescription $ExpectedFileDescription
Assert-Equal 'InternalName' $vi.InternalName $ExpectedInternalName
Assert-Equal 'OriginalFilename' $vi.OriginalFilename $ExpectedOriginalFilename
Assert-Equal 'FileVersion' $vi.FileVersion $ExpectedFileVersion
Assert-Equal 'ProductVersion' $vi.ProductVersion $ExpectedProductVersion

# Ensure no generic Electron identity remains where explicitly tracked.
$genericMarkers = @('GitHub, Inc.', 'electron.exe')
$brandingValues = @($vi.CompanyName, $vi.ProductName, $vi.FileDescription, $vi.InternalName, $vi.OriginalFilename)
foreach ($generic in $genericMarkers) {
    foreach ($value in $brandingValues) {
        if ($value -eq $generic) {
            $failures += "Generic identity remains: $value"
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "Windows identity verification FAILED:" -ForegroundColor Red
    foreach ($failure in $failures) { Write-Host "  - $failure" -ForegroundColor Red }
    throw "Windows identity verification failed."
}

Write-Host "Windows identity verification PASSED for: $ExePath" -ForegroundColor Green
