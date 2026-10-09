<#
  Build the demo APK and install it on a MuMu emulator.

  ⚠️ WHAT WAS WRONG BEFORE (fixed 2026-10-09)
  This script used to hard-code the previous workstation's paths:
      $adb     = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
      $appDir  = 'G:\demo map\app'
      ANDROID_HOME = 'G:\android-sdk'
      JAVA_HOME    = 'C:\Program Files\Java\jdk-21'
  On any other machine it fails with confusing errors ("APK NOT FOUND",
  "gradlew.bat is not recognized") that look like build failures but are really
  "the path belongs to a computer that no longer exists". Paths are now derived
  from the script location, and every missing prerequisite is reported as such.

  PREREQUISITES: web bundle already built and `npx cap sync android` already run
  (see tools/release-android.ps1 for the sanctioned full sequence).

  USAGE
    powershell -File tools/build-android.ps1 -SkipBuild   # just install the existing APK
    powershell -File tools/build-android.ps1              # build then install

  NOTE: keep this file ASCII-only (PowerShell 5.1 mis-decodes a BOM-less UTF-8 .ps1).
#>
param(
  [switch]$SkipBuild,
  [string]$Serial = '127.0.0.1:16384',
  [string]$Adb = '',
  [string]$SdkDir = '',
  [string]$JavaHome = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot          # repo root (this file lives in tools\)
$appDir = Join-Path $root 'app'
$androidDir = Join-Path $appDir 'android'
$apkPath = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'

function Resolve-Sdk {
  param([string]$Explicit)
  $candidates = @(
    $Explicit,
    (Join-Path $root 'tools\tmp\android-sdk'),   # this repo's reproducible local install
    $env:ANDROID_SDK_ROOT, $env:ANDROID_HOME,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
  ) | Where-Object { $_ }
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c 'platforms\android-36\android.jar')) { return $c }
  }
  return $null
}

function Resolve-JavaHome {
  param([string]$Explicit)
  $candidates = @($Explicit, $env:JAVA_HOME) | Where-Object { $_ }
  # Any installed JDK 17 works; look for it instead of naming one absolute path.
  $jdkRoots = @('C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft')
  foreach ($r in $jdkRoots) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } |
      ForEach-Object { $candidates += $_.FullName }
  }
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c 'bin\java.exe')) { return $c }
  }
  return $null
}

function Resolve-Adb {
  param([string]$Explicit, [string]$Sdk)
  $candidates = @($Explicit) | Where-Object { $_ }
  if ($Sdk) { $candidates += (Join-Path $Sdk 'platform-tools\adb.exe') }
  $candidates += (Join-Path $env:ProgramFiles 'Netease\MuMu\nx_main\adb.exe')
  $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Netease\MuMu\nx_main\adb.exe')
  $candidates += 'D:\Program Files\Netease\MuMu\nx_main\adb.exe'
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  return $null
}

if (-not $SkipBuild) {
  Write-Output '[1/3] gradle assembleDebug ...'
  $sdk = Resolve-Sdk $SdkDir
  $java = Resolve-JavaHome $JavaHome
  if (-not $sdk) { Write-Error 'Android SDK not found (need platforms/android-36). Set -SdkDir or ANDROID_SDK_ROOT.'; exit 2 }
  if (-not $java) { Write-Error 'A JDK was not found. Set -JavaHome or JAVA_HOME.'; exit 2 }
  Write-Output "      SDK  = $sdk"
  Write-Output "      JDK  = $java"
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk
  $env:JAVA_HOME = $java
  Push-Location $androidDir
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & (Join-Path $androidDir 'gradlew.bat') assembleDebug --no-daemon --console=plain 2>&1 | Select-Object -Last 15
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) { Write-Error "gradle assembleDebug failed (exit $LASTEXITCODE)"; exit 1 }
}

if (-not (Test-Path -LiteralPath $apkPath)) {
  Write-Error "APK not found: $apkPath (build it first, or drop -SkipBuild)"
  exit 1
}
Write-Output "[2/3] APK: $((Get-Item -LiteralPath $apkPath).Length) bytes"

$adb = Resolve-Adb $Adb (Resolve-Sdk $SdkDir)
if (-not $adb) {
  Write-Error 'adb.exe not found (looked in the SDK, MuMu install dirs). Pass -Adb <path>.'
  exit 2
}
& $adb connect $Serial | Out-Null
Write-Output "[3/3] installing via $adb ($Serial) ..."
& $adb -s $Serial install -r $apkPath 2>&1 | Select-Object -Last 3

& $adb -s $Serial shell am start -n com.campusx.demo/.MainActivity 2>&1 | Select-Object -First 2
Start-Sleep -Milliseconds 3500
& $adb -s $Serial shell dumpsys window | Select-String 'mCurrentFocus'
Write-Output 'done'
