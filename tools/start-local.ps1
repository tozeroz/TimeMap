param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$localRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localDir = Join-Path $localRoot '.local'
$pgBin = Join-Path $localDir 'pgsql\bin'
$pgData = Join-Path $localDir 'postgres-data'
if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'pg_ctl.exe'))) { throw 'Local PostgreSQL binaries are missing from .local/pgsql.' }
& node (Join-Path $PSScriptRoot 'configure-local.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local environment setup failed.' }
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  & (Join-Path $pgBin 'initdb.exe') -D $pgData -U campus -A scram-sha-256 ("--pwfile=" + (Join-Path $localDir 'db-password')) -E UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
}
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -l (Join-Path $localDir 'postgres.log') -o '-p 15432 -h 127.0.0.1' -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed.' }
}
$previousPgPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = (Get-Content -LiteralPath (Join-Path $localDir 'db-password') -Raw).Trim()
  $exists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 15432 -U campus -d postgres -tAc "select 1 from pg_database where datname='campus_local'"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to connect to the local database.' }
  if (-not $exists) {
    & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 15432 -U campus campus_local
    if ($LASTEXITCODE -ne 0) { throw 'Database creation failed.' }
  }
} finally { $env:PGPASSWORD = $previousPgPassword }
if (-not $SkipBuild) {
  Push-Location (Join-Path $localRoot 'server')
  try { & node build.mjs; if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' } } finally { Pop-Location }
}
$nodeExe = (Get-Command node).Source
$services = @()
$backendAlive = $false
try { $backendAlive = (Invoke-RestMethod 'http://127.0.0.1:3002/api/ready' -TimeoutSec 2).status -eq 'ready' } catch { }
$pidFile = Join-Path $localDir 'services.json'
if (Test-Path -LiteralPath $pidFile) { $services = @(Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json) }
if (-not $backendAlive) {
  $backProcess = Start-Process -FilePath $nodeExe -ArgumentList '--env-file=.env', 'dist/index.mjs' -WorkingDirectory (Join-Path $localRoot 'server') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localDir 'backend.log') -RedirectStandardError (Join-Path $localDir 'backend-error.log') -PassThru
  $services += @{ name='backend'; processId=$backProcess.Id; startedAt=$backProcess.StartTime.ToUniversalTime().ToString('o') }
}
$ready = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
  try { $response = Invoke-RestMethod 'http://127.0.0.1:3002/api/ready' -TimeoutSec 2; if ($response.status -eq 'ready' -or $response.ok -eq $true) { $ready=$true; break } } catch { }
  Start-Sleep -Seconds 1
}
$services | ConvertTo-Json  | Set-Content -LiteralPath $pidFile -Encoding utf8
if (-not $ready) { throw 'Backend did not become ready. Check .local/backend-error.log.' }
$frontAlive = $false
try { $frontAlive = (Invoke-WebRequest 'http://127.0.0.1:5180/' -TimeoutSec 2).StatusCode -eq 200 } catch { }
if (-not $frontAlive) {
  $frontProcess = Start-Process -FilePath $nodeExe -ArgumentList 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort' -WorkingDirectory (Join-Path $localRoot 'app') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localDir 'frontend.log') -RedirectStandardError (Join-Path $localDir 'frontend-error.log') -PassThru
  $services += @{ name='frontend'; processId=$frontProcess.Id; startedAt=$frontProcess.StartTime.ToUniversalTime().ToString('o') }
}
$services | ConvertTo-Json  | Set-Content -LiteralPath $pidFile -Encoding utf8
Write-Output 'Local TimeMap: http://127.0.0.1:5180/'
Write-Output 'Backend: http://127.0.0.1:3002/  PostgreSQL:127.0.0.1:15432'
Write-Output 'Stop with: powershell -ExecutionPolicy Bypass -File tools/stop-local.ps1'
