#!/usr/bin/env pwsh
# Builds the native Windows runtime, deterministic portable ZIP, NSIS installer,
# checksums and source/artifact provenance. Never runs the application.
param(
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$OutputRoot = (Join-Path (Join-Path $SourceRoot '..') 'dist-native'),
    [string]$PackageName = 'Lights Out',
    [string]$Version = (Get-Content (Join-Path $SourceRoot 'package.json') | ConvertFrom-Json).version,
    [switch]$DryRun,
    [switch]$SkipZip,
    [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$repositoryRoot = Split-Path -Parent $SourceRoot
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (-not $OutputRoot.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path -Leaf $OutputRoot).StartsWith('dist-native', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Packaging output must be a dist-native* directory inside the source repository.'
}
$UnpackedDir = Join-Path $OutputRoot 'win-unpacked'
$AppDir = Join-Path (Join-Path $UnpackedDir 'resources') 'app'

function Remove-IfExists($Path) {
    if ([IO.Path]::GetFullPath($Path) -ne $OutputRoot) { throw 'Refusing to clean an unverified build path.' }
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

function Normalize-ZipTimestamps {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "Timestamp normalization root is missing: $Root"
  }

  $epoch = [datetime]::SpecifyKind([datetime]'2000-01-01T12:00:00', [DateTimeKind]::Utc)
  foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) { $item.LastWriteTimeUtc = $epoch }
  Write-Host 'Normalized staged timestamps for reproducible archives.'
}

function Write-PortableZip($Root, $Destination) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $names = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($Root.Length + 1).Replace('\','/') })
    [Array]::Sort($names, [StringComparer]::Ordinal)
    foreach ($name in $names) {
      $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [DateTimeOffset]'2000-01-01T12:00:00+00:00'
      $inputStream = [IO.File]::OpenRead((Join-Path $Root $name))
      $outputStream = $entry.Open()
      try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
    }
  } finally { $archive.Dispose() }
}

# 1. Clean staging
Remove-IfExists $OutputRoot
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null

# 2. Read package metadata
$package = Get-Content (Join-Path $SourceRoot 'package.json') | ConvertFrom-Json
if ($Version -ne $package.version) { throw 'Build version must match package.json.' }
$fileList = & node (Join-Path $PSScriptRoot 'app-source-files.js') $SourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Application source inventory failed.' }
$files = $fileList | ConvertFrom-Json

# 3. Copy listed application files
foreach ($relative in $files) {
    $src = Join-Path $SourceRoot $relative
    $dst = Join-Path $AppDir $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
# 4. Copy package manifests and install production dependencies
Copy-Item (Join-Path $SourceRoot 'package.json') (Join-Path $AppDir 'package.json') -Force
Copy-Item (Join-Path $SourceRoot 'package-lock.json') (Join-Path $AppDir 'package-lock.json') -Force
Push-Location $AppDir
& npm ci --omit=dev --no-audit --no-fund
$dependencyExit = $LASTEXITCODE
Pop-Location
if ($dependencyExit -ne 0) { throw "Production dependency installation failed: $dependencyExit" }
Remove-Item (Join-Path $AppDir 'package-lock.json') -ErrorAction SilentlyContinue

# 4b. Remove non-runtime package artifacts from production node_modules
$nodeModulesDir = Join-Path $AppDir 'node_modules'
if (Test-Path $nodeModulesDir) {
    $cleanupPatterns = @('test', 'tests', '__tests__', 'docs', 'doc', 'examples', 'example', 'demo', '.github', '*.map')
    foreach ($pattern in $cleanupPatterns) {
        foreach ($candidate in @(Get-ChildItem -LiteralPath $nodeModulesDir -Recurse -Filter $pattern -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)) {
            if (-not $candidate.FullName.StartsWith($nodeModulesDir + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Dependency cleanup escaped staged node_modules.' }
            if (Test-Path -LiteralPath $candidate.FullName) { Remove-Item -LiteralPath $candidate.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}

# 5. Copy provisioned Electron runtime
$electronDist = Join-Path (Join-Path (Join-Path $SourceRoot 'node_modules') 'electron') 'dist'
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

# 7. Stamp Lights Out Windows identity on the staged executable
$stampScript = Join-Path $PSScriptRoot 'stamp-windows-identity.ps1'
if (Test-Path $stampScript) {
    & $stampScript -SourceRoot $SourceRoot -ExePath $newExe -IconPath (Join-Path $SourceRoot 'assets\icon.ico')
} else {
    Write-Warning 'stamp-windows-identity.ps1 not found; executable branding skipped.'
}

# 8. Verify the executable identity
$verifyScript = Join-Path $PSScriptRoot 'verify-windows-identity.ps1'
if (Test-Path $verifyScript) {
    & $verifyScript -ExePath $newExe
}

# 9. Produce deterministic distribution artifacts.
Normalize-ZipTimestamps -Root $UnpackedDir
if (-not $SkipZip) {
    $zipName = "Lights-Out-Portable-v$Version-win-x64.zip"
    $zipPath = Join-Path $OutputRoot $zipName
    Write-PortableZip $UnpackedDir $zipPath
    Write-Host "Portable ZIP: $zipPath" -ForegroundColor Cyan
}
if (-not $SkipInstaller) {
    if (-not $env:LIGHTS_OUT_NSIS_ROOT) { & (Join-Path $PSScriptRoot 'provision-nsis.ps1') }
    $compiler = Join-Path $env:LIGHTS_OUT_NSIS_ROOT 'Bin\makensis.exe'
    $setup = Join-Path $OutputRoot "Lights-Out-Setup-v$Version.exe"
    & $compiler '/V2' "/DVERSION=$Version" "/DAPP_DIR=$UnpackedDir" "/DAPP_ICON=$(Join-Path $SourceRoot 'assets\icon.ico')" "/DOUTPUT_FILE=$setup" (Join-Path $PSScriptRoot 'windows-installer.nsi')
    if ($LASTEXITCODE -ne 0) { throw "NSIS installer build failed: $LASTEXITCODE" }
    Write-Host "Windows installer: $setup" -ForegroundColor Cyan
}
& node (Join-Path $PSScriptRoot 'release-artifacts.js') create $OutputRoot
if ($LASTEXITCODE -ne 0) { throw 'Release artifact manifest/checksum generation failed.' }

Write-Host "Native packaging complete: $UnpackedDir" -ForegroundColor Green
