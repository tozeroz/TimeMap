<#
  提取目标 APK 的 res 根目录图片资源。
  注意：该 APK 用了 AndResGuard 混淆，资源名被压成 res/xx.png 这种短名，
  没有语义，只能靠视觉挑选。
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$apk = 'G:\demo map\.mumu-capture\apk\target.apk'
$flat = 'G:\demo map\.mumu-capture\apk\extract\images-flat'
New-Item -ItemType Directory -Force -Path $flat | Out-Null

$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
$entries = $zip.Entries | Where-Object { $_.FullName -match '^res/[^/]+\.(png|webp|jpg|jpeg)$' }
Write-Output "found $($entries.Count) image entries at res root"

$n = 0
foreach ($e in $entries) {
  $dest = Join-Path $flat $e.Name
  try {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
    $n++
  } catch { }
}
$zip.Dispose()
Write-Output "extracted $n"
Write-Output "total bytes: $((Get-ChildItem $flat -File | Measure-Object Length -Sum).Sum)"
