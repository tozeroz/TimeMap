# Stage the deploy SSH key OUTSIDE the workspace with a clean, restrictive ACL.
#
# WHY THIS EXISTS
#   Windows OpenSSH refuses a private key that is readable by other accounts:
#     "UNPROTECTED PRIVATE KEY FILE ... bad permissions"
#   The repo's TimeMap.pem sits under the session workspace, and every file there carries
#   ACL entries for sandbox groups. Those entries live ON THE FILE, so they follow it no
#   matter who runs scp -- the user saw the same rejection in their own terminal, which is
#   what proved it is not a "who is running" problem.
#   => keep the key the deploy uses somewhere outside the workspace, with an ACL that lists
#      only this account (plus SYSTEM/Administrators, which OpenSSH tolerates).
#
# WHAT IT DOES (nothing destructive)
#   1. copies TimeMap.pem to  %TEMP%\timemap-ssh\id_timemap.pem
#   2. disables ACL inheritance and grants Full rights to the current account only
#   3. VERIFIES the result by attempting a read-only `ssh ... echo` (no changes on the server)
#
# The original TimeMap.pem is left untouched (it stays gitignored).
#
# USAGE (run from the repo root, in YOUR terminal -- not from the agent sandbox):
#   & .\tools\setup-deploy-key.ps1
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 mis-decodes a BOM-less UTF-8 .ps1.
param(
  [string]$Source = '',
  [string]$Dest = "$env:TEMP\timemap-ssh\id_timemap.pem",
  [string]$Target = 'root@8.148.156.146'
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $root 'TimeMap.pem' }

Write-Host '=== 1) Source key ===' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Source)) { Write-Error "key not found: $Source"; exit 2 }
Write-Host "  $Source"

Write-Host '=== 2) Copy outside the workspace ===' -ForegroundColor Cyan
$destDir = Split-Path -Parent $Dest
if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
Copy-Item -LiteralPath $Source -Destination $Dest -Force
Write-Host "  $Dest"

Write-Host '=== 3) Harden the ACL (owner only) ===' -ForegroundColor Cyan
# /inheritance:r removes inherited entries (this is what drops the sandbox group),
# /grant:r replaces the explicit grant with a single one for this account.
& icacls $Dest /inheritance:r 2>&1 | ForEach-Object { "  $_" }
& icacls $Dest /grant:r "$($env:USERNAME):F" 2>&1 | ForEach-Object { "  $_" }

Write-Host '  --- resulting ACL ---'
$acl = Get-Acl $Dest
$acl.Access | ForEach-Object { "    $($_.IdentityReference) | $($_.FileSystemRights) | $($_.AccessControlType)" }

# Fail loudly if anything beyond this account / SYSTEM / Administrators can read it,
# because ssh will reject the key in that case and the deploy would fail confusingly later.
$icky = @($acl.Access | Where-Object {
    $id = "$($_.IdentityReference)"
    $id -notmatch [regex]::Escape($env:USERNAME) -and
    $id -notmatch 'SYSTEM' -and
    $id -notmatch 'Administrators'
  })
if ($icky.Count -gt 0) {
  Write-Host '  ! ACL still has extra entries (ssh may refuse this key):' -ForegroundColor Yellow
  $icky | ForEach-Object { Write-Host "      $($_.IdentityReference)" -ForegroundColor Yellow }
} else {
  Write-Host '  OK: only this account / SYSTEM / Administrators' -ForegroundColor Green
}

Write-Host '=== 4) Verify with a read-only SSH call ===' -ForegroundColor Cyan
$out = & ssh -i $Dest -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes $Target "echo KEY_OK; hostname; systemctl is-active campus-backend.service" 2>&1
$code = $LASTEXITCODE
$out | ForEach-Object { "  $_" }

Write-Host ''
if ($code -eq 0) {
  Write-Host "SETUP_DEPLOY_KEY: OK" -ForegroundColor Green
  Write-Host "  Use it with:  & .\tools\deploy-server.ps1 -Key `"$Dest`"" -ForegroundColor Green
  Write-Host "                & .\tools\deploy-web.ps1`n"
} else {
  Write-Host "SETUP_DEPLOY_KEY: FAILED (ssh exit $code) -- see output above" -ForegroundColor Red
}
exit $code
