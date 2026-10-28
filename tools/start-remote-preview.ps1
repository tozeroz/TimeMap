param([string]$Key = (Join-Path $env:USERPROFILE 'AppData/Local/Temp/timemap-ssh/id_timemap.pem'))
$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewLocal = Join-Path $previewRoot '.local'
$record = Join-Path $previewLocal 'remote-preview-services.json'
if (-not (Test-Path -LiteralPath $Key)) { throw 'A secured SSH key is required.' }
if (Test-Path -LiteralPath $record) {
  $savedJobs = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
  foreach ($entry in $savedJobs) {
    $existing = Get-Process -Id $entry.processId -ErrorAction SilentlyContinue
    if ($existing -and $existing.StartTime.ToUniversalTime().ToString('o') -eq $entry.startedAt) {
      throw 'A remote preview process is already running. Use tools/stop-remote-preview.ps1 before restarting.'
    }
  }
}
$jobs = @()
try {
  $tunnel = Start-Process -FilePath (Get-Command ssh).Source -ArgumentList @(
    '-N', '-i', ('"' + $Key + '"'), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    '-L', '127.0.0.1:15543:127.0.0.1:5432', '-L', '127.0.0.1:18080:127.0.0.1:80', 'root@8.148.156.146'
  ) -WindowStyle Hidden -RedirectStandardError (Join-Path $previewLocal 'remote-tunnel-error.log') -PassThru
  $jobs += @{name='ssh'; processId=$tunnel.Id; startedAt=$tunnel.StartTime.ToUniversalTime().ToString('o')}
  Start-Sleep -Seconds 2
  if ($tunnel.HasExited) { throw 'SSH tunnel failed. Check .local/remote-tunnel-error.log.' }
  $oldKey = $env:REMOTE_PREVIEW_KEY
  try {
    $env:REMOTE_PREVIEW_KEY = $Key
    $api = Start-Process -FilePath (Get-Command node).Source -ArgumentList '--experimental-strip-types', 'src/remotePreview.ts' `
      -WorkingDirectory (Join-Path $previewRoot 'server') -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $previewLocal 'remote-preview.log') `
      -RedirectStandardError (Join-Path $previewLocal 'remote-preview-error.log') -PassThru
    $jobs += @{name='node'; processId=$api.Id; startedAt=$api.StartTime.ToUniversalTime().ToString('o')}
  } finally { $env:REMOTE_PREVIEW_KEY = $oldKey }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    try {
      $status = Invoke-RestMethod 'http://127.0.0.1:3003/api/ready' -TimeoutSec 2
      if ($status.readOnly -eq $true -and $status.source -eq 'remote') { $ready=$true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Remote preview API failed to start. Check .local/remote-preview-error.log.' }
  $envFile = Join-Path $previewRoot 'app/.env.local'
  $content = if (Test-Path -LiteralPath $envFile) { [IO.File]::ReadAllText($envFile) } else { '' }
  $settings = @{VITE_API_ORIGIN='http://127.0.0.1:3003'; VITE_READ_ONLY_PREVIEW='1'}
  foreach ($name in $settings.Keys) {
    $pattern = '(?m)^' + $name + '=.*$'
    $line = $name + '=' + $settings[$name]
    if ($content -match $pattern) { $content = [regex]::Replace($content, $pattern, $line) }
    else { $content = $content.TrimEnd() + "`n" + $line + "`n" }
  }
  [IO.File]::WriteAllText($envFile, $content, [Text.UTF8Encoding]::new($false))
  $frontendAlive = $false
  try { $frontendAlive = (Invoke-WebRequest 'http://127.0.0.1:5180/' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { }
  if (-not $frontendAlive) {
    $frontend = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort' `
      -WorkingDirectory (Join-Path $previewRoot 'app') -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $previewLocal 'frontend.log') -RedirectStandardError (Join-Path $previewLocal 'frontend-error.log') -PassThru
    @{name='frontend'; processId=$frontend.Id; startedAt=$frontend.StartTime.ToUniversalTime().ToString('o')} |
      ConvertTo-Json | Set-Content -LiteralPath (Join-Path $previewLocal 'remote-preview-frontend.json') -Encoding utf8
  }
  $jobs | ConvertTo-Json | Set-Content -LiteralPath $record -Encoding utf8
  Write-Output 'Remote database read-only preview connected. Frontend: http://127.0.0.1:5180/#/map'
} catch {
  foreach ($entry in $jobs) {
    $running = Get-Process -Id $entry.processId -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime().ToString('o') -eq $entry.startedAt) { Stop-Process -Id $running.Id }
  }
  throw
}
