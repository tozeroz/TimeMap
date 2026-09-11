<#
  用无头 Edge 逐路由截图，用于与原版 app 并排对比。
  前置：dev server 已在 127.0.0.1:5174 运行。
  输出：.mumu-capture/demo/<路由>.png
#>
$ErrorActionPreference = 'Continue'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$outDir = 'G:\demo map\.mumu-capture\demo'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$paths = @(
  'campus',
  'me',
  'map',
  'feed/p1',
  'comments/p1',
  'message',
  'chat/t1',
  'board',
  'daily',
  'poi',
  'publish',
  'login',
  'onboarding',
  'announce'
)

foreach ($p in $paths) {
  $file = ($p -replace '/', '_')
  $dest = Join-Path $outDir "$file.png"
  $url = "http://127.0.0.1:5174/#/$p"
  $args = @(
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    "--user-data-dir=$env:TEMP\edge-demo-shot",
    '--window-size=430,932',
    '--force-device-scale-factor=2',
    '--virtual-time-budget=4000',
    "--screenshot=$dest",
    $url
  )
  & $edge @args 2>&1 | Out-Null
  if (Test-Path $dest) {
    Write-Output "$file.png  $((Get-Item $dest).Length) bytes"
  } else {
    Write-Output "$file.png  FAILED"
  }
}
