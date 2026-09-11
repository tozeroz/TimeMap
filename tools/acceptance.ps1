<#
  One-shot acceptance: build -> deploy -> route regression -> interaction loops -> map gestures.

  NOTE: this script is intentionally ASCII-only. Chinese characters inside string
  literals got mangled by the PowerShell encoding round-trip and broke parsing
  (regex/pattern strings), so keep this file ASCII to stay robust.

  Usage (from G:\demo map):
    & .\tools\acceptance.ps1              # full run (build + deploy + verify)
    & .\tools\acceptance.ps1 -SkipBuild   # verify the already-installed package
#>
param([switch]$SkipBuild)

$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$serial = '127.0.0.1:16384'
$appDir = 'G:\demo map\app'
$apk = Join-Path $appDir 'android\app\build\outputs\apk\debug\app-debug.apk'

$script:failed = $false
function Step([string]$title) { Write-Output ''; Write-Output "===== $title =====" }
function Fail([string]$msg) { Write-Output "  [FAIL] $msg"; $script:failed = $true }

if (-not $SkipBuild) {
  Step '1/6 build web'
  Set-Location $appDir
  pnpm run build 2>&1 | Select-Object -Last 3

  Step '2/6 cap sync + gradle'
  $env:ANDROID_HOME = 'G:\android-sdk'
  $env:ANDROID_SDK_ROOT = 'G:\android-sdk'
  $env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
  npx cap sync android 2>&1 | Select-Object -Last 1
  Set-Location (Join-Path $appDir 'android')
  $build = .\gradlew.bat assembleDebug --no-daemon 2>&1 | Select-String -Pattern 'BUILD SUCCESSFUL|BUILD FAILED'
  Write-Output "  $build"
  if ("$build" -notmatch 'BUILD SUCCESSFUL') { Fail 'gradle build failed'; exit 1 }
} else {
  Step '1-2/6 build skipped'
}

Step '3/6 install to emulator'
& $adb connect $serial | Out-Null
$install = & $adb -s $serial install -r $apk 2>&1 | Select-Object -Last 1
Write-Output "  $install"
if ("$install" -notmatch 'Success') { Fail 'apk install failed'; exit 1 }

& $adb -s $serial shell am force-stop com.campusx.demo
& $adb -s $serial shell am start -n com.campusx.demo/.MainActivity | Out-Null
Start-Sleep -Milliseconds 5000

Step '4/6 open CDP channel'
$appPid = (& $adb -s $serial shell pidof com.campusx.demo | Out-String).Trim()
Write-Output "  app pid: $appPid"
& $adb -s $serial forward --remove-all 2>&1 | Out-Null
& $adb -s $serial forward tcp:9222 "localabstract:webview_devtools_remote_$appPid" | Out-Null

Set-Location 'G:\demo map'

Step '5/6 route regression'
$reg = & node tools/device-eval.mjs --file tools/checks/full-regression.js 90000 2>&1 | Out-String
$regTotal = ($reg -split "`n" | Where-Object { $_ -match '"' -and $_ -match ':' }) -join ''
Write-Output "  $($reg.Trim().Split("`n")[1].Trim())"
Write-Output "  $($reg.Trim().Split("`n")[2].Trim())"
if ($reg -match '"' ) {
  $failedEntry = ($reg -split "`n" | Select-String -Pattern 'MISSING')
  if ($failedEntry) { Fail "regression failures: $failedEntry" }
}

Step '5b/6 interaction loops'
$loop = & node tools/device-eval.mjs --file tools/checks/interaction-loops.js 120000 2>&1 | Out-String
$loopLines = $loop.Trim().Split("`n")
Write-Output "  $($loopLines[1].Trim())"
Write-Output "  $($loopLines[2].Trim())"
if ($loop -match 'FAIL') { Fail 'interaction loop failures present' }

Step '6/6 map gestures'
& node tools/device-nav.mjs '#/map' 1300 | Out-Null
$open = & node tools/device-eval.mjs --file tools/checks/map-open.js 30000 2>&1 | Out-String
Write-Output "  $($open.Trim().Split("`n") | Where-Object { $_ -match 'markers|transform' })"

& $adb -s $serial shell input swipe 800 1300 300 800 700
Start-Sleep -Milliseconds 1500
$after = & node tools/device-eval.mjs --file tools/checks/map-transform.js 30000 2>&1 | Out-String
Write-Output "  drag -> $(($after -split "`n" | Where-Object { $_ -match 'transform' }) -join '')"

$dt = & node tools/device-gesture.mjs double-tap 540 900 2>&1 | Out-String
Write-Output "  double-tap -> $(($dt -split "`n" | Where-Object { $_ -match 'before|after' }) -join ' ')"

$pz = & node tools/device-gesture.mjs pinch 540 900 80 300 12 2>&1 | Out-String
Write-Output "  pinch -> $(($pz -split "`n" | Where-Object { $_ -match 'after' }) -join '')"

Step 'summary'
if ($script:failed) {
  Write-Output '  RESULT: FAILED (see [FAIL] above)'
  exit 1
}
Write-Output '  RESULT: ALL CHECKS PASSED'
exit 0
