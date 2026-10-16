param([string]$OutputRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'dist-native'))
$ErrorActionPreference = 'Stop'
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$manifest = Get-Content -LiteralPath (Join-Path $OutputRoot 'BUILD-MANIFEST.json') -Raw | ConvertFrom-Json
& node (Join-Path $PSScriptRoot 'release-artifacts.js') verify $OutputRoot
if ($LASTEXITCODE -ne 0) { throw 'Artifact verification failed.' }
if ($manifest.artifacts.Count -ne 2) { throw 'Both Windows distribution formats are required.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipName = "Lights-Out-Portable-v$($manifest.version)-win-x64.zip"
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $OutputRoot $zipName))
try {
    if ($zip.Entries.Count -ne $manifest.runtime.Count) { throw 'Portable ZIP inventory differs from staged runtime.' }
    foreach ($file in $manifest.runtime) {
        $entry = $zip.GetEntry($file.path)
        if ($null -eq $entry) { throw "Portable entry missing: $($file.path)" }
        if ($entry.FullName.StartsWith('/') -or $entry.FullName -match '(^|/)\.\.(/|$)') { throw 'Unsafe archive path.' }
        $stream = $entry.Open()
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $hash.Dispose() }
        if ($digest -ne $file.sha256) { throw "Portable entry hash mismatch: $($file.path)" }
    }
} finally { $zip.Dispose() }
$qaRoot = Join-Path $OutputRoot ('installer-qa-' + [Guid]::NewGuid().ToString('N'))
if (-not $qaRoot.StartsWith($OutputRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $qaRoot)) { throw 'Unsafe installer QA directory.' }
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$installRoot = Join-Path $qaRoot 'app'
$oldQa = $env:LIGHTS_OUT_INSTALLER_QA
$oldExe = $env:LIGHTS_OUT_PACKAGED_EXE
$env:LIGHTS_OUT_INSTALLER_QA = '1'
try {
    $setup = Join-Path $OutputRoot "Lights-Out-Setup-v$($manifest.version).exe"
    $installed = Start-Process -FilePath $setup -ArgumentList @('/S',"/D=$installRoot") -WindowStyle Hidden -Wait -PassThru
    if ($installed.ExitCode -ne 0) { throw "Installer failed: $($installed.ExitCode)" }
    foreach ($file in $manifest.runtime) {
        $actual = (Get-FileHash -LiteralPath (Join-Path $installRoot $file.path) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $file.sha256) { throw "Installed file differs: $($file.path)" }
    }
    $env:LIGHTS_OUT_PACKAGED_EXE = Join-Path $installRoot 'Lights Out.exe'
    & node (Join-Path $PSScriptRoot 'settings-layout-runtime-proof.js')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application runtime proof failed.' }
    $removed = Start-Process -FilePath (Join-Path $installRoot 'Uninstall.exe') -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru
    if ($removed.ExitCode -ne 0) { throw 'QA uninstall failed.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ((Test-Path -LiteralPath $installRoot) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath $installRoot) { throw 'QA uninstall left installation files.' }
} finally {
    $env:LIGHTS_OUT_INSTALLER_QA = $oldQa
    $env:LIGHTS_OUT_PACKAGED_EXE = $oldExe
}
$report = @{ status='passed'; version=$manifest.version; portableEntries=$manifest.runtime.Count; installerFilesMatched=$manifest.runtime.Count; installedRuntime='60 settings layout checks'; qaUninstalled=$true; productionRegistrationTouched=$false }
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputRoot 'WINDOWS-VERIFICATION.json') -Encoding utf8
$report | ConvertTo-Json
