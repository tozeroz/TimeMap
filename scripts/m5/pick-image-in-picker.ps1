<#
  在**系统选择器里**按文件名找到一张图并真的点它（adb shell input tap）。
  =========================================================================
  为什么按文件名找而不是按位置点：
    设备上同时躺着好几张别的测试图（m5-wo2.png、native-picker-*.png、c*.png …），
    "点第一格"很可能点到别人的残留 —— 那样即使链路跑通，
    也证明不了"我们推的那张图被选中了"。按文件名定位才能把因果钉死。

  产物：
    1) 原始 uiautomator dump 存到 evidence 目录（文件名带时间戳）
    2) 标准输出里贴出**命中节点的原文**与由此算出的点击坐标
    3) 点击后轮询 topResumedActivity，直到离开 picker（或超时）

  用法：
    & scripts/m5/pick-image-in-picker.ps1 -Name m5-picker-probe-20260921.png
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$EvidenceDir = 'G:\demo map\docs\pending\m5\evidence',
  [string]$Adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe',
  [string]$Serial = '127.0.0.1:16384',
  [int]$TapTimeoutSec = 25
)
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
function Sh([string[]]$c) { return (& $Adb -s $Serial shell @c 2>&1 | Out-String) }
function TopResumed() {
  $ms = [regex]::Matches((Sh @('timeout','8','dumpsys','activity','activities')), 'topResumedActivity=[^\r\n]*')
  if ($ms.Count -eq 0) { return 'NONE' }
  return $ms[0].Value.Trim()
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not (Test-Path $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null }
$remote = "/sdcard/picker-$ts.xml"
$local = Join-Path $EvidenceDir "native-picker-tree-$ts.xml"

Sh @('uiautomator', 'dump', $remote) | Out-Null
& $Adb -s $Serial pull $remote $local 2>&1 | Out-Null
if (-not (Test-Path $local)) { Write-Output "PICK_FAIL 拉取 dump 失败（$remote）"; exit 1 }
$xml = [System.IO.File]::ReadAllText($local, [System.Text.UTF8Encoding]::new($false))
Write-Output "EVIDENCE_DUMP=$local"
Write-Output "DUMP_BYTES=$($xml.Length)"
Write-Output ("DOCUMENTSUI_HITS=" + ([regex]::Matches($xml, 'com\.android\.documentsui')).Count)
Write-Output ("RESOURCE_ID_KINDS=" + ([regex]::Matches($xml, 'resource-id="com\.android\.documentsui:id/[^"]+"') | ForEach-Object { $_.Value } | Sort-Object -Unique).Count)

# 命中节点：content-desc 或 text 里含文件名
$esc = [regex]::Escape($Name)
$nodes = [regex]::Matches($xml, "<node[^>]*(content-desc|text)=`"[^`"]*$esc[^`"]*`"[^>]*>")
Write-Output "HIT_COUNT=$($nodes.Count)"
if ($nodes.Count -eq 0) {
  Write-Output 'PICK_FAIL 树里找不到这张图（文件名没出现在 text / content-desc 里）'
  Write-Output '--- 树里现有的 png 文件名（前 20，供对照）---'
  ([regex]::Matches($xml, 'content-desc="([^"]*\.png[^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 20) | ForEach-Object { Write-Output "  $_" }
  $ErrorActionPreference = $prev; exit 1
}
# 取"最外层"的命中节点（它带 bounds，且不是 preview_icon 那种小按钮）
$chosen = $null
foreach ($n in $nodes) {
  if ($n.Value -match 'content-desc="[^"]*\.png,' ) { $chosen = $n; break }
}
if (-not $chosen) { $chosen = $nodes[0] }
Write-Output '--- 命中节点原文 ---'
Write-Output $chosen.Value
$b = [regex]::Match($chosen.Value, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
if (-not $b.Success) { Write-Output 'PICK_FAIL 命中节点没有 bounds'; $ErrorActionPreference = $prev; exit 1 }
$x1=[int]$b.Groups[1].Value; $y1=[int]$b.Groups[2].Value; $x2=[int]$b.Groups[3].Value; $y2=[int]$b.Groups[4].Value
$cx=[int](($x1+$x2)/2); $cy=[int](($y1+$y2)/2)
Write-Output "TAP_COORDS=$cx,$cy  (bounds 中心)"
Write-Output "TAP_COMMAND=adb -s $Serial shell input tap $cx $cy"

$before = TopResumed
Sh @('input', 'tap', "$cx", "$cy") | Out-Null
$after = $before
for ($i = 1; $i -le $TapTimeoutSec; $i++) {
  Start-Sleep -Seconds 1
  $after = TopResumed
  if ($after -notmatch 'documentsui') { break }
}
Write-Output ("TOP_AFTER_TAP=" + $after)
if ($after -notmatch 'documentsui') {
  Write-Output "PICK_OK 点击生效：picker 已不在前台（用时 ${i}s）"
  $ErrorActionPreference = $prev; exit 0
}
Write-Output 'PICK_FAIL 点了之后 picker 仍在前台（点击没被接受）'
$ErrorActionPreference = $prev; exit 1
