<#
  设备健康探针：确认"输入注入真的送到了""屏幕真的在重绘"。
  =========================================================================
  为什么动手前必须先跑这个：
    本次实测遇到一次 guest 整体卡死，症状是
      · adb shell screencap 反复返回**逐字节相同**的一帧（相隔 2 分钟，状态栏时钟都没变）
      · adb shell input tap / swipe / keyevent 全程无效果（连 POWER 键都不改 mWakefulness）
    而 dumpsys / uiautomator dump / CDP 都还正常 —— 于是"点了没反应"极易被误判成
    "系统选择器不可自动化"。实际是设备坏了，跟被测功能无关。

  判据（两条都要过）：
    A. 输入送达：下拉通知栏后**焦点窗口恰好变成 NotificationShade**（再按 BACK 收回）
    B. 屏幕重绘：下拉前后两次 screencap 的 SHA256 **不同**

  ⚠ 判据 A 必须用"从 dumpsys 里正则抠出的那一行"来比对，**不能拿整段 dumpsys 文本去 -match**：
    dumpsys window 全文里到处都有 "com.android.systemui"，那样判据恒为真（假阳性）。
    本文件第一版就犯了这个错 —— 输出里混进了整段 dumpsys 才看出来。

  用法：& scripts/m5/device-health-probe.ps1
  退出码：0=健康；1=不健康（输出里会给具体是哪一条没过）
#>
param(
  [string]$Adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe',
  [string]$Serial = '127.0.0.1:16384',
  [string]$TmpDir = "$env:TEMP\dsh-device-health"
)
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
if (-not (Test-Path $TmpDir)) { New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null }

function Sh([string[]]$cmd) { return (& $Adb -s $Serial shell @cmd 2>&1 | Out-String) }
<# 只抠出**最后一条** mCurrentFocus=... 这一行，避免整段 dumpsys 参与匹配 #>
function Focus() {
  $txt = Sh @('timeout', '8', 'dumpsys', 'window', 'displays')
  $ms = [regex]::Matches($txt, 'mCurrentFocus=Window\{[^\r\n]*')
  if ($ms.Count -eq 0) { return 'NONE' }
  return $ms[$ms.Count - 1].Value.Trim()
}
function TopResumed() {
  $txt = Sh @('timeout', '8', 'dumpsys', 'activity', 'activities')
  $ms = [regex]::Matches($txt, 'topResumedActivity=[^\r\n]*')
  if ($ms.Count -eq 0) { return 'NONE' }
  return $ms[0].Value.Trim()
}
function ShotHash([string]$name) {
  & $Adb -s $Serial shell screencap -p "/sdcard/$name" 2>&1 | Out-Null
  $local = Join-Path $TmpDir $name
  & $Adb -s $Serial pull "/sdcard/$name" $local 2>&1 | Out-Null
  if (-not (Test-Path $local)) { return 'PULL_FAILED' }
  return (Get-FileHash $local -Algorithm SHA256).Hash
}

$failed = @()
Write-Output '=== 设备健康探针 ==='
Write-Output ("topResumedActivity: " + (TopResumed))
$f0 = Focus
Write-Output "focus(before): $f0"
$h0 = ShotHash 'health-a.png'
Write-Output "screencap(before): $h0"

# 用"下拉通知栏"当探针：它是一个真实、可逆、且会改变焦点与画面的用户操作
Sh @('input', 'swipe', '540', '0', '540', '1300', '300') | Out-Null
Start-Sleep -Seconds 2
$f1 = Focus
Write-Output "focus(after swipe): $f1"
if ($f1 -match 'NotificationShade') {
  Write-Output '  PASS A 输入送达（下拉后焦点窗口 = NotificationShade）'
} else {
  $failed += 'A 输入未送达'; Write-Output '  FAIL A 输入未送达（下拉通知栏后焦点没变成 NotificationShade）'
}
<# ⚠ 必须在通知栏**还开着**的时候截图：
   第一版是"收回通知栏之后"才拍，画面已经回到原样 —— 两张图本来就该相同，
   于是健康的设备被判成"屏幕未重绘"（假阴性，实测踩到）。 #>
$h1 = ShotHash 'health-b.png'
Write-Output "screencap(shade open): $h1"
Sh @('input', 'keyevent', '4') | Out-Null
Start-Sleep -Seconds 2
if ($h0 -ne $h1 -and $h0 -ne 'PULL_FAILED' -and $h1 -ne 'PULL_FAILED') {
  Write-Output '  PASS B 屏幕在重绘（通知栏展开那一帧与之前不同）'
} else {
  $failed += 'B 屏幕未重绘（两次 screencap 完全相同）'; Write-Output '  FAIL B 屏幕未重绘'
}
Write-Output "focus(restored): $(Focus)"

$ErrorActionPreference = $prev
if ($failed.Count -eq 0) { Write-Output 'DEVICE_HEALTH OK'; exit 0 }
Write-Output ("DEVICE_HEALTH FAIL: " + ($failed -join '; '))
exit 1
