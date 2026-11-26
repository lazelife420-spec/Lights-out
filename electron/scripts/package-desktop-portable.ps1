param(
    [Parameter(Mandatory=$true)][string]$NativeRoot,
    [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference='Stop'
$NativeRoot=[IO.Path]::GetFullPath($NativeRoot)
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
if(Test-Path -LiteralPath $OutputRoot){throw 'Use a new portable output directory'}
$manifestPath=Join-Path (Split-Path -Parent $NativeRoot) 'BUILD-MANIFEST.json'
$nativeManifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$runtimePrefix=$NativeRoot.TrimEnd('\')+'\'
foreach($entry in $nativeManifest.runtime){
    $sourcePath=[IO.Path]::GetFullPath((Join-Path $NativeRoot $entry.path))
    if(!$sourcePath.StartsWith($runtimePrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime path escapes native root'}
    if((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw ('Native hash mismatch: '+$entry.path)}
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
$portableFolder=Join-Path $OutputRoot 'Lights Out Portable'
New-Item -ItemType Directory -Path $portableFolder | Out-Null
Copy-Item -LiteralPath $NativeRoot -Destination (Join-Path $portableFolder 'app') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable-start.cmd') -Destination (Join-Path $portableFolder 'Start Lights Out.cmd')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable-run.cmd') -Destination (Join-Path $portableFolder 'Launch Lights Out.cmd')
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $portableFolder 'NATIVE-BUILD-MANIFEST.json')
$dataFolder=Join-Path $portableFolder 'user-data'
New-Item -ItemType Directory -Path $dataFolder | Out-Null
$initialSettings=@{
    app=@{dryRun=$false;onboarded=$true;unit='min';durationSeconds=1680;action='shutdown';forceShutdown=$false;graceMinutes=2;gracefulClose=$true;muteSystem=$false;nightLightOnDim=$false;pauseMediaOnDim=$false;lockoutOnDim=$false;autopilotEnabled=$false;calendarAutoStart=$false;focusBlocklist=@()}
    smartLights=@{enabled=$false};companion=@{enabled=$false};family=@{enabled=$false};remoteControl=@{enabled=$false;mode='off'}
    wifiGuard=@{enabled=$false};contentBlocker=@{enabled=$false};lastLight=@{enabled=$false};calendar=@{enabled=$false;events=@()};customization=@{theme='midnight'}
}
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $dataFolder 'settings.json'),($initialSettings | ConvertTo-Json -Depth 8),$utf8)
$readme=@'
Lights Out restored portable

Extract this entire folder, then double-click Start Lights Out.cmd.
Windows Explorer launches the app independently of the starting terminal or helper.
The app opens idle in normal mode. Choose your duration and ending, then press Start.
Closing with X hides to the system tray and keeps the timer running. Quit exits the app.
Settings and history stay in user-data. Keep the complete folder together when moving it.

This local candidate retains the restored interface and living lamp. It includes
timer lifecycle diagnostics in user-data/startup.log. No installation is required.
Real power actions are enabled; force shutdown and physical integrations default off.
'@
[IO.File]::WriteAllText((Join-Path $portableFolder 'READ ME.txt'),$readme,$utf8)
$inventory=@(Get-ChildItem -LiteralPath $portableFolder -File -Recurse | ForEach-Object {
    [pscustomobject]@{path=$_.FullName.Substring($portableFolder.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
} | Sort-Object path)
$portableManifest=[ordered]@{schema='lights-out.desktop-portable/v1';sourceCommit=$nativeManifest.sourceCommit;trackedSourceDirty=$nativeManifest.trackedSourceDirty;nativeArtifact=$nativeManifest.artifacts[0];nativeRuntimeFiles=@($nativeManifest.runtime).Count;files=$inventory}
[IO.File]::WriteAllText((Join-Path $portableFolder 'PORTABLE-MANIFEST.json'),($portableManifest | ConvertTo-Json -Depth 8),$utf8)
$archivePath=Join-Path $OutputRoot 'Lights-Out-Portable-Restored-2026-10-18.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::Open($archivePath,[IO.Compression.ZipArchiveMode]::Create)
try{
    $names=@(Get-ChildItem -LiteralPath $portableFolder -File -Recurse | ForEach-Object{$_.FullName.Substring($portableFolder.Length+1).Replace('\','/')})
    [Array]::Sort($names,[StringComparer]::Ordinal)
    foreach($name in $names){
        $entry=$archive.CreateEntry('Lights Out Portable/'+$name,[IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime=[DateTimeOffset]'2000-01-01T12:00:00+00:00'
        $inputStream=[IO.File]::OpenRead((Join-Path $portableFolder $name));$outputStream=$entry.Open()
        try{$inputStream.CopyTo($outputStream)}finally{$outputStream.Dispose();$inputStream.Dispose()}
    }
}finally{$archive.Dispose()}
$result=[ordered]@{status='BUILT';archive=$archivePath;bytes=(Get-Item -LiteralPath $archivePath).Length;sha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant();portableFolder=$portableFolder;runtimeFiles=@($nativeManifest.runtime).Count;manifestFiles=$inventory.Count;nativeRuntimeUnchanged=$true}
[IO.File]::WriteAllText((Join-Path $OutputRoot 'RESULT.json'),($result | ConvertTo-Json -Depth 4),$utf8)
[IO.File]::WriteAllText((Join-Path $OutputRoot 'SHA256SUMS.txt'),($result.sha256+'  '+[IO.Path]::GetFileName($archivePath)+"`n"),$utf8)
$result | ConvertTo-Json -Depth 4
