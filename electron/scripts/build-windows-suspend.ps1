param(
    [string]$SourceRoot = '',
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (-not $SourceRoot) { $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework 4.x C# compiler is required to package the suspend helper.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = Join-Path $OutputDirectory 'WindowsSuspend.exe'
& $compiler /nologo /optimize+ /target:exe /platform:x64 /reference:System.Web.Extensions.dll "/out:$output" (Join-Path $SourceRoot 'native\WindowsSuspend.cs')
if ($LASTEXITCODE -ne 0) { throw "Suspend helper compilation failed: $LASTEXITCODE" }
Write-Host "Built native Windows suspend helper: $output"
