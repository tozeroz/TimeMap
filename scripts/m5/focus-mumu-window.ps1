<#
  把 MuMu 模拟器的窗口恢复到前台（Windows 主机侧）。
  =========================================================================
  为什么需要：MuMu 12 在**窗口最小化/失去前台**时会对 guest 做节流 ——
  实测表现为两个症状同时出现：
    1) adb shell screencap 反复返回**逐字节相同**的一帧（相差 2 分钟的截图哈希一致，
       连状态栏时钟都没变）→ 合成器不再产帧；
    2) adb shell input tap / swipe / keyevent **完全不生效**
       （连 POWER 键都不改 mWakefulness）→ 注入事件被丢弃。
  这时 UI 自动化会莫名其妙地"点了没反应"，很容易被误判成"选择器不可自动化"。

  本脚本只做"把窗口弄回前台并取消最小化"，**不碰 guest 里的任何数据**。

  用法：& scripts/m5/focus-mumu-window.ps1
#>
param([string]$ProcessName = 'MuMuNxDevice')

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@

$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) {
  Write-Output "MUMU_WINDOW_NOT_FOUND process=$ProcessName"
  exit 1
}
$h = $p.MainWindowHandle
Write-Output ("BEFORE pid={0} hwnd={1} iconic={2} visible={3} fg={4}" -f `
  $p.Id, $h, [Win32Focus]::IsIconic($h), [Win32Focus]::IsWindowVisible($h), `
  ([Win32Focus]::GetForegroundWindow() -eq $h))

if ([Win32Focus]::IsIconic($h)) { [Win32Focus]::ShowWindow($h, 9) | Out-Null }   # SW_RESTORE
[Win32Focus]::ShowWindow($h, 5) | Out-Null                                        # SW_SHOW
# HWND_TOP=0, SWP_NOSIZE=1, SWP_NOMOVE=2 —— 只调 z 序，不改尺寸/位置
[Win32Focus]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 3) | Out-Null
[Win32Focus]::BringWindowToTop($h) | Out-Null
[Win32Focus]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800

Write-Output ("AFTER  iconic={0} visible={1} fg={2}" -f `
  [Win32Focus]::IsIconic($h), [Win32Focus]::IsWindowVisible($h), `
  ([Win32Focus]::GetForegroundWindow() -eq $h))
