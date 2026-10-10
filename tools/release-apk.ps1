# Publish the locally built APK to the server's /download/ path and PROVE it is downloadable
# byte-for-byte before the release metadata is allowed to mention it.
#
# WHY THIS IS A SCRIPT AND NOT THREE TYPED COMMANDS
#   A release has two halves that must not get out of order:
#     (a) the binary must actually be served at the URL the app will show the user,
#     (b) the backend must advertise that version (migration 018 -> app_release.latest_version).
#   Doing (b) before (a) produces the worst kind of "success": the update dialog shows a
#   download link that 404s. So (a) ends with a MEASURED check -- HTTP status, content type,
#   content length AND a sha256 of the bytes the server actually returns -- and only then does
#   this script tell you to run the backend deploy that applies (b).
#
# WHY http:// IS USED DELIBERATELY
#   Production TLS uses a private-CA self-signed certificate, so an APK download over https
#   gets a certificate warning in browsers/download managers. Port 80 serves the same
#   locations include (see ops/nginx/campus-locations.inc) => the download URL is http on
#   purpose. That is a known tradeoff, not an oversight.
#
# USAGE (run in YOUR terminal, from the repo root)
#   & .\tools\release-apk.ps1                       # upload 1.2 + verify, no backend change
#   & .\tools\release-apk.ps1 -DeployBackend        # ... then deploy the backend (applies 018)
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 parses a BOM-less UTF-8 .ps1 with
# the local ANSI codepage, and mis-decoded non-ASCII breaks PARSING, not just messages.
param(
  [string]$Version = '1.2',
  [string]$Apk = '',
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146',
  [string]$PublicBase = 'http://8.148.156.146',
  [switch]$DeployBackend
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Step($n, $msg) { Write-Host "=== $n) $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "RELEASE_APK: FAILED - $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- key resolution
# Prefer the hardened key staged OUTSIDE the workspace by tools/setup-deploy-key.ps1:
# Windows OpenSSH refuses a private key other accounts can read, and every file inside the
# workspace carries sandbox-group ACL entries. Search every plausible temp dir because the
# agent sandbox and the user's terminal disagree about what %TEMP% points at.
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
    Write-Host "  ! no hardened key found; falling back to $Key"
    Write-Host "    if ssh reports UNPROTECTED PRIVATE KEY FILE, run tools\setup-deploy-key.ps1 first"
  }
}

# IdentitiesOnly=yes: otherwise ssh may offer some other key from ~/.ssh first.
$SSH_OPTS = @('-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes')

# ---------------------------------------------------------------- 1) local artifact
Step 1 "Locate the locally built APK"
if (-not $Apk) {
  $Apk = Join-Path $root 'app\android\app\build\outputs\apk\debug\app-debug.apk'
}
if (-not (Test-Path -LiteralPath $Apk)) {
  Fail "APK not found: $Apk (build it first: tools\tmp\build-apk-local.ps1)"
}
$localSize = (Get-Item -LiteralPath $Apk).Length
$localSha = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash
Write-Host "  path  : $Apk"
Write-Host "  size  : $localSize bytes"
Write-Host "  sha256: $localSha"

# Sanity: this must be a zip (APK) and must not be the 1.1 binary by accident.
$head = [byte[]](Get-Content -LiteralPath $Apk -Encoding Byte -TotalCount 4)
if (-not ($head[0] -eq 0x50 -and $head[1] -eq 0x4B -and $head[2] -eq 0x03 -and $head[3] -eq 0x04)) {
  Fail "file does not start with the ZIP magic 'PK\003\004' -> not a real APK"
}

# Cross-check the version the APK claims against the version we are about to publish.
# app/src/version.ts and android versionName must agree, and this release publishes that value.
$vts = Join-Path $root 'app\src\version.ts'
$vtTxt = [IO.File]::ReadAllText($vts, [Text.Encoding]::UTF8)
$vtMatch = [regex]::Match($vtTxt, "APP_VERSION\s*=\s*'([^']*)'")
if (-not $vtMatch.Success) { Fail "cannot read APP_VERSION from $vts" }
$codeVersion = $vtMatch.Groups[1].Value
$gradleTxt = [IO.File]::ReadAllText((Join-Path $root 'app\android\app\build.gradle'), [Text.Encoding]::UTF8)
$gMatch = [regex]::Match($gradleTxt, 'versionName\s+"([^"]*)"')
if (-not $gMatch.Success) { Fail 'cannot read versionName from app/android/app/build.gradle' }
$androidVersion = $gMatch.Groups[1].Value
Write-Host "  version.ts APP_VERSION = $codeVersion ; android versionName = $androidVersion"
if ($codeVersion -ne $Version -or $androidVersion -ne $Version) {
  Fail "version mismatch: publishing $Version but code=$codeVersion android=$androidVersion"
}
Write-Host "  PASS version agreement" -ForegroundColor Green

$remoteName = "campus-demo-$Version.apk"

# ---------------------------------------------------------------- 2) upload + install
Step 2 "Upload to $Target and install as /srv/campus/downloads/$remoteName"
& scp -i $Key @SSH_OPTS $Apk "${Target}:/tmp/$remoteName"
if ($LASTEXITCODE -ne 0) { Fail 'scp failed' }

# Mirror the ownership/mode of the existing 1.1 artifact instead of guessing them: the file
# that nginx already serves proves which owner/mode is workable on this host.
$remoteSh = @"
set -euo pipefail
installed=/srv/campus/downloads/$remoteName
mkdir -p /srv/campus/downloads
ref=/srv/campus/downloads/campus-demo-1.1.apk
if [ -f "`$ref" ]; then
  owner=`$(stat -c '%U:%G' "`$ref"); mode=`$(stat -c '%a' "`$ref")
  echo "  mirroring existing artifact owner=`$owner mode=`$mode"
else
  owner=root:root; mode=644
  echo "  no 1.1 artifact to mirror; using owner=`$owner mode=`$mode"
fi
install -o "`${owner%%:*}" -g "`${owner##*:}" -m "`$mode" /tmp/$remoteName "`$installed"
rm -f /tmp/$remoteName
echo "  sha256 on server: `$(sha256sum "`$installed" | cut -d' ' -f1)"
ls -l "`$installed"
echo "  -- served through nginx (Host header pinned, port 80) --"
curl -s -o /dev/null -w '  http=%{http_code} type=%{content_type} size=%{size_download}\n' -H 'Host: 8.148.156.146' "http://127.0.0.1/download/$remoteName"
"@
$enc = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteSh))
$remoteOut = & ssh -i $Key @SSH_OPTS $Target "echo '$enc' | base64 -d | bash" 2>&1
$remoteCode = $LASTEXITCODE
$remoteOut | ForEach-Object { Write-Host "  $_" }
if ($remoteCode -ne 0) { Fail "remote install failed (exit $remoteCode)" }

$serverSha = ($remoteOut | Select-String -Pattern 'sha256 on server:\s*([0-9a-fA-F]{64})' |
  Select-Object -First 1)
if (-not $serverSha) { Fail 'could not read the server-side sha256 from the remote output' }
$serverShaVal = $serverSha.Matches[0].Groups[1].Value.ToUpper()
if ($serverShaVal -ne $localSha) {
  Fail "sha256 mismatch after upload: local=$localSha server=$serverShaVal"
}
Write-Host "  PASS server-side sha256 == local sha256" -ForegroundColor Green

# ---------------------------------------------------------------- 3) fetch it back over the network
Step 3 "Download the published URL and compare the bytes"
# This is the check that actually matters: it exercises the same public path the phone will use.
$url = "$PublicBase/download/$remoteName"
$tmpFile = Join-Path ([IO.Path]::GetTempPath()) "timemap-verify-$remoteName"
if (Test-Path -LiteralPath $tmpFile) { Remove-Item -LiteralPath $tmpFile -Force }
try {
  $resp = Invoke-WebRequest -Uri $url -OutFile $tmpFile -PassThru -UseBasicParsing -TimeoutSec 120
} catch {
  Fail "HTTP fetch of $url failed: $($_.Exception.Message)"
}
$fetchedSize = (Get-Item -LiteralPath $tmpFile).Length
$fetchedSha = (Get-FileHash -LiteralPath $tmpFile -Algorithm SHA256).Hash
$ctype = ''
try { $ctype = $resp.Headers['Content-Type'] } catch { $ctype = '' }
Write-Host "  url        : $url"
Write-Host "  http status: $($resp.StatusCode)"
Write-Host "  content-type: $ctype"
Write-Host "  bytes      : $fetchedSize (local $localSize)"
Write-Host "  sha256     : $fetchedSha"
if ("$($resp.StatusCode)" -ne '200') { Fail "unexpected HTTP status $($resp.StatusCode)" }
if ($fetchedSize -ne $localSize) { Fail "size mismatch: served=$fetchedSize local=$localSize" }
if ($fetchedSha -ne $localSha) { Fail "sha256 mismatch: served=$fetchedSha local=$localSha" }
if ($ctype -notmatch 'android\.package-archive') {
  Fail "unexpected Content-Type '$ctype' (expected application/vnd.android.package-archive)"
}
Remove-Item -LiteralPath $tmpFile -Force
Write-Host "  PASS published URL returns the exact bytes (200 + correct type + same sha256)" -ForegroundColor Green

# ---------------------------------------------------------------- 4) release metadata
Step 4 "Release metadata (app_release)"
if ($DeployBackend) {
  Write-Host '  deploying the backend bundle; migration 018_release_1_2 applies on service start'
  & (Join-Path $root 'tools\deploy-server.ps1') -Key $Key -Target $Target
  if ($LASTEXITCODE -ne 0) { Fail "backend deploy failed (exit $LASTEXITCODE)" }
  Write-Host ''
  Write-Host '  verify the published version with:' -ForegroundColor Green
  Write-Host '    node tools\tmp\verify-deploy-complete.mjs'
} else {
  Write-Host '  NOT deployed (no -DeployBackend). The APK is now downloadable, but the app still'
  Write-Host '  advertises the previous version. To publish 1.2 run:'
  Write-Host '    & .\tools\release-apk.ps1 -DeployBackend'
  Write-Host '  (re-uploading the same bytes is harmless/idempotent)'
}

Write-Host ''
Write-Host "RELEASE_APK: OK ($remoteName, $localSize bytes, sha256 $localSha)" -ForegroundColor Green
exit 0
