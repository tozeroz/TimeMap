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

Step '5d/6 map dialog must be really tappable'
# Regression guard for a real-device bug: the location dialog was visible but every tap
# was swallowed by a transparent z-index:1000 layer inside the map SDK. Programmatic
# element.click() bypasses hit testing, so the old checks never caught it - tap for real.
& node tools/device-eval.mjs "localStorage.setItem('probe.mapHash', '#/map?ask=1')" 15000 | Out-Null
& node tools/device-eval.mjs --file tools/checks/map-reopen-modal.js 30000 | Out-Null
$rectsRaw = & node tools/device-eval.mjs --file tools/checks/map-modal-rects.js 20000 2>&1 | Out-String
$rects = $rectsRaw | ConvertFrom-Json
Write-Output "  dialog present: $($rects.modalPresent)  buttons: $($rects.buttonCount)"
if (-not $rects.modalPresent) {
  Fail 'location dialog did not appear when entering the map'
} else {
  Write-Output "  real tap on '$($rects.skipText)' at $($rects.skipCenter -join ',')"
  & node tools/device-gesture.mjs tap $rects.skipCenter[0] $rects.skipCenter[1] | Out-Null
  Start-Sleep -Milliseconds 600
  $st = (& node tools/device-eval.mjs --file tools/checks/map-modal-state.js 20000 2>&1 | Out-String) | ConvertFrom-Json
  Write-Output "  after tap: modalPresent=$($st.modalPresent)"
  if ($st.modalPresent) { Fail 'location dialog cannot be dismissed by a real tap (covered by a map SDK layer?)' }
  # and the floating map controls must be tappable too (same class of bug)
  $ctrlRaw = & node tools/device-eval.mjs --file tools/checks/map-ctrl-rects.js 20000 2>&1 | Out-String
  $ctrl = $ctrlRaw | ConvertFrom-Json
  & node tools/device-eval.mjs --file tools/checks/map-snapshot.js 20000 | Out-Null
  Write-Output "  real tap on zoom control at $($ctrl.zoomCenter -join ',')"
  & node tools/device-gesture.mjs tap $ctrl.zoomCenter[0] $ctrl.zoomCenter[1] | Out-Null
  Start-Sleep -Milliseconds 500
  $ctl = & node tools/device-eval.mjs --file tools/checks/map-compare.js 25000 2>&1 | Out-String
  Write-Output "  zoom control -> $(($ctl -split "`n" | Where-Object { $_ -match 'zoomDelta|changed' }) -join ' ')"
  if ($ctl -notmatch '"changed": true') { Fail 'floating zoom control cannot be tapped (covered by a map SDK layer?)' }
}

Step '5e/6 publish page: real in-app camera (not the system camera app)'
$cam = & node tools/device-eval.mjs --file tools/checks/publish-camera.js 40000 2>&1 | Out-String
Write-Output "  $(($cam -split "`n" | Where-Object { $_ -match 'camState|controlOrder|fallbackText|videoSize|poi' }) -join ' ')"
if ($cam -notmatch '"hasVideoEl": true') { Fail 'publish capture mode has no <video> viewfinder element' }
if ($cam -notmatch '"threeKeysOk": true') { Fail 'bottom bar first two keys are not [gallery][shutter]' }
if ($cam -notmatch '"lastKeyIsFlip": true') { Fail 'bottom bar third key is not the camera flip key' }
if ($cam -notmatch '"tabsOk": true') { Fail 'mode tabs are not [voice][capture][text]' }
if ($cam -notmatch '"camHandled": true') { Fail 'camera state neither live nor gracefully degraded with a readable message' }

Step '6/6 map gestures (online, Tencent GL SDK)'
& node tools/device-eval.mjs "localStorage.setItem('probe.mapHash', '#/map')" 15000 | Out-Null
$open = & node tools/device-eval.mjs --file tools/checks/map-open.js 40000 2>&1 | Out-String
Write-Output "  open -> $(($open -split "`n" | Where-Object { $_ -match 'hash|mode|badge|markers|center|zoom' }) -join ' ')"
if ($open -notmatch '"mode": "tencent"') { Fail 'Tencent GL SDK map did not render' }
if ($open -match '"markers": 0') { Fail 'no map markers rendered' }

& node tools/device-eval.mjs --file tools/checks/map-snapshot.js 20000 | Out-Null
& $adb -s $serial shell input swipe 800 1300 300 800 700
Start-Sleep -Milliseconds 600
$drag = & node tools/device-eval.mjs --file tools/checks/map-compare.js 20000 2>&1 | Out-String
Write-Output "  drag -> $(($drag -split "`n" | Where-Object { $_ -match 'moved|changed' }) -join ' ')"
if ($drag -notmatch '"changed": true') { Fail 'online map drag did not pan' }

# zoom-in button (the compass icon): a real user-reachable path. map-compare polls until the animation settles.
$zoomClick = & node tools/device-eval.mjs --file tools/checks/map-zoom-click.js 15000 2>&1 | Out-String
Write-Output "  zoomBtn -> $(($zoomClick -split "`n" | Where-Object { $_ -match 'aria' }) -join ' ')"
$zoom = & node tools/device-eval.mjs --file tools/checks/map-compare.js 25000 2>&1 | Out-String
Write-Output "  zoom -> $(($zoom -split "`n" | Where-Object { $_ -match 'spreadRatio|changed' }) -join ' ')"
if ($zoom -notmatch '"changed": true') { Fail 'online map zoom button had no effect' }

# raster tile fallback (Leaflet) must still render: force it via the URL param
& node tools/device-eval.mjs "localStorage.setItem('probe.mapHash', '#/map?raster=1')" 15000 | Out-Null
$raster = & node tools/device-eval.mjs --file tools/checks/map-open.js 40000 2>&1 | Out-String
Write-Output "  raster -> $(($raster -split "`n" | Where-Object { $_ -match 'hash|mode|markers|tilesLoaded' }) -join ' ')"
if ($raster -notmatch '"mode": "raster"') { Fail 'raster tile fallback did not render' }

# Amap official JSAPI (second in the chain): force it and confirm key + security code work
& node tools/device-eval.mjs "localStorage.setItem('probe.mapHash', '#/map?amap=1')" 15000 | Out-Null
$amap = & node tools/device-eval.mjs --file tools/checks/map-open.js 40000 2>&1 | Out-String
Write-Output "  amap -> $(($amap -split "`n" | Where-Object { $_ -match 'hash|mode|badge|markers|canvases' }) -join ' ')"
if ($amap -notmatch '"mode": "amap"') { Fail 'Amap JSAPI did not render' }
if ($amap -match '"markers": 0') { Fail 'no map markers on Amap' }

& node tools/device-eval.mjs --file tools/checks/map-snapshot.js 20000 | Out-Null
& $adb -s $serial shell input swipe 800 1300 300 800 700
Start-Sleep -Milliseconds 600
$adrag = & node tools/device-eval.mjs --file tools/checks/map-compare.js 20000 2>&1 | Out-String
Write-Output "  amap-drag -> $(($adrag -split "`n" | Where-Object { $_ -match 'centerMovedM|moved|changed' }) -join ' ')"
if ($adrag -notmatch '"changed": true') { Fail 'Amap map drag did not pan' }

& node tools/device-eval.mjs --file tools/checks/map-ctrl-recenter.js 15000 | Out-Null
Start-Sleep -Milliseconds 1200

Step '6b/6 map gestures (offline fallback, #/map?offline=1)'
& node tools/device-eval.mjs "localStorage.setItem('probe.mapHash', '#/map?offline=1')" 15000 | Out-Null
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

Step '7/6 publish: the gallery key must open the real system picker'
# Last stage on purpose: it launches a system UI, so keep it away from the other checks.
& node tools/device-eval.mjs "location.hash='#/publish'" 15000 | Out-Null
Start-Sleep -Milliseconds 2500
$galleryRaw = & node tools/device-eval.mjs --file tools/checks/publish-gallery-rect.js 20000 2>&1 | Out-String
$gallery = $galleryRaw | ConvertFrom-Json
if (-not $gallery.center) {
  Fail 'gallery key not found on the publish page'
} else {
  Write-Output "  real tap on gallery key at $($gallery.center -join ',')"
  & node tools/device-gesture.mjs tap $gallery.center[0] $gallery.center[1] | Out-Null
  Start-Sleep -Milliseconds 2500
  $focus = & $adb -s $serial shell dumpsys window 2>&1 | Select-String 'mCurrentFocus' | Out-String
  Write-Output "  focus -> $($focus.Trim())"
  if ($focus -notmatch 'documentsui|picker|gallery|photos') {
    Fail 'gallery key did not open a system photo picker'
  }
  & $adb -s $serial shell input keyevent KEYCODE_BACK | Out-Null
  Start-Sleep -Milliseconds 1200
}

Step 'summary'
if ($script:failed) {
  Write-Output '  RESULT: FAILED (see [FAIL] above)'
  exit 1
}
Write-Output '  RESULT: ALL CHECKS PASSED'
exit 0
