<#
  设备端逐页截图：用 CDP 把 APK 里的 WebView 导航到各路由，再用 adb 截图。
  产出：.mumu-capture/device/<路由>.png
  前置：应用已启动；adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
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
  '#/feedlist', '#/media?post=p1&i=0', '#/upgrade', '#/more'
)

foreach ($h in $hashes) {
  $label = ($h -replace '[/?#=&]', '_').TrimStart('_')
  $nav = & node 'G:\demo map\tools\device-nav.mjs' $h 1000 2>&1 | Select-Object -Last 1
  Write-Output "$label  ->  $nav"
  & $adb -s $s shell screencap -p /sdcard/dv.png | Out-Null
  & $adb -s $s pull /sdcard/dv.png (Join-Path $outDir "$label.png") 2>&1 | Out-Null
}
Write-Output "--- 截图目录: $outDir"
(Get-ChildItem $outDir -File).Count
