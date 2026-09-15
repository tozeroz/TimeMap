<#
  从目标 APK 提取可在 demo 中直接复用的资源与文案。
  输出到 .mumu-capture/apk/extract/
    raw/      原始提取（strings.xml、colors.xml 等）
    images/   图片资源（png/webp）
    anim/     Lottie 动画 json
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$apk = 'G:\demo map\.mumu-capture\apk\target.apk'
$base = 'G:\demo map\.mumu-capture\apk\extract'
$raw = Join-Path $base 'raw'
$images = Join-Path $base 'images'
$anim = Join-Path $base 'anim'
foreach ($d in @($raw, $images, $anim)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)

# 1) 文本与配置类小文件
$textTargets = @('resources.arsc')
$textEntries = $zip.Entries | Where-Object {
  $_.FullName -match '^res/values[^/]*/.*\.xml$' -or
  $_.FullName -match '^res/(xml|raw)/.*\.xml$' -or
  $_.FullName -match '^assets/.*\.(json|properties|txt)$' -or
  $_.FullName -match '^(AndroidManifest\.xml)$'
}
$count = 0
foreach ($e in $textEntries) {
  $rel = $e.FullName -replace '/', '_'
  $dest = Join-Path $raw $rel
  try {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
    $count++
  } catch { }
}
Write-Output "text/config files: $count"

# 2) 图片资源（保留原始路径层级，便于对照）
$imgEntries = $zip.Entries | Where-Object { $_.FullName -match '^res/.*\.(png|webp|jpg|jpeg)$' }
$ic = 0
foreach ($e in $imgEntries) {
  $rel = $e.FullName -replace '/', '\'
  $dest = Join-Path $images $rel
  $dir = Split-Path $dest -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  try {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
    $ic++
  } catch { }
}
Write-Output "images: $ic"

# 3) Lottie 动画
$animEntries = $zip.Entries | Where-Object { $_.FullName -match '^assets/anim/.*\.json$' }
$ac = 0
foreach ($e in $animEntries) {
  $rel = ($e.FullName -replace '^assets/anim/', '') -replace '/', '\'
  $dest = Join-Path $anim $rel
  $dir = Split-Path $dest -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  try {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
    $ac++
  } catch { }
}
Write-Output "lottie: $ac"

# 4) res/values 里的 strings / colors / styles（未混淆时可直接读）
$zip.Dispose()

Write-Output '--- raw 目录中前 30 个文件 ---'
Get-ChildItem $raw -File | Select-Object -First 30 -ExpandProperty Name
