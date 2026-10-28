$ErrorActionPreference = 'Stop'
$previewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$record = Join-Path $previewRoot '.local/remote-preview-services.json'
if (Test-Path -LiteralPath $record) {
  $savedJobs = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
  foreach ($entry in $savedJobs) {
    $running = Get-Process -Id $entry.processId -ErrorAction SilentlyContinue
    if ($running -and $running.ProcessName -eq $entry.name -and $running.StartTime.ToUniversalTime().ToString('o') -eq $entry.startedAt) {
      Stop-Process -Id $running.Id
    }
  }
  Remove-Item -LiteralPath $record
}
& node (Join-Path $PSScriptRoot 'configure-local.mjs')
Write-Output 'Remote preview stopped. Frontend returned to the local database API.'
