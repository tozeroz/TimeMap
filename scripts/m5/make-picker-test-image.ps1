<#
  造一张"一眼能认出来"的测试图，用于**系统选择器**真机验证。
  =========================================================================
  为什么要显式画大字而不是随便找张图：
    验证时要能在 uiautomator dump 里凭**文件名**找到自己推的那张图，
    并且事后看截图/dump 时能确认"点的就是它、不是相邻的另一张"。
    纯色小图容易被同目录的其它缩略图混淆，所以画上文件名本身。

  用法：
    pwsh -File scripts/m5/make-picker-test-image.ps1 -Out <输出路径> -Label <图上文字>
#>
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Label = 'M5-PICKER'
)
Add-Type -AssemblyName System.Drawing
$w = 640; $h = 360
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::FromArgb(24, 96, 220))
$font = New-Object System.Drawing.Font('Consolas', 34, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
$g.DrawString($Label, $font, $brush, 28, 120)
$g.DrawString((Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (New-Object System.Drawing.Font('Consolas', 20)), $brush, 28, 190)
$g.Dispose()
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$fi = Get-Item $Out
Write-Output "WROTE $($fi.FullName) bytes=$($fi.Length)"
