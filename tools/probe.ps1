<#
  对原版 app 做「逐按钮探测」。
  用法示例：
    & .\tools\probe.ps1 -Route 'campusx://trident' -Prefix 'campus' -Targets '键盘:540,1700','卡片:270,700'

  对每个目标：截图(before) → 点击 → 等待 → 截图(after)，并报告画面是否变化。
  产物：.mumu-capture/probe/<prefix>-<序号>-<标签>-before.png / -after.png
#>
param(
  [Parameter(Mandatory = $true)][string]$Route,
  [Parameter(Mandatory = $true)][string]$Prefix,
  [Parameter(Mandatory = $true)][string[]]$Targets,
  [int]$WaitMs = 1400
)

$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$s = '127.0.0.1:16384'
$outDir = 'G:\demo map\.mumu-capture\probe'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Shot([string]$name) {
  & $adb -s $s shell screencap -p /sdcard/p.png | Out-Null
  $local = Join-Path $outDir "$name.png"
  & $adb -s $s pull /sdcard/p.png $local 2>&1 | Out-Null
  if (Test-Path $local) { return (Get-FileHash $local -Algorithm MD5).Hash } else { return 'FAIL' }
}

# 先打开目标页面
& $adb -s $s shell am start -a android.intent.action.VIEW -d $Route 2>&1 | Out-Null
Start-Sleep -Milliseconds 2600

$n = 0
foreach ($t in $Targets) {
  $n++
  $parts = $t.Split(':')
  $label = $parts[0]
  $xy = $parts[1].Split(',')
  $x = $xy[0]; $y = $xy[1]

  $before = Shot "$Prefix-$n-$label-before"
  & $adb -s $s shell input tap $x $y
  Start-Sleep -Milliseconds $WaitMs
  $after = Shot "$Prefix-$n-$label-after"

  $changed = if ($before -ne $after) { 'CHANGED' } else { 'same' }
  Write-Output ("{0,-14} ({1,4},{2,4})  {3}" -f $label, $x, $y, $changed)

  # 回到该页面，保证每个按钮都在同一初始状态下测试
  & $adb -s $s shell am start -a android.intent.action.VIEW -d $Route 2>&1 | Out-Null
  Start-Sleep -Milliseconds 1800
}
Write-Output "图片目录: $outDir"
