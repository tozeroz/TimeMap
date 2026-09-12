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

Step '5c/6 real geolocation'
$geo = & node tools/device-eval.mjs --file tools/checks/geo-location.js 45000 2>&1 | Out-String
Write-Output "  $(($geo -split "`n" | Where-Object { $_ -match 'badge|"lat"|realFix|recenterOk' }) -join ' ')"
if ($geo -notmatch '"realFix": true') {
  Write-Output '  [SKIP] location not granted - run: adb shell pm grant com.campusx.demo android.permission.ACCESS_FINE_LOCATION'
} elseif ($geo -notmatch '"recenterOk": true') {
  Fail 'recenter button did not fly to the real fix'
} elseif ($geo -notmatch '"notCampusFallback": true') {
  Fail 'blue dot is still the campus fallback while a real fix exists'
}

Step '6/6 map gestures (online Leaflet)'
& node tools/device-nav.mjs '#/map' 1300 | Out-Null
$open = & node tools/device-eval.mjs --file tools/checks/map-open.js 40000 2>&1 | Out-String
Write-Output "  open -> $(($open -split "`n" | Where-Object { $_ -match 'mode|markers|tilesLoaded' }) -join ' ')"
if ($open -notmatch '"mode": "online"') { Fail 'online map did not render' }
if ($open -match '"markers": 0') { Fail 'no map markers rendered' }

& node tools/device-eval.mjs --file tools/checks/map-snapshot.js 20000 | Out-Null
& $adb -s $serial shell input swipe 800 1300 300 800 700
Start-Sleep -Milliseconds 600
$drag = & node tools/device-eval.mjs --file tools/checks/map-compare.js 20000 2>&1 | Out-String
Write-Output "  drag -> $(($drag -split "`n" | Where-Object { $_ -match 'moved|changed' }) -join ' ')"
if ($drag -notmatch '"changed": true') { Fail 'online map drag did not pan' }

# 放大按钮（罗盘图标）= 用户真实可点的路径；map-compare 会轮询等动画结束
$zoomClick = & node tools/device-eval.mjs --file tools/checks/map-zoom-click.js 15000 2>&1 | Out-String
Write-Output "  zoomBtn -> $(($zoomClick -split "`n" | Where-Object { $_ -match 'aria' }) -join ' ')"
$zoom = & node tools/device-eval.mjs --file tools/checks/map-compare.js 25000 2>&1 | Out-String
Write-Output "  zoom -> $(($zoom -split "`n" | Where-Object { $_ -match 'spreadRatio|changed' }) -join ' ')"
if ($zoom -notmatch '"changed": true') { Fail 'online map zoom button had no effect' }

& node tools/device-eval.mjs --file tools/checks/map-ctrl-recenter.js 15000 | Out-Null
Start-Sleep -Milliseconds 1200

Step '6b/6 map gestures (offline fallback, #/map?offline=1)'
& node tools/device-nav.mjs '#/map?offline=1' 1500 | Out-Null
$off = & node tools/device-eval.mjs --file tools/checks/map-open.js 40000 2>&1 | Out-String
Write-Output "  open -> $(($off -split "`n" | Where-Object { $_ -match 'mode|markers' }) -join ' ')"
if ($off -notmatch '"mode": "offline"') { Fail 'offline fallback map did not render' }

& node tools/device-eval.mjs --file tools/checks/map-snapshot.js 20000 | Out-Null
& $adb -s $serial shell input swipe 800 1300 300 800 700
Start-Sleep -Milliseconds 600
$odrag = & node tools/device-eval.mjs --file tools/checks/map-compare.js 20000 2>&1 | Out-String
Write-Output "  drag -> $(($odrag -split "`n" | Where-Object { $_ -match 'moved|changed' }) -join ' ')"
if ($odrag -notmatch '"changed": true') { Fail 'offline map drag did not pan' }

& node tools/device-gesture.mjs double-tap 540 900 2>&1 | Out-Null
$dtr = & node tools/device-eval.mjs --file tools/checks/map-compare.js 20000 2>&1 | Out-String
Write-Output "  double-tap -> $(($dtr -split "`n" | Where-Object { $_ -match 'spreadRatio|changed' }) -join ' ')"
if ($dtr -notmatch '"changed": true') { Fail 'offline map double-tap zoom had no effect' }

& node tools/device-gesture.mjs pinch 540 900 80 300 12 2>&1 | Out-Null
$pzr = & node tools/device-eval.mjs --file tools/checks/map-compare.js 20000 2>&1 | Out-String
Write-Output "  pinch -> $(($pzr -split "`n" | Where-Object { $_ -match 'spreadRatio|changed' }) -join ' ')"
if ($pzr -notmatch '"changed": true') { Fail 'offline map pinch zoom had no effect' }

Step 'summary'
if ($script:failed) {
  Write-Output '  RESULT: FAILED (see [FAIL] above)'
  exit 1
}
Write-Output '  RESULT: ALL CHECKS PASSED'
exit 0
