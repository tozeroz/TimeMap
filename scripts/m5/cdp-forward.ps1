<#
  CDP 转发（重建）：App 冷启动后 WebView 的 pid 会变，旧 forward 会指向死掉的 socket，
  表现为 "没有可调试页面"。所以每轮验证前都无条件重建一次。
  用法：pwsh -File scripts/m5/cdp-forward.ps1 [-Pkg com.campusx.demo] [-Port 9222]
#>
param(
  [string]$Pkg = 'com.campusx.demo',
  [int]$Port = 9222,
  [string]$Adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe',
  [string]$Serial = '127.0.0.1:16384'
)
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$pidText = (& $Adb -s $Serial shell pidof $Pkg 2>&1 | Out-String).Trim()
if (-not $pidText) { Write-Output "NO_PID $Pkg"; exit 1 }
& $Adb -s $Serial forward --remove-all 2>&1 | Out-Null
$out = (& $Adb -s $Serial forward "tcp:$Port" "localabstract:webview_devtools_remote_$pidText" 2>&1 | Out-String).Trim()
$ErrorActionPreference = $prev
# 校验转发真的通了（只看 adb 打印会漏掉"转发建了但页面没起来"）
try {
  $t = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 5
  Write-Output "CDP_FORWARD OK pid=$pidText browser=$($t.Browser) forward='$out'"
} catch {
  Write-Output "CDP_FORWARD FAIL pid=$pidText forward='$out' err=$($_.Exception.Message)"
  exit 2
}
