<#
  Device-side screenshots for every route, with a freeze guard.

  Why the guard: on this MuMu/WebView combo the renderer occasionally freezes --
  the DOM updates (CDP assertions still pass) but screencap keeps returning the
  SAME cached frame. Symptom: N consecutive screenshots with identical hashes.
  Recovery: force-stop + restart the app, then re-open the CDP channel.

  Output: .mumu-capture/device/<route>.png
#>
$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$s = '127.0.0.1:16384'
$outDir = 'G:\demo map\.mumu-capture\device'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$hashes = @(
  '#/campus', '#/me', '#/map', '#/feed?id=p1', '#/comments?id=p1',
  '#/message', '#/chat?id=t1', '#/group?id=g1', '#/board', '#/daily',
  '#/poi', '#/poidetail', '#/publish', '#/scanner',
  '#/login', '#/loginselect', '#/onboarding', '#/announce',
  '#/feedlist', '#/media?post=p1&i=0', '#/upgrade', '#/more',
  '#/user?id=u1', '#/profile-edit', '#/account', '#/verify',
  '#/privacy', '#/blacklist', '#/about', '#/contact'
)

function ReconnectCdp {
  $appPid = (& $adb -s $s shell pidof com.campusx.demo | Out-String).Trim()
  & $adb -s $s forward --remove-all 2>&1 | Out-Null
  & $adb -s $s forward tcp:9222 "localabstract:webview_devtools_remote_$appPid" | Out-Null
  return $appPid
}

function RestartApp {
  Write-Output '    [freeze guard] restarting app ...'
  & $adb -s $s shell am force-stop com.campusx.demo | Out-Null
  Start-Sleep -Milliseconds 1200
  & $adb -s $s shell am start -n com.campusx.demo/.MainActivity | Out-Null
  Start-Sleep -Milliseconds 5500
  ReconnectCdp | Out-Null
}

$null = ReconnectCdp
$lastHash = ''
$sameRun = 0
$shots = 0

foreach ($h in $hashes) {
  $label = ($h -replace '[/?#=&]', '_').TrimStart('_')
  & node 'G:\demo map\tools\device-nav.mjs' $h 1100 | Out-Null

  & $adb -s $s shell screencap -p /sdcard/dv.png | Out-Null
  $local = Join-Path $outDir "$label.png"
  & $adb -s $s pull /sdcard/dv.png $local 2>&1 | Out-Null
  $hash = (Get-FileHash $local -Algorithm MD5).Hash

  if ($hash -eq $lastHash) { $sameRun++ } else { $sameRun = 0 }
  $lastHash = $hash
  $shots++

  Write-Output ("{0,-22} {1,9} bytes  sameRun={2}" -f $label, (Get-Item $local).Length, $sameRun)

  if ($sameRun -ge 2) {
    RestartApp
    & node 'G:\demo map\tools\device-nav.mjs' $h 1200 | Out-Null
    & $adb -s $s shell screencap -p /sdcard/dv.png | Out-Null
    & $adb -s $s pull /sdcard/dv.png $local 2>&1 | Out-Null
    $lastHash = (Get-FileHash $local -Algorithm MD5).Hash
    $sameRun = 0
    Write-Output "    re-captured $label after restart"
  }
}

Write-Output "--- shots: $shots   dir: $outDir"
