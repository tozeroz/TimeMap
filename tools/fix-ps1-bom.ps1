<#
  给仓库里所有"含非 ASCII 字符但缺 UTF-8 BOM"的 .ps1 补上 BOM。

  为什么需要这个工具：
    PowerShell 5.1 读 .ps1 时若无 BOM，会按 ANSI(GBK) 解码。
    中文注释被解成乱码后，"乱码里恰好凑出引号或 @" 会把 here-string 提前截断，
    整个脚本结构随之崩坏；而且报错位置离真正原因很远
    （表现为"某个函数就是没执行"），极难排查。
    本项目已因此踩过两次：一次搞坏了服务器上的 systemd unit 文件。

    注意：用编辑器/脚本批量改 .ps1 时 BOM 很容易被抹掉（本仓库的 edit 工具就会），
    所以每次改完 .ps1、以及每次提交前，跑一下这个脚本。

  用法： & '.\tools\fix-ps1-bom.ps1'
#>
$root = Split-Path $PSScriptRoot -Parent
$files = Get-ChildItem -Path $root -Recurse -Filter *.ps1 -File |
  Where-Object { $_.FullName -notmatch 'node_modules' }

$fixed = 0
foreach ($f in $files) {
  $bytes = [IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  if ($hasBom) { continue }
  $nonAscii = $false
  foreach ($x in $bytes) { if ($x -gt 0x7F) { $nonAscii = $true; break } }
  if (-not $nonAscii) { continue }

  $txt = [Text.Encoding]::UTF8.GetString($bytes)
  [IO.File]::WriteAllText($f.FullName, $txt, (New-Object Text.UTF8Encoding($true)))
  Write-Output "补 BOM: $($f.FullName.Replace("$root\", ''))"
  $fixed++
}

if ($fixed -eq 0) { Write-Output "无需修复（检查了 $($files.Count) 个 .ps1）" }
else { Write-Output "共修复 $fixed 个文件" }
