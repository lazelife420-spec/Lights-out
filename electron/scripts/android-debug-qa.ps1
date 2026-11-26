param(
    [string]$ProofRoot,
    # SDK location is injectable so an isolated/provisioned SDK works when the
    # developer-profile SDK is absent. Default preserves the original behavior.
    [string]$SdkRoot = (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
function Get-FileSha256Hex([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose(); $hasher.Dispose() }
}
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pkgVersion = (Get-Content -LiteralPath (Join-Path $repo 'electron\package.json') -Raw | ConvertFrom-Json).version
if (-not $ProofRoot) {
    $ProofRoot = Join-Path $repo ("review\RELEASE-$pkgVersion-android")
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {
    $adoptium = Get-ChildItem -Path 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($adoptium) { $JavaHome = $adoptium.FullName }
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {
    throw 'JDK 17 not found. Set -JavaHome or JAVA_HOME to a valid JDK 17 installation.'
}

$source = Join-Path $repo 'companion-android'
$qaRoot = Join-Path ([IO.Path]::GetTempPath()) ('lightsout-release-android-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ProofRoot -Force | Out-Null

$oldJava = $env:JAVA_HOME
$oldAndroidHome = $env:ANDROID_HOME
$oldAndroidSdk = $env:ANDROID_SDK_ROOT
$oldAndroidUser = $env:ANDROID_USER_HOME
$oldGradleUser = $env:GRADLE_USER_HOME

try {
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
        $inventory += @{ path=$name.Replace('\','/'); sha256=(Get-FileSha256Hex $target) }
    }
    # Known QA-only properties; never load the owner's Gradle or signing properties.
    @('android.useAndroidX=true','org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8','kotlin.code.style=official') |
        Set-Content -LiteralPath (Join-Path $project 'gradle.properties') -Encoding ascii
    if (Test-Path -LiteralPath (Join-Path $project 'keystore.properties')) { throw 'Signing properties must be absent from QA.' }
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $SdkRoot
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
        if ((Get-FileSha256Hex (Join-Path $source $file.path)) -ne $file.sha256) { throw "Android source changed during build: $($file.path)" }
    }
    $apk = Join-Path $ProofRoot "Lights-Out-Android-v$pkgVersion-debug.apk"
    Copy-Item -LiteralPath (Join-Path $project 'app\build\outputs\apk\debug\app-debug.apk') -Destination $apk -Force
    $tests = 0
    foreach ($xmlFile in Get-ChildItem -LiteralPath (Join-Path $project 'app\build\test-results\testDebugUnitTest') -Filter 'TEST-*.xml') {
        [xml]$xml = Get-Content -LiteralPath $xmlFile.FullName
        if ([int]$xml.testsuite.failures -ne 0 -or [int]$xml.testsuite.errors -ne 0) { throw 'Android unit test failure.' }
        $tests += [int]$xml.testsuite.tests
    }
    $report = @{ status='passed'; version=$pkgVersion; package='com.lightsout.companion.debug'; sourceFiles=$inventory; unitTests=$tests; lint='passed'; apk=$apk; apkSha256=(Get-FileSha256Hex $apk); productionSigningUsed=$false; physicalDeviceQualified=$false; properties='explicit isolated QA properties' }
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ProofRoot 'android-qualification.json') -Encoding utf8
    Write-Output "Android debug build, $tests unit tests and lint passed; source snapshot and APK SHA-256 recorded."
} finally {
    $env:JAVA_HOME = $oldJava
    $env:ANDROID_HOME = $oldAndroidHome
    $env:ANDROID_SDK_ROOT = $oldAndroidSdk
    $env:ANDROID_USER_HOME = $oldAndroidUser
    $env:GRADLE_USER_HOME = $oldGradleUser
    if (Test-Path -LiteralPath $qaRoot) {
        Remove-Item -LiteralPath $qaRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
