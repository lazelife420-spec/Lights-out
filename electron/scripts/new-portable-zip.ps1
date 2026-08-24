#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,

    [string]$RootFolderName = 'Lights Out'
)

$ErrorActionPreference = 'Stop'

if (
    [string]::IsNullOrWhiteSpace($RootFolderName) -or
    $RootFolderName -in @('.', '..') -or
    $RootFolderName.Contains('/') -or
    $RootFolderName.Contains('\') -or
    $RootFolderName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0
) {
    throw 'RootFolderName must be one safe archive folder name.'
}

$resolvedSource = (Resolve-Path -LiteralPath $SourceRoot -ErrorAction Stop).Path.TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
    throw "Portable ZIP source is not a directory: $resolvedSource"
}

$destinationFullPath = [System.IO.Path]::GetFullPath($DestinationPath)
$destinationDirectory = Split-Path -Parent $destinationFullPath
if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
}

Add-Type -AssemblyName System.IO.Compression

$files = @(
    Get-ChildItem -LiteralPath $resolvedSource -File -Recurse -Force |
        Sort-Object FullName
)

if ($files.Count -eq 0) {
    throw "Portable ZIP source contains no files: $resolvedSource"
}

$archive = $null
$destinationStream = $null
try {
    if (Test-Path -LiteralPath $destinationFullPath) {
        [System.IO.File]::Delete($destinationFullPath)
    }

    $destinationStream = [System.IO.File]::Open(
        $destinationFullPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $archive = [System.IO.Compression.ZipArchive]::new(
        $destinationStream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $false
    )

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($resolvedSource.Length).TrimStart('\', '/')
        $entryPath = "$RootFolderName/$($relativePath.Replace('\', '/'))"
        $entry = $archive.CreateEntry($entryPath, [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [System.DateTimeOffset]$file.LastWriteTime

        $inputStream = $null
        $entryStream = $null
        try {
            $inputStream = [System.IO.File]::OpenRead($file.FullName)
            $entryStream = $entry.Open()
            $inputStream.CopyTo($entryStream)
        } finally {
            if ($entryStream) { $entryStream.Dispose() }
            if ($inputStream) { $inputStream.Dispose() }
        }
    }
} catch {
    if ($archive) { $archive.Dispose(); $archive = $null }
    if ($destinationStream) { $destinationStream.Dispose(); $destinationStream = $null }
    if (Test-Path -LiteralPath $destinationFullPath) {
        [System.IO.File]::Delete($destinationFullPath)
    }
    throw
} finally {
    if ($archive) { $archive.Dispose() }
    if ($destinationStream) { $destinationStream.Dispose() }
}

Write-Host "Portable ZIP root: $RootFolderName/ ($($files.Count) files)"
