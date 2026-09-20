<#
  MuMu 勘察辅助脚本
  用法:
    .\tools\mumu.ps1 capture 标签                 # 只截图
    .\tools\mumu.ps1 tap X Y [标签]               # 点击后截图
    .\tools\mumu.ps1 tapmany 标签 X1,Y1 X2,Y2 ... # 连续多次点击后截图
    .\tools\mumu.ps1 swipe X1 Y1 X2 Y2 毫秒 [标签]
    .\tools\mumu.ps1 key 事件码 [标签]            # 例如 4=返回 3=Home
    .\tools\mumu.ps1 focus                        # 打印当前前台窗口
    .\tools\mumu.ps1 clean                        # 清理设备端临时文件
#>
param(
  [Parameter(Position = 0)][string]$Action = 'focus',
  [Parameter(Position = 1)][string]$A1,
  [Parameter(Position = 2)][string]$A2,
  [Parameter(Position = 3)][string]$A3,
  [Parameter(Position = 4)][string]$A4,
  [Parameter(Position = 5)][string]$A5,
  [Parameter(Position = 6)][string]$A6
)

$ErrorActionPreference = 'Stop'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$serial = '127.0.0.1:16384'
$outDir = 'G:\demo map\.mumu-capture'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Invoke-Adb {
  param([string[]]$Args)
  & $adb -s $serial @Args 2>&1 | Out-Null
}

function Get-Capture {
  param([string]$Label)
  $remote = "/sdcard/dsh-$Label.png"
  Invoke-Adb @('shell', 'screencap', '-p', $remote)
  $local = Join-Path $outDir "$Label.png"
  & $adb -s $serial pull $remote $local 2>&1 | Out-Null
  Invoke-Adb @('shell', 'rm', '-f', $remote)
  if (Test-Path $local) {
    $len = (Get-Item $local).Length
    Write-Output "shot: $local ($len bytes)"
  } else {
    Write-Output "shot FAILED: $local"
  }
}

function Get-Focus {
  $line = (& $adb -s $serial shell dumpsys window 2>&1 | Select-String 'mCurrentFocus' | Select-Object -First 1).ToString().Trim()
  Write-Output "focus: $line"
}

switch ($Action) {
  'focus'   { Get-Focus }
  'clean'   { Invoke-Adb @('shell', 'rm', '-f', '/sdcard/dsh-*'); Write-Output 'cleaned' }
  'capture' { Get-Capture -Label $A1 }
  'tap'     {
    Invoke-Adb @('shell', 'input', 'tap', $A1, $A2)
    Start-Sleep -Milliseconds 1500
    Get-Capture -Label $A3
    Get-Focus
  }
  'swipe'   {
    Invoke-Adb @('shell', 'input', 'swipe', $A1, $A2, $A3, $A4, $A5)
    Start-Sleep -Milliseconds 2000
    Get-Capture -Label $A6
    Get-Focus
  }
  'key'     {
    Invoke-Adb @('shell', 'input', 'keyevent', $A1)
    Start-Sleep -Milliseconds 1200
    Get-Capture -Label $A2
    Get-Focus
  }
  'tapmany' {
    $label = $A1
    $pairs = @($A2, $A3, $A4, $A5, $A6) | Where-Object { $_ }
    foreach ($p in $pairs) {
      $xy = $p.Split(',')
      Invoke-Adb @('shell', 'input', 'tap', $xy[0], $xy[1])
      Start-Sleep -Milliseconds 1500
    }
    Get-Capture -Label $label
    Get-Focus
  }
  default { Write-Output "unknown action: $Action" }
}
