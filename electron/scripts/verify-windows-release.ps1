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
$oldPowerLock = $env:LIGHTS_OUT_QA_POWER_LOCK
$oldExe = $env:LIGHTS_OUT_PACKAGED_EXE
# The QA installer registers nothing, and the installed app the runtime proof launches inherits
# both flags: no real power action and no change to the owner's per-user scheduled tasks.
$env:LIGHTS_OUT_INSTALLER_QA = '1'
$env:LIGHTS_OUT_QA_POWER_LOCK = '1'
$layoutSummary = 'settings layout checks passed'
try {
    $setup = Join-Path $OutputRoot "Lights-Out-Setup-v$($manifest.version).exe"
    $installed = Start-Process -FilePath $setup -ArgumentList @('/S',"/D=$installRoot") -WindowStyle Hidden -Wait -PassThru
    if ($installed.ExitCode -ne 0) { throw "Installer failed: $($installed.ExitCode)" }
    foreach ($file in $manifest.runtime) {
        $stream = [IO.File]::OpenRead((Join-Path $installRoot $file.path))
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $hasher.Dispose() }
        if ($actual -ne $file.sha256) { throw "Installed file differs: $($file.path)" }
    }
    $env:LIGHTS_OUT_PACKAGED_EXE = Join-Path $installRoot 'Lights Out.exe'
    # Capture stdout only; the proof's stderr goes straight to the console. Under
    # $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 (what CI runs) turns every
    # redirected native stderr line into a terminating NativeCommandError, so 2>&1 here would
    # fail the gate on a benign Node warning and, on a real failure, hide the stack and the
    # PASS lines printed before it. The exit code alone decides the result.
    # Stream each stdout line as it arrives (diagnostics survive a hung proof)
    # and keep it for the summary; stderr stays unredirected (PS 5.1 + Stop).
    $proofOutput = @(& node (Join-Path $PSScriptRoot 'settings-layout-runtime-proof.js') | ForEach-Object { Write-Host $_; $_ })
    $proofExit = $LASTEXITCODE
    if ($proofExit -ne 0) { throw 'Installed application runtime proof failed.' }
    $countMatch = [regex]::Match(($proofOutput -join "`n"), 'PASS\s+(\d+)\s+category/theme/viewport layouts')
    if ($countMatch.Success) {
        $layoutSummary = "$($countMatch.Groups[1].Value) settings layout checks"
    }
    $removed = Start-Process -FilePath (Join-Path $installRoot 'Uninstall.exe') -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru
    if ($removed.ExitCode -ne 0) { throw 'QA uninstall failed.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ((Test-Path -LiteralPath $installRoot) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath $installRoot) { throw 'QA uninstall left installation files.' }
} finally {
    $env:LIGHTS_OUT_INSTALLER_QA = $oldQa
    $env:LIGHTS_OUT_QA_POWER_LOCK = $oldPowerLock
    $env:LIGHTS_OUT_PACKAGED_EXE = $oldExe
    if (Test-Path -LiteralPath $qaRoot) {
        Remove-Item -LiteralPath $qaRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
$report = @{ status='passed'; version=$manifest.version; portableEntries=$manifest.runtime.Count; installerFilesMatched=$manifest.runtime.Count; installedRuntime=$layoutSummary; qaUninstalled=$true; productionRegistrationTouched=$false }
$json = ($report | ConvertTo-Json) + "`n"
[IO.File]::WriteAllText((Join-Path $OutputRoot 'WINDOWS-VERIFICATION.json'), $json, [Text.UTF8Encoding]::new($false))
Write-Output $json.TrimEnd()
