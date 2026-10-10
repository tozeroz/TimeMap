<#
  Install the Android SDK command-line tools (sdkmanager) and accept licenses.

  ⚠️ THIS MAY NOT WORK ON EVERY MACHINE — read before relying on it.
  On the machine this repo was developed on, sdkmanager could not fetch its repository
  list at all:
      Failed to download any source lists! / IO exception while downloading manifest
  while plain `java` (same JDK) reached dl.google.com fine. So the "download sdkmanager,
  then let it install packages" route is NOT dependable here.
  The dependable route is tools/tmp/fetch-android-sdk.mjs, which downloads the packages
  directly and unpacks them with Node's own zlib (no subprocesses at all). Prefer it,
  and use this script only when sdkmanager itself is what you want.

  ⚠️ WHAT WAS WRONG BEFORE (fixed 2026-10-09)
  It hard-coded `$root = 'G:\android-sdk'` — a path from a workstation that no longer
  exists. Now the SDK location is a parameter that defaults to a repo-local directory.

  USAGE
    powershell -File tools/install-android-sdk.ps1
    powershell -File tools/install-android-sdk.ps1 -Root D:\android-sdk

  NOTE: keep this file ASCII-only (PowerShell 5.1 mis-decodes a BOM-less UTF-8 .ps1).
#>
param(
  [string]$Root = '',
  [string]$Url = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $Root) { $Root = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\tmp\android-sdk' }
$zip = Join-Path $Root 'cmdline-tools.zip'

New-Item -ItemType Directory -Force -Path $Root | Out-Null

Write-Output "[1/4] downloading cmdline-tools ..."
if (-not (Test-Path $zip)) {
  Invoke-WebRequest -Uri $Url -OutFile $zip -TimeoutSec 900
}
Write-Output "      size = $((Get-Item $zip).Length) bytes"

Write-Output "[2/4] extracting ..."
$dest = Join-Path $Root 'cmdline-tools\latest'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
# the zip's inner folder is cmdline-tools/; lift its contents into latest/
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
& $sdkManager --version | Select-Object -First 3

Write-Output "[4/4] done (SDK root: $Root)"
Write-Output '      NOTE: accept licenses yourself with:'
Write-Output "        & `"$sdkManager`" --licenses"
Write-Output '      If sdkmanager cannot fetch its repository list, use tools/tmp/fetch-android-sdk.mjs instead.'
