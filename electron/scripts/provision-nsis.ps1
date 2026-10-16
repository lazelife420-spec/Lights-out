param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'LightsOut-build-tools\nsis-3.0.4.1'))
$ErrorActionPreference = 'Stop'
$url = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z'
# Published by electron-builder v26.0.12's nsisUtil.ts for this exact archive.
$expected = 'VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q=='
New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
$archive = Join-Path $CacheRoot 'nsis-3.0.4.1.7z'
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
}
$bytes = [IO.File]::ReadAllBytes($archive)
$hasher = [Security.Cryptography.SHA512]::Create()
try { $actual = [Convert]::ToBase64String($hasher.ComputeHash($bytes)) } finally { $hasher.Dispose() }
if ($actual -ne $expected) { throw 'NSIS archive integrity mismatch; nothing extracted or executed.' }
$sevenZip = (Get-Command 7z.exe -ErrorAction SilentlyContinue).Source
if (-not $sevenZip -and (Test-Path -LiteralPath "$env:ProgramFiles\7-Zip\7z.exe")) { $sevenZip = "$env:ProgramFiles\7-Zip\7z.exe" }
if (-not $sevenZip) {
    $cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\7zip@1.0.0'
    if (Test-Path -LiteralPath $cache) { $sevenZip = (Get-ChildItem -LiteralPath $cache -Filter 7za.exe -Recurse -File | Select-Object -First 1).FullName }
}
if (-not $sevenZip) { throw 'An existing 7-Zip command is required to extract the verified archive.' }
& $sevenZip x -y "-o$CacheRoot" $archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'NSIS archive extraction failed.' }
if (-not (Test-Path -LiteralPath (Join-Path $CacheRoot 'Bin\makensis.exe'))) { throw 'Pinned NSIS compiler missing.' }
$env:LIGHTS_OUT_NSIS_ROOT = $CacheRoot
if ($env:GITHUB_ENV) { "LIGHTS_OUT_NSIS_ROOT=$CacheRoot" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8 }
Write-Host 'Pinned NSIS archive verified and provisioned.'
