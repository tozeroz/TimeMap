# Build the Android APK (Capacitor) on Windows, from a path that may contain non-ASCII characters.
#
# ============================================================================
# WHY THIS SCRIPT IS NECESSARY (read this before "simplifying" it)
# ============================================================================
# The Kotlin compiler cannot handle non-ASCII paths. Gradle writes its compile arguments into
# an argfile using JAVA-STYLE \uXXXX escapes, and the Kotlin compiler's argfile reader does not
# understand that escape: it drops the backslashes and then looks for a directory whose name is
# literally "u6D4Bu8BD5u5B9Eu8BAD" (that string IS the UTF-8 of the repo's parent folder name).
# Symptoms seen in this repo, in this order:
#   1. resources  : "resource drawable/splash not found"      (a separate, real repo defect)
#   2. javac      : PASSES -- javac DOES understand \uXXXX, so Java never complains
#   3. kotlinc    : "error: cannot access 'String' which is a supertype of ..."
#                   "error: unresolved reference 'Manifest'"
#                   "warning: classpath entry points to a non-existent location: ...u6D4B..."
#   Step 3's message is misleading: it reads like a broken classpath or a wrong Kotlin version,
#   while the actual cause is that android.jar (which supplies java.lang.* for Android builds)
#   and the Gradle caches are addressed by a mangled path.
#
# THE FIX: build through an all-ASCII view of the same files, using junctions (no copy, no
# second checkout, and the build still writes into the real repo):
#     <asciiRoot>\repo          -> repo root        (project + node_modules)
#     <asciiRoot>\gradle-home   -> Gradle caches    (their paths end up on kotlinc's classpath)
#     <asciiRoot>\android-sdk   -> Android SDK      (android.jar is on kotlinc's classpath)
# `subst` would be simpler but is unavailable in this environment ("Access denied").
#
# ALSO REQUIRED, and already configured elsewhere:
#   * JDK 21+ (Capacitor 8 compiles with a Java 21 source release; JDK 17 fails with
#     "error: invalid source release: 21")
#   * android.overridePathCheck=true and org.gradle.vfs.watch=false in app/android/gradle.properties
#
# USAGE (from the repo root)
#   powershell -File tools/build-apk.ps1
#   powershell -File tools/build-apk.ps1 -SyncWeb        # also run pnpm build + cap sync first
#   powershell -File tools/build-apk.ps1 -AsciiRoot D:\tm-ascii
#
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 parses BOM-less UTF-8 as ANSI, and
# mis-decoded non-ASCII breaks PARSING, not just messages).
param(
  [string]$AsciiRoot = '',
  [switch]$SyncWeb,
  [switch]$RemoveJunctions,
  [string]$JavaHome = ''
)
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$androidReal = Join-Path $app 'android'
$apk = Join-Path $androidReal 'app\build\outputs\apk\debug\app-debug.apk'

function Step($n, $msg) { Write-Host "=== $n) $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "BUILD_APK: FAILED - $msg" -ForegroundColor Red; exit 1 }

if (-not $AsciiRoot) { $AsciiRoot = Join-Path $env:TEMP 'timemap-ascii' }
if ($AsciiRoot -match '[^\x00-\x7F]') { Fail "AsciiRoot must be pure ASCII, got: $AsciiRoot" }
$asciiRepo = Join-Path $AsciiRoot 'repo'
$asciiGradleHome = Join-Path $AsciiRoot 'gradle-home'
$asciiSdk = Join-Path $AsciiRoot 'android-sdk'
$asciiAndroid = Join-Path $asciiRepo 'app\android'

# ---------------------------------------------------------------- 1) web bundle provenance
Step 1 'Check that the native assets hold the CURRENT web bundle'
# If cap sync was skipped, the APK silently ships yesterday's web app. That is invisible until
# someone installs it, so it is checked here instead of trusted.
$distAssets = Join-Path $app 'dist\assets'
$nativeAssets = Join-Path $androidReal 'app\src\main\assets\public\assets'
function NewestIndexJs($dir) {
  if (-not (Test-Path $dir)) { return $null }
  Get-ChildItem $dir -Filter 'index-*.js' -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
}
if ($SyncWeb) {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail 'pnpm not found on PATH (needed for -SyncWeb)' }
  Push-Location $app
  & pnpm build
  $webCode = $LASTEXITCODE
  & npx cap sync android
  $capCode = $LASTEXITCODE
  Pop-Location
  if ($webCode -ne 0) { Fail "pnpm build failed (exit $webCode)" }
  if ($capCode -ne 0) { Fail "npx cap sync android failed (exit $capCode)" }
}
$d = NewestIndexJs $distAssets
$n = NewestIndexJs $nativeAssets
if (-not $d) { Fail "no web bundle in $distAssets -- run: cd app; pnpm build" }
if (-not $n) { Fail "no native web assets in $nativeAssets -- run: cd app; npx cap sync android" }
$dSha = (Get-FileHash $d.FullName -Algorithm SHA256).Hash
$nSha = (Get-FileHash $n.FullName -Algorithm SHA256).Hash
Write-Host "  web dist : $($d.Name)  $($dSha.Substring(0,16))..."
Write-Host "  native   : $($n.Name)  $($nSha.Substring(0,16))..."
if ($d.Name -ne $n.Name -or $dSha -ne $nSha) {
  Fail "the native assets are NOT the current web bundle (cap sync missing or stale). Run: cd app; pnpm build; npx cap sync android   (or re-run with -SyncWeb)"
}
Write-Host '  PASS: the APK will contain the web bundle that is in app/dist' -ForegroundColor Green

# ---------------------------------------------------------------- 2) ASCII view
Step 2 "Create the ASCII view under $AsciiRoot"
New-Item -ItemType Directory -Force -Path $AsciiRoot | Out-Null
function New-Junction($path, $target) {
  if (Test-Path $path) { Write-Host "  exists : $path"; return }
  if (-not (Test-Path $target)) { Fail "junction target missing: $target" }
  New-Item -ItemType Junction -Path $path -Target $target | Out-Null
  Write-Host "  created: $path -> $target"
}
New-Junction $asciiRepo $root
New-Junction $asciiGradleHome (Join-Path $root 'tools\tmp\gradle-home')
New-Junction $asciiSdk (Join-Path $root 'tools\tmp\android-sdk')

if ($asciiAndroid -match '[^\x00-\x7F]') { Fail "internal error: android dir is not ASCII: $asciiAndroid" }
if (-not (Test-Path (Join-Path $asciiAndroid 'gradlew.bat'))) { Fail "gradlew.bat not found under $asciiAndroid" }
if (-not (Test-Path (Join-Path $asciiSdk 'platforms\android-36\android.jar'))) {
  Fail "Android SDK (platform 36) not found at $asciiSdk -- see tools/tmp/fetch-android-sdk.mjs"
}

# AGP reads sdk.dir from local.properties and only falls back to ANDROID_HOME when it is absent,
# so the file must name the ASCII SDK or android.jar stays mangled for kotlinc.
# local.properties is gitignored and machine-local; this script owns it.
$localProps = Join-Path $androidReal 'local.properties'
$wanted = 'sdk.dir=' + $asciiSdk.Replace('\', '/')
$current = if (Test-Path $localProps) { (Get-Content -LiteralPath $localProps -Raw).Trim() } else { '' }
if ($current -ne $wanted) {
  [IO.File]::WriteAllText($localProps, $wanted + "`n", (New-Object Text.UTF8Encoding($false)))
  Write-Host "  wrote local.properties -> $wanted"
}

# ---------------------------------------------------------------- 3) JDK
Step 3 'Locate a JDK 21+'
if (-not $JavaHome) {
  $roots = @('C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft', 'C:\Program Files\Zulu')
  $found = @()
  foreach ($r in $roots) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      if (Test-Path (Join-Path $_.FullName 'bin\java.exe')) { $found += $_.FullName }
    }
  }
  $JavaHome = ($found | Where-Object { $_ -match 'jdk-2[1-9]|jdk-3\d' } | Select-Object -First 1)
  if (-not $JavaHome) { $JavaHome = ($found | Select-Object -First 1) }
}
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome 'bin\java.exe'))) {
  Fail 'no JDK found; pass -JavaHome <path to a JDK 21+>'
}
$env:JAVA_HOME = $JavaHome
Write-Host "  JAVA_HOME = $JavaHome"

# ---------------------------------------------------------------- 4) gradle
Step 4 'gradle assembleDebug (through the ASCII path)'
$env:GRADLE_USER_HOME = $asciiGradleHome
$env:ANDROID_HOME = $asciiSdk
$env:ANDROID_SDK_ROOT = $asciiSdk
$env:ANDROID_USER_HOME = Join-Path $AsciiRoot 'android-user-home'
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null

Push-Location $asciiAndroid
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$code = 1
try {
  # --no-daemon: keeps no JVM alive between runs (and in a restricted shell a lingering daemon
  # is one more thing that cannot be managed).
  & (Join-Path $asciiAndroid 'gradlew.bat') assembleDebug --no-daemon --console=plain 2>&1 |
    Select-Object -Last 25
  $code = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $prev
  Pop-Location
}
if ($code -ne 0) { Fail "gradle assembleDebug failed (exit $code) -- full output is above" }

if (-not (Test-Path $apk)) { Fail "gradle reported success but the APK is missing: $apk" }

# ---------------------------------------------------------------- 5) verify the artifact
Step 5 'Verify the artifact against the repo version'
$size = (Get-Item -LiteralPath $apk).Length
$sha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
Write-Host "  path  : $apk"
Write-Host "  size  : $size bytes"
Write-Host "  sha256: $sha"

$vt = Join-Path $app 'src\version.ts'
$vtMatch = [regex]::Match([IO.File]::ReadAllText($vt, [Text.Encoding]::UTF8), "APP_VERSION\s*=\s*'([^']*)'")
$repoVersion = if ($vtMatch.Success) { $vtMatch.Groups[1].Value } else { $null }
$gradleTxt = [IO.File]::ReadAllText((Join-Path $androidReal 'app\build.gradle'), [Text.Encoding]::UTF8)
$gMatch = [regex]::Match($gradleTxt, 'versionName\s+"([^"]*)"')
$gradleVersion = if ($gMatch.Success) { $gMatch.Groups[1].Value } else { $null }
Write-Host "  version.ts APP_VERSION = $repoVersion ; android versionName = $gradleVersion"
if (-not $repoVersion -or $repoVersion -ne $gradleVersion) {
  Fail "version disagreement: app/src/version.ts says '$repoVersion' but build.gradle says '$gradleVersion'"
}

# Read the version back out of the built APK: the point is to prove the PACKAGED value,
# not to re-read the source we just looked at.
$aapt2 = @(
  (Join-Path $asciiSdk 'build-tools\36.0.0\aapt2.exe'),
  (Join-Path $asciiSdk 'build-tools\35.0.0\aapt2.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($aapt2) {
  $badging = & $aapt2 dump badging $apk 2>&1 | Out-String
  $pkg = [regex]::Match($badging, "package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'")
  if ($pkg.Success) {
    Write-Host "  packaged: name=$($pkg.Groups[1].Value) versionCode=$($pkg.Groups[2].Value) versionName=$($pkg.Groups[3].Value)"
    if ($pkg.Groups[3].Value -ne $repoVersion) {
      Fail "the APK reports versionName '$($pkg.Groups[3].Value)' but the repo says '$repoVersion'"
    }
  } else {
    Write-Host '  ! could not parse aapt2 badging output; the packaged version was NOT verified'
  }
} else {
  Write-Host '  ! aapt2 not found in the SDK; the packaged version was NOT verified (not a pass)'
}

# The web bundle must actually be inside the APK (provenance beyond app/src).
# NOTE: the ZipFile type lives in System.IO.Compression.FileSystem and is NOT loaded by
# default. Without this Add-Type the code below throws "Unable to find type" and the check
# then reported "the APK does not contain ..." -- a false FAIL that blamed the artifact for a
# missing assembly reference. Load it explicitly and report open failures as such.
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
} catch {
  Write-Host "  ! could not load System.IO.Compression.FileSystem: $($_.Exception.Message)"
  Write-Host '  ! the in-APK bundle check DID NOT RUN (this is not a pass)'
}
$zip = $null
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
} catch {
  Write-Host "  ! could not open the APK as a zip: $($_.Exception.Message)"
  Write-Host '  ! the in-APK bundle check DID NOT RUN (this is not a pass)'
}
if ($zip) {
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "assets/public/assets/$($d.Name)" } | Select-Object -First 1
    if ($entry) {
      $ms = New-Object System.IO.MemoryStream
      $s = $entry.Open()
      $s.CopyTo($ms)
      $s.Close()
      $inApk = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash($ms.ToArray())).Replace('-', '')
      $ms.Dispose()
      Write-Host "  in-APK : assets/public/assets/$($d.Name)  $($inApk.Substring(0,16))..."
      if ($inApk -ne $dSha) { Fail 'the in-APK web bundle does not match app/dist (stale cap sync?)' }
      Write-Host '  PASS: the APK carries the current web bundle' -ForegroundColor Green
    } else {
      Fail "the APK does not contain assets/public/assets/$($d.Name)"
    }
  } finally {
    $zip.Dispose()
  }
}

if ($RemoveJunctions) {
  Step 6 'Remove the ASCII junctions'
  foreach ($p in @($asciiRepo, $asciiGradleHome, $asciiSdk)) {
    # /D removes a directory junction; plain rmdir.exe would refuse or delete the target.
    if (Test-Path $p) { cmd /c rmdir "$p" 2>&1 | Out-Null; Write-Host "  removed $p" }
  }
}

Write-Host ''
Write-Host "BUILD_APK: OK  version $repoVersion  $size bytes" -ForegroundColor Green
Write-Host "  sha256: $sha"
Write-Host '  publish it with:  powershell -File tools/release-apk.ps1'
exit 0
