param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'LightsOut-build-tools\nsis-3.11'))
$ErrorActionPreference = 'Stop'

# Official Nullsoft NSIS 3.11 portable ZIP (verified SHA-256).
$nsisVersion = '3.11'
$url = 'https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11.zip/download'
$expectedSha256 = 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1'
$archivePrefix = "nsis-$nsisVersion/"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-StreamSha256Hex([IO.Stream]$Stream) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($hasher.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

function Get-FileSha256Hex([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try { return Get-StreamSha256Hex $stream } finally { $stream.Dispose() }
}

function Find-Makensis([string]$Root) {
    foreach ($candidate in @((Join-Path $Root 'Bin\makensis.exe'), (Join-Path $Root 'makensis.exe'))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

# Returns $null when $Root holds exactly the files of the archive's nsis-<version>/ tree,
# byte for byte, with nothing missing or added; otherwise a short reason. Only a
# hash-verified $Archive may be passed. This is what makes the compiler that actually
# runs (makensis.exe, its stubs, plugins and includes) the pinned one.
function Get-NsisTreeMismatch([string]$Archive, [string]$Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return "directory is missing: $Root" }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $expected = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if (-not $name.StartsWith($archivePrefix, [StringComparison]::Ordinal)) { return "unexpected archive entry: $name" }
            $relative = $name.Substring($archivePrefix.Length)
            if ($relative.Length -eq 0 -or $relative.EndsWith('/')) { continue }
            if ($relative.StartsWith('/') -or $relative.Contains(':') -or $relative -match '(^|/)\.\.?(/|$)') { return "unsafe archive entry: $name" }
            $relative = $relative.Replace('/', '\')
            [void]$expected.Add($relative)
            $file = Join-Path $rootFull $relative
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return "missing file: $relative" }
            if ((Get-Item -LiteralPath $file -Force).Length -ne $entry.Length) { return "file differs: $relative" }
            $entryStream = $entry.Open()
            try { $entryHash = Get-StreamSha256Hex $entryStream } finally { $entryStream.Dispose() }
            if ((Get-FileSha256Hex $file) -ne $entryHash) { return "file differs: $relative" }
        }
    } finally {
        $zip.Dispose()
    }
    foreach ($item in @(Get-ChildItem -LiteralPath $rootFull -Recurse -Force -File)) {
        $relative = $item.FullName.Substring($rootFull.Length + 1)
        if (-not $expected.Contains($relative)) { return "unexpected file: $relative" }
    }
    return $null
}

# A preset LIGHTS_OUT_NSIS_ROOT is used only when it is verifiably the pinned NSIS: the
# pinned archive sits beside it, matches the pinned SHA-256, and the root is an exact copy
# of that archive's tree. Anything else is ignored and the verified cache is used instead.
if ($env:LIGHTS_OUT_NSIS_ROOT) {
    $presetRoot = $env:LIGHTS_OUT_NSIS_ROOT
    $presetArchive = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($presetRoot).TrimEnd('\'))) "nsis-$nsisVersion.zip"
    $reason = $null
    if (-not (Find-Makensis $presetRoot)) {
        $reason = 'it does not contain makensis.exe'
    } elseif (-not (Test-Path -LiteralPath $presetArchive -PathType Leaf)) {
        $reason = "the pinned archive is not beside it ($presetArchive)"
    } elseif ((Get-FileSha256Hex $presetArchive) -ne $expectedSha256) {
        $reason = "the archive beside it failed SHA-256 verification ($presetArchive)"
    } else {
        $mismatch = Get-NsisTreeMismatch $presetArchive $presetRoot
        if ($mismatch) { $reason = "it is not an exact copy of the pinned archive ($mismatch)" }
    }
    if (-not $reason) {
        Write-Host "Preconfigured NSIS $nsisVersion verified file by file against the pinned archive: $(Find-Makensis $presetRoot)"
        return
    }
    Write-Warning "Ignoring preconfigured LIGHTS_OUT_NSIS_ROOT ($presetRoot) because $reason. Provisioning pinned NSIS $nsisVersion instead."
    Remove-Item -LiteralPath Env:\LIGHTS_OUT_NSIS_ROOT -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
$archive = Join-Path $CacheRoot "nsis-$nsisVersion.zip"
$tempArchive = "$archive.tmp.$([Guid]::NewGuid().ToString('N'))"

if (Test-Path -LiteralPath $archive -PathType Leaf) {
    if ((Get-FileSha256Hex $archive) -ne $expectedSha256) {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        throw 'Cached NSIS archive integrity mismatch; removed corrupt archive and aborted.'
    }
} else {
    try {
        Invoke-WebRequest -Uri $url -Headers @{ 'User-Agent' = 'curl/8.0.0' } -OutFile $tempArchive -UseBasicParsing
        $actual = Get-FileSha256Hex $tempArchive
        if ($actual -ne $expectedSha256) {
            throw "NSIS archive integrity mismatch (expected $expectedSha256, got $actual); nothing extracted or executed."
        }
        Move-Item -LiteralPath $tempArchive -Destination $archive -Force
    } finally {
        if (Test-Path -LiteralPath $tempArchive) {
            Remove-Item -LiteralPath $tempArchive -Force -ErrorAction SilentlyContinue
        }
    }
}

# A cached extraction is reused only while it still matches the verified archive exactly.
$extractRoot = Join-Path $CacheRoot "nsis-$nsisVersion"
$staleReason = Get-NsisTreeMismatch $archive $extractRoot
if ($staleReason) {
    if (Test-Path -LiteralPath $extractRoot) {
        Write-Warning "Cached NSIS extraction does not match the pinned archive ($staleReason); extracting it again."
    }
    $tempExtract = Join-Path $CacheRoot ("extract-" + [Guid]::NewGuid().ToString('N'))
    try {
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $tempExtract)
        $extractedSub = Join-Path $tempExtract "nsis-$nsisVersion"
        if (-not (Find-Makensis $extractedSub)) {
            throw 'Extracted NSIS archive is missing makensis.exe.'
        }
        if (Test-Path -LiteralPath $extractRoot) {
            Remove-Item -LiteralPath $extractRoot -Recurse -Force
        }
        Move-Item -LiteralPath $extractedSub -Destination $extractRoot -Force
    } finally {
        if (Test-Path -LiteralPath $tempExtract) {
            Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $staleReason = Get-NsisTreeMismatch $archive $extractRoot
    if ($staleReason) { throw "Pinned NSIS extraction failed verification ($staleReason)." }
}

$compiler = Find-Makensis $extractRoot
if (-not $compiler) { throw 'Pinned NSIS compiler missing after extraction.' }
$env:LIGHTS_OUT_NSIS_ROOT = $extractRoot
if ($env:GITHUB_ENV) { "LIGHTS_OUT_NSIS_ROOT=$extractRoot" | Out-File -LiteralPath $env:GITHUB_ENV -Append -Encoding utf8 }
Write-Host "Pinned NSIS $nsisVersion archive and extracted files verified; provisioned at $extractRoot."
