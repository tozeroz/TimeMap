<#
  .ps1 的 UTF-8 BOM 自查（H5，纯 ASCII 脚本）

  为什么需要它（2026-09-22 真实事故）：
    我用编辑工具改过 tools/deploy-server.ps1 之后，脚本突然解析失败，报
      "Missing '(' after 'if' in if statement.  + if [ ! -s "$KEY_FILE" ]; then"
    症状看着像 here-string 提前结束，**真因是编码**：
    编辑工具写回时**丢了 UTF-8 BOM**，Windows PowerShell 于是把文件按 ANSI 读，
    文件里的中文（如 Write-Error 'scp 失败（cleanup-auth bundle）'）被误解码，
    错误信息里出现乱码 "scp 澶辫触锛坈leanup-auth bundle锛?" 就是证据。

  规则（本项目纪律，与既有 "无 BOM 的 .ps1 会被当 ANSI 读" 同源）：
    · 含非 ASCII 字符的 .ps1 **必须**带 UTF-8 BOM（EF BB BF）
    · 纯 ASCII 的 .ps1 无 BOM 也安全（但仍建议统一加）
    · 改过 .ps1 之后、提交之前，跑一次本脚本

  用法：
    powershell -NoProfile -File tools\check-ps1-bom.ps1              # 扫全仓
    powershell -NoProfile -File tools\check-ps1-bom.ps1 -Path tools  # 扫指定目录

  退出码：0 = 全部合格；1 = 存在"含非 ASCII 但缺 BOM"的文件
#>
param(
  [string]$Path = '.'
)

$ErrorActionPreference = 'Continue'
$bad = 0
$checked = 0
$asciiOnlyNoBom = 0

$files = Get-ChildItem -Path $Path -Recurse -Filter '*.ps1' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|android\\build|\.gradle)\\' }

foreach ($f in $files) {
  $checked++
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)

  # 判断是否含非 ASCII 字节（>0x7F）
  $hasNonAscii = $false
  foreach ($b in $bytes) {
    if ($b -gt 0x7F) { $hasNonAscii = $true; break }
  }

  if ($hasNonAscii -and -not $hasBom) {
    Write-Output "  FAIL $($f.FullName.Replace((Resolve-Path $Path).Path + '\', ''))  —— 含非 ASCII 但缺 UTF-8 BOM（会被 PowerShell 当 ANSI 读而解析失败）"
    $bad++
  } elseif (-not $hasBom) {
    $asciiOnlyNoBom++
  }
}

Write-Output ''
Write-Output "  扫描 $checked 个 .ps1"
Write-Output "  含非 ASCII 且缺 BOM（**必须修**）: $bad"
Write-Output "  纯 ASCII 且无 BOM（安全，但建议统一）: $asciiOnlyNoBom"
Write-Output ''
if ($bad -eq 0) {
  Write-Output 'PS1_BOM_CHECK: PASS'
  exit 0
} else {
  Write-Output 'PS1_BOM_CHECK: FAIL —— 用 tools/fix-ps1-bom.ps1 修（它会补 BOM）'
  exit 1
}
