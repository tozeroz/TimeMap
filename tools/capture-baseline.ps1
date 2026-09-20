<#
  M0：采集「原版行为基线」截图。

  做法：用原版 app 自己的 deep link（campusx://）直接跳到每一页，
  不需要猜点击坐标；截图后降采样到 540x960 存入仓库（原始全分辨率留在 .mumu-capture/ 不入库）。

  输出：
    .mumu-capture/baseline/<screen-id>.png          原始 1080x1920
    docs/original-baseline/screens/<id>/normal.png  540x960（入库）
    .mumu-capture/baseline/capture-report.txt       每页的 Activity / 文件大小

  用法： & '.\tools\capture-baseline.ps1'
#>
param(
  # 只采这些（留空=全部）
  [string[]]$Only = @()
)
$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$s = '127.0.0.1:16384'
$root = 'G:\demo map'
$rawDir = Join-Path $root '.mumu-capture\baseline'
$docsDir = Join-Path $root 'docs\original-baseline'
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $docsDir 'screens') | Out-Null

# 22 个有界面的原版页面（来源：APK 内 TheRouter 路由表，见 docs/page-map.md）
$pages = [ordered]@{
  'trident-campus' = 'campusx://trident'
  'trident-me'     = 'campusx://trident?tab=me'      # 备注：需落个人 tab，见下方 special 处理
  'trident-map'    = 'campusx://map'
  'feed-list'      = 'campusx://feed/list'
  'feed-daily'     = 'campusx://feed/daily'
  'feed-detail'    = 'campusx://feed/detail'
  'comment-detail' = 'campusx://feed/comment/detail'
  'message-board'  = 'campusx://messageBoard'
  'poi-search'     = 'campusx://poi/search'
  'poi-detail'     = 'campusx://feed/poi/detail'
  'publish'        = 'campusx://publish_post'
  'message'        = 'campusx://message'
  'chat'           = 'campusx://chat'
  'group'          = 'campusx://group'
  'announce'       = 'campusx://announce'
  'scanner'        = 'campusx://scanner'
  'login-select'   = 'campusx://login/select'
  'login-sns'      = 'campusx://login/sns'
  'onboarding'     = 'campusx://login/onboarding'
  'upgrade-alert'  = 'campusx://upgradeAlert'
  'media-preview'  = 'campusx://chat/media-preview'
  'at-panel'       = 'campusx://group/atPanel'
}

Add-Type -AssemblyName System.Drawing
function Resize-Png([string]$src, [string]$dst, [int]$w = 540, [int]$h = 960) {
  $img = [System.Drawing.Image]::FromFile($src)
  try {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose()
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally { $img.Dispose() }
}

$report = New-Object System.Collections.ArrayList
$keys = $pages.Keys
if ($Only.Count -gt 0) { $keys = $keys | Where-Object { $Only -contains $_ } }

foreach ($id in $keys) {
  $uri = $pages[$id]
  & $adb -s $s shell input keyevent 3 2>&1 | Out-Null
  Start-Sleep -Milliseconds 500
  & $adb -s $s shell am start -a android.intent.action.VIEW -d $uri 2>&1 | Out-Null
  Start-Sleep -Milliseconds 3000
  $focus = ((& $adb -s $s shell dumpsys window 2>&1 | Select-String 'mCurrentFocus' | Select-Object -First 1) -replace '.*mCurrentFocus=', '').Trim()

  $remote = "/sdcard/bl-$id.png"
  & $adb -s $s shell screencap -p $remote 2>&1 | Out-Null
  $raw = Join-Path $rawDir "$id.png"
  & $adb -s $s pull $remote $raw 2>&1 | Out-Null
  & $adb -s $s shell rm -f $remote 2>&1 | Out-Null

  $destDir = Join-Path (Join-Path $docsDir 'screens') $id
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $small = Join-Path $destDir 'normal.png'
  $rawLen = 0; $smallLen = 0
  if (Test-Path -LiteralPath $raw) {
    $rawLen = (Get-Item -LiteralPath $raw).Length
    Resize-Png $raw $small
    if (Test-Path -LiteralPath $small) { $smallLen = (Get-Item -LiteralPath $small).Length }
  }
  $line = "$id`t$uri`t$focus`t$rawLen`t$smallLen"
  [void]$report.Add($line)
  Write-Output ("{0,-16} {1,-26} raw={2,9} small={3,7}" -f $id, $focus.Split('/')[-1], $rawLen, $smallLen)
}

$report | Set-Content -LiteralPath (Join-Path $rawDir 'capture-report.txt') -Encoding UTF8
Write-Output "--- report: $rawDir\capture-report.txt"
