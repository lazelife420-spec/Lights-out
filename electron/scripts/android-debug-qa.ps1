param([string]$ProofRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'review\RELEASE-11.2.0-20261016'))
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = Join-Path $repo 'companion-android'
$qaRoot = Join-Path ([IO.Path]::GetTempPath()) ('lightsout-release-android-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ProofRoot -Force | Out-Null
$project = Join-Path $qaRoot 'project'
$names = @('build.gradle','settings.gradle','gradlew','gradlew.bat','app\build.gradle','app\proguard-rules.pro','gradle\wrapper\gradle-wrapper.jar','gradle\wrapper\gradle-wrapper.properties')
$names += Get-ChildItem -LiteralPath (Join-Path $source 'app\src') -Recurse -File |
    Where-Object { $_.Extension -in @('.kt','.xml','.html','.js','.css','.png','.webp','.svg') } |
    ForEach-Object { $_.FullName.Substring($source.Length + 1) }
$inventory = @()
foreach ($name in $names) {
    $target = Join-Path $project $name
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target
    $inventory += @{ path=$name.Replace('\','/'); sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() }
}
# Known QA-only properties; never load the owner's Gradle or signing properties.
@('android.useAndroidX=true','org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8','kotlin.code.style=official') |
    Set-Content -LiteralPath (Join-Path $project 'gradle.properties') -Encoding ascii
if (Test-Path -LiteralPath (Join-Path $project 'keystore.properties')) { throw 'Signing properties must be absent from QA.' }
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = Join-Path $qaRoot 'android-user'
$env:GRADLE_USER_HOME = Join-Path $qaRoot 'gradle-user'
foreach ($name in @('LIGHTSOUT_STORE_FILE','LIGHTSOUT_STORE_PASSWORD','LIGHTSOUT_KEY_ALIAS','LIGHTSOUT_KEY_PASSWORD','ORG_GRADLE_PROJECT_storeFile','ORG_GRADLE_PROJECT_storePassword','ORG_GRADLE_PROJECT_keyAlias','ORG_GRADLE_PROJECT_keyPassword','GRADLE_OPTS','JAVA_TOOL_OPTIONS')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
Push-Location $project
try {
    & .\gradlew.bat --no-daemon --console=plain :app:testDebugUnitTest :app:lintDebug :app:assembleDebug *> (Join-Path $ProofRoot 'android-build.log')
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Android qualification failed; inspect android-build.log.' }
} finally { Pop-Location }
foreach ($file in $inventory) {
    if ((Get-FileHash -LiteralPath (Join-Path $source $file.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Android source changed during build: $($file.path)" }
}
$apk = Join-Path $ProofRoot 'Lights-Out-Android-v11.2.0-debug.apk'
Copy-Item -LiteralPath (Join-Path $project 'app\build\outputs\apk\debug\app-debug.apk') -Destination $apk -Force
$tests = 0
foreach ($xmlFile in Get-ChildItem -LiteralPath (Join-Path $project 'app\build\test-results\testDebugUnitTest') -Filter 'TEST-*.xml') {
    [xml]$xml = Get-Content -LiteralPath $xmlFile.FullName
    if ([int]$xml.testsuite.failures -ne 0 -or [int]$xml.testsuite.errors -ne 0) { throw 'Android unit test failure.' }
    $tests += [int]$xml.testsuite.tests
}
$report = @{ status='passed'; package='com.lightsout.companion.debug'; projectRoot=$project; qaRoot=$qaRoot; sourceFiles=$inventory; unitTests=$tests; lint='passed'; apk=$apk; apkSha256=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant(); productionSigningUsed=$false; physicalDeviceQualified=$false; properties='explicit isolated QA properties' }
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ProofRoot 'android-qualification.json') -Encoding utf8
Write-Output "Android debug build, $tests unit tests and lint passed; source snapshot and APK SHA-256 recorded."
