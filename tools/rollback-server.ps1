# Roll the TimeMap deployment back to the pre-P0 backup.
#
# ============================================================================
# RULE FOR THIS FILE: keep it ASCII-only (see tools/deploy-web.ps1 for the story).
# ============================================================================
# Windows PowerShell 5.1 parses a BOM-less UTF-8 .ps1 with the local ANSI codepage,
# so non-ASCII text is mis-decoded and can BREAK PARSING. Rationale in Chinese lives
# in tools/remote/rollback-remote.sh (bash reads UTF-8 correctly) and in the report doc.
#
# WHAT THIS RESTORES (all three move together -- a partial restore leaves a mixed state):
#   db    -> /srv/campus/backups/<stamp>/campus-db.dump
#   files -> /srv/campus/backups/<stamp>/dist-web-uploads.tar.gz
#            containing server/dist/*.mjs + web/ + uploads/
# Secrets (server.env, operator.env, .db_password, .login_code_hmac_key) are NEVER
# downloaded, NEVER backed up, and NEVER overwritten by a rollback.
#
# USAGE
#   # 1) dry run: verify the backup and stop (prints findings, changes nothing)
#   & .\tools\rollback-server.ps1 -Stamp pre-timemap-p0-20260925-0012
#
#   # 2) real rollback
#   & .\tools\rollback-server.ps1 -Stamp pre-timemap-p0-20260925-0012 -Yes
#
#   # files only / db only
#   & .\tools\rollback-server.ps1 -Stamp <stamp> -Mode files -Yes
#
# EXIT CODES: 0 ok | 1 verification failed | 2/3 precondition or checksum failed |
#             4 db restore fatal | 5 unpack failed | 6 service not ready | 10 dry run
param(
  [Parameter(Mandatory = $true)][string]$Stamp,
  [ValidateSet('all', 'db', 'files')][string]$Mode = 'all',
  [switch]$Yes,
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Same key handling as the deploy scripts: prefer the hardened copy staged OUTSIDE the
# workspace by tools/setup-deploy-key.ps1 (Windows OpenSSH rejects a key whose ACL lists
# other accounts, and workspace files carry sandbox-group ACL entries).
#
# We SEARCH every plausible temp location rather than trusting $env:TEMP: under the agent
# sandbox $env:TEMP is a sandbox-private directory, so the two environments disagree.
function Find-StagedKey {
  $candidates = @(
    $env:TMPDIR, $env:TEMP, $env:TMP,
    (Join-Path $env:USERPROFILE 'AppData\Local\Temp'),
    'C:\Users\Lenovo\AppData\Local\Temp'
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($c in $candidates) {
    $p = Join-Path $c 'timemap-ssh\id_timemap.pem'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}
if (-not $PSBoundParameters.ContainsKey('Key') -or -not $Key) {
  $staged = Find-StagedKey
  if ($staged) {
    $Key = $staged
    Write-Host "using hardened deploy key: $Key"
  } else {
    $Key = Join-Path $root 'TimeMap.pem'
    Write-Host "  ! hardened key not found (searched temp dirs for timemap-ssh\id_timemap.pem)"
    Write-Host "    falling back to the in-repo TimeMap.pem; if ssh reports"
    Write-Host "    UNPROTECTED PRIVATE KEY FILE, run: & .\tools\setup-deploy-key.ps1"
  }
}
if (-not (Test-Path -LiteralPath $Key)) { throw "SSH key not found: $Key" }
# IdentitiesOnly=yes keeps ssh from silently offering a different key from ~/.ssh.
$SSH_OPTS = @('-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes')

$backupDir = "/srv/campus/backups/$Stamp"
$remoteHelper = Join-Path $root 'tools\remote\rollback-remote.sh'

Write-Host '=== 0) Preflight (local) ===' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $remoteHelper)) { throw "missing helper: $remoteHelper" }
Write-Host "  backup dir on server: $backupDir"
Write-Host "  mode: $Mode"

$confirmArg = if ($Yes) { '--yes' } else { '' }

Write-Host '=== 1) Upload remote helper ===' -ForegroundColor Cyan
& scp -i $Key @SSH_OPTS `
  $remoteHelper "${Target}:/tmp/rollback-remote.sh"
if ($LASTEXITCODE -ne 0) { throw "scp of rollback helper failed (exit $LASTEXITCODE)" }

Write-Host '=== 2) Run rollback on server ===' -ForegroundColor Cyan
if ($Yes) {
  Write-Host '  (real run: service will be stopped and the DB restored)' -ForegroundColor Yellow
} else {
  Write-Host '  (dry run: verifies the backup, changes nothing)' -ForegroundColor Yellow
}

# NOTE: argument is passed as a single quoted string so the remote shell sees it intact.
$remoteCmd = "bash /tmp/rollback-remote.sh '$backupDir' '$Mode' $confirmArg"
& ssh -i $Key @SSH_OPTS `
  $Target $remoteCmd
$rc = $LASTEXITCODE

Write-Host ''
switch ($rc) {
  0  { Write-Host "ROLLBACK: OK ($Mode @ $Stamp)" -ForegroundColor Green }
  10 { Write-Host 'ROLLBACK: DRY RUN completed (nothing was changed). Re-run with -Yes to execute.' -ForegroundColor Yellow }
  default { Write-Host "ROLLBACK: FAILED (exit $rc) -- see server output above" -ForegroundColor Red }
}

if ($rc -eq 0) {
  Write-Host '=== 3) Public check from here (no -k: real trust chain) ===' -ForegroundColor Cyan
  foreach ($p in @('/', '/api/health', '/api/ready')) {
    $r = & curl.exe -s -o NUL -w '%{http_code} verify=%{ssl_verify_result}' --max-time 15 "https://8.148.156.146$p" 2>$null
    Write-Host "  https://8.148.156.146$p -> $r"
  }
}
exit $rc
