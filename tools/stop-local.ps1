$ErrorActionPreference = 'Stop'
$localRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localDir = Join-Path $localRoot '.local'
$pidFile = Join-Path $localDir 'services.json'
if (Test-Path -LiteralPath $pidFile) {
  foreach ($entry in @(Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json)) {
    $process = Get-Process -Id $entry.processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node' -and $process.StartTime.ToUniversalTime().ToString('o') -eq $entry.startedAt) {
      Stop-Process -Id $process.Id
      Write-Output "Stopped local $($entry.name)."
    }
  }
}
$pgBin = Join-Path $localDir 'pgsql\bin\pg_ctl.exe'
$pgData = Join-Path $localDir 'postgres-data'
if ((Test-Path -LiteralPath $pgBin) -and (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  & $pgBin -D $pgData -m fast -w stop
}
Write-Output 'Local services stopped. Database and uploaded images retained.'
