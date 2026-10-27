<#
  M1 设备端持久化验证（对应 docs/archive/legacy-development/m1/SPEC.md Gate 第 4 组后半句）：
  「该路径不依赖 localStorage（清空 localStorage 后仍能看到）」

  做法：pm clear 把 App 数据全部抹掉（WebView 的 localStorage 也在里面），
  重新启动后如果还能看到那条帖子，就只可能是从服务器读回来的。

  这是本里程碑最关键的一条断言：它把"看起来能发帖"和"真的落库了"区分开。

  用法： & '.\scripts\m1\device-persistence.ps1' -Marker "M1-真机 DEV-..."
#>
param(
  [Parameter(Mandatory = $true)][string]$Marker,
  [string]$Serial = '127.0.0.1:16384'
)
$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$pkg = 'com.campusx.demo'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$failed = 0
function Ok($m) { Write-Output "PASS $m" }
function Bad($m) { Write-Output "FAIL $m"; $script:failed = 1 }

function Start-App {
  & $adb -s $Serial shell am start -n "$pkg/.MainActivity" 2>&1 | Out-Null
}

# 注意：不能用 $pid —— 它是 PowerShell 的自动变量（当前进程号）
function Set-CdpForward {
  & $adb -s $Serial forward --remove-all 2>&1 | Out-Null
  $appPid = (& $adb -s $Serial shell pidof $pkg 2>&1 | Out-String).Trim()
  if (-not $appPid) { return $null }
  & $adb -s $Serial forward tcp:9222 "localabstract:webview_devtools_remote_$appPid" 2>&1 | Out-Null
  return $appPid
}

function Read-Probe {
  $json = & node (Join-Path $repo 'tools\device-eval.mjs') --file (Join-Path $repo 'scripts\m1\device-probe.js') 30000 2>&1
  $text = ($json | Out-String).Trim()
  try { return $text | ConvertFrom-Json } catch { return $null }
}

$LS_KEY = 'campus.demo.myPosts.v1'

Write-Output "标记: $Marker"

# ---- 1. 清空前的状态 ----
Write-Output ''
Write-Output '=== 1. pm clear 之前 ==='
Set-CdpForward | Out-Null
$before = Read-Probe
if (-not $before) { Bad '探测失败（清理前）'; }
else {
  $keysBefore = @($before.localStorageKeys)
  if ($keysBefore -contains $LS_KEY) { Ok "本地 localStorage 里确实有 $LS_KEY（说明有本地副本）" }
  else { Write-Output "NOTE 本地没有 $LS_KEY（本次 App 未在本地留下副本）" }
  if (($before.bodyText -as [string]) -like "*$Marker*") { Ok '清理前信息流能看到该帖' } else { Bad '清理前信息流看不到该帖' }
}

# ---- 2. 抹掉全部 App 数据 ----
Write-Output ''
Write-Output '=== 2. pm clear（连 localStorage 一起抹掉）==='
& $adb -s $Serial shell am force-stop $pkg 2>&1 | Out-Null
$clearOut = & $adb -s $Serial shell pm clear $pkg 2>&1 | Out-String
Write-Output "  pm clear: $($clearOut.Trim())"
if ($clearOut -match 'Success') { Ok 'App 数据已清空' } else { Bad "pm clear 未成功: $clearOut" }

# ---- 3. 重启并等待首屏 ----
Write-Output ''
Write-Output '=== 3. 重新启动 App ==='
Start-App
Start-Sleep -Milliseconds 5000
$appPid = Set-CdpForward
Write-Output "  WebView pid: $appPid"
if (-not $appPid) { Bad '拿不到 WebView pid' }

# ---- 4. 清理后的状态 ----
Write-Output ''
Write-Output '=== 4. 清空后判定 ==='
$after = $null
for ($i = 1; $i -le 12; $i++) {
  $after = Read-Probe
  if ($after -and (($after.bodyText -as [string]) -like "*$Marker*")) { break }
  Start-Sleep -Milliseconds 1500
}
if (-not $after) {
  Bad '探测失败（清理后）'
} else {
  $keysAfter = @($after.localStorageKeys)
  Write-Output "  localStorage keys: $($keysAfter -join ',')"
  if ($keysAfter -contains $LS_KEY) { Bad "localStorage 里仍有 $LS_KEY —— pm clear 没生效，本次验证不可信" }
  else { Ok 'localStorage 已被清空（本地副本确实没了）' }

  if (($after.bodyText -as [string]) -like "*$Marker*") { Ok '清空本地数据后信息流仍能看到该帖（只能来自服务器）' }
  else { Bad '清空后信息流看不到该帖 —— 说明帖子只存在本地' }

  Write-Output "  信息流片段: $(($after.bodyText -as [string]).Substring(0, [Math]::Min(150, ($after.bodyText -as [string]).Length)))"
}

Write-Output ''
if ($failed -eq 0) { Write-Output 'DEVICE_PERSIST PASS' } else { Write-Output 'DEVICE_PERSIST FAIL' }
exit $failed
