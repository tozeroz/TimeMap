<#
  安装 Android SDK 命令行工具并接受许可。
  只做下载 + 解压 + 写 repo 配置，不做递归删除。
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = 'G:\android-sdk'
$zip = Join-Path $root 'cmdline-tools.zip'
$url = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'

New-Item -ItemType Directory -Force -Path $root | Out-Null

Write-Output "[1/4] downloading cmdline-tools ..."
if (-not (Test-Path $zip)) {
  Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 900
}
Write-Output "      size = $((Get-Item $zip).Length) bytes"

Write-Output "[2/4] extracting ..."
$dest = Join-Path $root 'cmdline-tools\latest'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
# zip 内层是 cmdline-tools/，把它内部的东西提到 latest 下面
$inner = Join-Path $dest 'cmdline-tools'
if (Test-Path $inner) {
  Get-ChildItem -LiteralPath $inner -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination $dest -Force
  }
  Remove-Item -LiteralPath $inner -Recurse -Force
}
Get-ChildItem -LiteralPath (Join-Path $dest 'bin') | Select-Object -ExpandProperty Name

Write-Output "[3/4] writing sdk repo config ..."
$sdkManager = Join-Path $dest 'bin\sdkmanager.bat'
if (-not (Test-Path $sdkManager)) { throw "sdkmanager.bat not found at $sdkManager" }
& $sdkManager --version

Write-Output "[4/4] done"
