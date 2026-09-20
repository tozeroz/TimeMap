<#
  批量勘察目标 app 的核心页面（用 deep link 逐页打开并截图）。
  输出：.mumu-capture/sweep/<序号>-<标签>.png + sweep-report.txt
  注意：变量名不要用 $routes —— 那是 PowerShell 的自动变量。
#>
$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$s = '127.0.0.1:16384'
$outDir = 'G:\demo map\.mumu-capture\sweep'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$report = 'G:\demo map\.mumu-capture\sweep-report.txt'
if (Test-Path $report) { Remove-Item -LiteralPath $report -Force }

$pageList = [ordered]@{
  '01-trident'    = 'campusx://trident'
  '02-map'        = 'campusx://map'
  '03-daily'      = 'campusx://feed/daily'
  '04-feedlist'   = 'campusx://feed/list'
  '05-board'      = 'campusx://messageBoard'
  '06-poi-search' = 'campusx://poi/search'
  '07-poi-detail' = 'campusx://feed/poi/detail'
  '08-feeddetail' = 'campusx://feed/detail'
  '09-cmtdetail'  = 'campusx://feed/comment/detail'
  '10-message'    = 'campusx://message'
  '11-chat'       = 'campusx://chat'
  '12-group'      = 'campusx://group'
  '13-announce'   = 'campusx://announce'
  '14-webview'    = 'campusx://webview'
  '15-login-sel'  = 'campusx://login/select'
  '16-login-sns'  = 'campusx://login/sns'
  '17-onboarding' = 'campusx://login/onboarding'
  '18-publish'    = 'campusx://publish_post'
}

$lines = New-Object System.Collections.ArrayList
foreach ($key in $pageList.Keys) {
  $uri = $pageList[$key]
  Write-Output "=== $key  <-  $uri"
  & $adb -s $s shell am start -a android.intent.action.VIEW -d $uri 2>&1 | Out-Null
  Start-Sleep -Milliseconds 2600
  $focus = (& $adb -s $s shell dumpsys window 2>&1 | Select-String 'mCurrentFocus' | Select-Object -First 1).ToString().Trim()
  $remote = "/sdcard/sw-$key.png"
  & $adb -s $s shell screencap -p $remote 2>&1 | Out-Null
  $local = Join-Path $outDir "$key.png"
  & $adb -s $s pull $remote $local 2>&1 | Out-Null
  & $adb -s $s shell rm -f $remote 2>&1 | Out-Null
  $len = 0
  if (Test-Path $local) { $len = (Get-Item $local).Length }
  [void]$lines.Add("$key`t$uri`t$focus`t$len")
  Write-Output "    $focus  ($len bytes)"
  & $adb -s $s shell input keyevent 3 2>&1 | Out-Null
  Start-Sleep -Milliseconds 700
}

$lines | Set-Content -LiteralPath $report -Encoding UTF8
Write-Output "--- report written: $report"
