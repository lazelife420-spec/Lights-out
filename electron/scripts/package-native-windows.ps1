#!/usr/bin/env pwsh
# Dependency-minimal native Windows packaging evaluation script.
# Produces dist-native/win-unpacked (Electron runtime + resources/app) and a portable ZIP.
# Dry-run only: does not execute real power actions.
param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$OutputRoot = (Join-Path $SourceRoot '..' 'dist-native'),
    [string]$PackageName = 'Lights Out',
    [string]$Version = (Get-Content (Join-Path $SourceRoot 'package.json') | ConvertFrom-Json).version,
    [switch]$DryRun,
    [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'
$OutputRoot = (Resolve-Path $OutputRoot -ErrorAction SilentlyContinue).Path ?? $OutputRoot
$UnpackedDir = Join-Path $OutputRoot 'win-unpacked'
$AppDir = Join-Path $UnpackedDir 'resources' 'app'

function Remove-IfExists($Path) {
    if (Test-Path $Path) { Remove-Item -Recurse -Force $Path }
}

# 1. Clean staging
Remove-IfExists $OutputRoot
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null

# 2. Read package metadata
$package = Get-Content (Join-Path $SourceRoot 'package.json') | ConvertFrom-Json
$files = $package.build.files

# 3. Copy listed application files
foreach ($pattern in $files) {
    if ($pattern -like '!*') { continue }
    if ($pattern -match '^(.*)/\*\*$') {
        # Directory glob: preserve the directory structure with robocopy
        $dir = $Matches[1]
        $srcDir = Join-Path $SourceRoot $dir
        $dstDir = Join-Path $AppDir $dir
        if (Test-Path $srcDir -PathType Container) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
            $robocopy = Start-Process -FilePath 'robocopy.exe' -ArgumentList "`"$srcDir`" `"$dstDir`" /MIR /E /NDL /NFL /NP" -Wait -PassThru -NoNewWindow
            if ($robocopy.ExitCode -ge 8) { throw "robocopy failed with exit code $($robocopy.ExitCode)" }
        } else {
            Write-Warning "Skipping unmatched build.files directory pattern: $pattern"
        }
    } else {
        $src = Join-Path $SourceRoot $pattern
        if (Test-Path $src -PathType Container) {
            $dst = Join-Path $AppDir (Split-Path $pattern -Leaf)
            Copy-Item -Path $src -Destination $dst -Recurse -Force
        } elseif (Test-Path $src -PathType Leaf) {
            Copy-Item -Path $src -Destination $AppDir -Force
        } else {
            Write-Warning "Skipping unmatched build.files pattern: $pattern"
        }
    }
}

# 4. Copy package manifests and install production dependencies
Copy-Item (Join-Path $SourceRoot 'package.json') (Join-Path $AppDir 'package.json') -Force
Copy-Item (Join-Path $SourceRoot 'package-lock.json') (Join-Path $AppDir 'package-lock.json') -Force
Push-Location $AppDir
& npm ci --omit=dev --no-audit --no-fund
Pop-Location
Remove-Item (Join-Path $AppDir 'package-lock.json') -ErrorAction SilentlyContinue

# 5. Copy provisioned Electron runtime
$electronDist = Join-Path $SourceRoot 'node_modules' 'electron' 'dist'
if (-not (Test-Path $electronDist)) { throw "Electron dist not found. Run 'npm run electron:provision' first." }
Get-ChildItem -Path $electronDist -Force | Copy-Item -Destination $UnpackedDir -Recurse -Force

# 6. Rename executable if safe
$exe = Join-Path $UnpackedDir 'electron.exe'
$newExe = Join-Path $UnpackedDir "$PackageName.exe"
if (Test-Path $exe) {
    Move-Item -Path $exe -Destination $newExe -Force
} else {
    Write-Warning 'electron.exe not found; cannot rename launcher.'
}

# 7. Produce portable ZIP
if (-not $SkipZip) {
    $zipName = "Lights-Out-Portable-v$Version-win-x64.zip"
    $zipPath = Join-Path $OutputRoot $zipName
    Compress-Archive -Path "$UnpackedDir\*" -DestinationPath $zipPath -Force
    Write-Host "Portable ZIP: $zipPath" -ForegroundColor Cyan
}

Write-Host "Native packaging complete: $UnpackedDir" -ForegroundColor Green
