#!/usr/bin/env pwsh
# Stamps Lights Out Windows executable metadata and icon.
# Requires rcedit (existing binary only; do not install a new resource editor here).
param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$ExePath = (Join-Path (Join-Path (Join-Path $SourceRoot '..') 'dist-native') 'win-unpacked\Lights Out.exe'),
    [string]$IconPath = (Join-Path $SourceRoot 'assets\icon.ico'),
    [string]$CompanyName = 'The Proof Foundry',
    [string]$ProductName = 'Lights Out',
    [string]$FileDescription = 'Lights Out',
    [string]$InternalName = 'Lights Out',
    [string]$OriginalFilename = 'Lights Out.exe',
    [string]$FileVersion = '11.1.2.0',
    [string]$ProductVersion = '11.1.2',
    [string]$Copyright = 'Copyright (C) 2026 The Proof Foundry. All rights reserved.',
    [string]$RceditPath
)

$ErrorActionPreference = 'Stop'

if (-not $RceditPath) {
    $RceditPath = $env:RCEDIT_PATH
}

if (-not $RceditPath) {
    $candidatePaths = @(
        (Join-Path $SourceRoot 'node_modules\rcedit\bin\rcedit.exe'),
        (Join-Path $SourceRoot 'node_modules\electron-winstaller\vendor\rcedit.exe'),
        'rcedit.exe'
    )
    foreach ($candidate in $candidatePaths) {
        if ($candidate -eq 'rcedit.exe') {
            $found = Get-Command rcedit.exe -ErrorAction SilentlyContinue
            if ($found) { $RceditPath = $found.Source; break }
        } elseif (Test-Path $candidate) {
            $RceditPath = $candidate
            break
        }
    }
}

if (-not $RceditPath -or -not (Test-Path $RceditPath)) {
    throw @"
rcedit.exe not found. Set RCEDIT_PATH to an existing rcedit binary.
Recommended source (do not install without authorization):
  https://github.com/electron/rcedit/releases
This script will not download or install a resource editor.
"@
}

if (-not (Test-Path $ExePath)) { throw "Executable not found: $ExePath" }
if (-not (Test-Path $IconPath)) { throw "Icon not found: $IconPath" }

$arguments = @(
    $ExePath,
    '--set-version-string', 'CompanyName', $CompanyName,
    '--set-version-string', 'ProductName', $ProductName,
    '--set-version-string', 'FileDescription', $FileDescription,
    '--set-version-string', 'InternalName', $InternalName,
    '--set-version-string', 'OriginalFilename', $OriginalFilename,
    '--set-version-string', 'LegalCopyright', $Copyright,
    '--set-file-version', $FileVersion,
    '--set-product-version', $ProductVersion,
    '--set-icon', $IconPath
)

Write-Host "Stamping Windows identity on: $ExePath" -ForegroundColor Cyan
Write-Host "Using rcedit: $RceditPath" -ForegroundColor Cyan
& $RceditPath @arguments
if ($LASTEXITCODE -ne 0) { throw "rcedit failed with exit code $LASTEXITCODE" }

Write-Host "Stamping complete. Run verify-windows-identity.ps1 to validate." -ForegroundColor Green
