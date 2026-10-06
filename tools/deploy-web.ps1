# Deploy web frontend to the Aliyun server: build -> upload -> atomic swap -> smoke test.
#
# ============================================================================
# RULE FOR THIS FILE: keep it ASCII-only.
# ============================================================================
# Windows PowerShell 5.1 parses a BOM-less UTF-8 .ps1 using the local ANSI
# codepage (GBK here). Non-ASCII text therefore gets mis-decoded, and that does
# not merely garble messages -- it can BREAK PARSING: a mis-decoded Chinese
# comment silently swallowed the following assignment, so a variable was empty
# when used, and the deploy died with `mkdir: cannot create directory ''`.
# (That cost a full debugging round. I had written this very rule in the header
#  and then violated it by adding Chinese comments.)
# => Chinese rationale lives in tools/remote/web-deploy-remote.sh (bash reads
#    UTF-8 correctly) and in docs/WEB-FRONTEND.md. Keep this file ASCII.
#
# WHY AN ATOMIC DEPLOY (not "delete then upload"):
#   The first version did `rm -rf $web && mkdir` then uploaded, which leaves the
#   site COMPLETELY EMPTY for the whole upload -- not "old version keeps serving".
#   That is not theoretical: nginx error.log shows
#     "directory index of /srv/campus/web/ is forbidden (GET /)"
#   and one of those hits came from a REAL client IP.
#   => upload to a unique staging dir, then atomically `mv` it into place
#      (rename(2) within one filesystem is atomic).
#
# WHY THE STAGING DIR IS TIMESTAMPED (no deletion anywhere):
#   Reusing one fixed staging path required `rm -rf` first. In this session the
#   deletion guard rejects removals embedded in compound/opaque shell syntax, so
#   that ssh step returned exit 1 and aborted the deploy. Rather than fight it,
#   the design now needs NO deletion: every deploy uses a fresh timestamped dir.
#
# PITFALLS ALREADY HIT HERE (do not regress):
#   * "$web.new" is parsed by PowerShell as "property .new of $web" -> empty.
#     Always write "${web}.new". (The same bug once turned an scp target into
#     "root@host:/" -- i.e. the server ROOT.)
#   * scp with a glob like (Join-Path $dist '*') does NOT expand: PowerShell does
#     not glob for native commands, so Git's scp stats a literal path and fails.
#     Worse, that failure was ignored and the run "passed" while deploying
#     nothing. => transfer the directory itself and check $LASTEXITCODE.
#   * A "no failed requests during deploy" probe is VACUOUS on its own: it also
#     holds when nothing was deployed. So we write a build-id sentinel and the
#     verifier requires it to change.
param(
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$key  = Join-Path $root 'TimeMap.pem'
$target = 'root@8.148.156.146'
$web  = '/srv/campus/web'
$remoteScript = Join-Path $root 'tools\remote\web-deploy-remote.sh'

Write-Host '=== 1) Build frontend ===' -ForegroundColor Cyan
if (-not $SkipBuild) {
  Push-Location (Join-Path $root 'app')
  try {
    # WHY: pnpm echoes the command it runs ("$ tsc -b && vite build") to STDERR.
    # With $ErrorActionPreference='Stop' PowerShell turns native stderr into a
    # terminating error, so the build aborts even though nothing is wrong.
    # => relax the preference for this call and judge by $LASTEXITCODE instead.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $out = & pnpm build 2>&1
      $code = $LASTEXITCODE
      $out | Select-String -Pattern 'built in|error|dist/assets' | ForEach-Object { "  $($_.Line.Trim())" }
    } finally {
      $ErrorActionPreference = $prev
    }
    if ($code -ne 0) { throw "pnpm build failed (exit $code)" }
  } finally { Pop-Location }
} else {
  Write-Host '  (skipped: --SkipBuild)'
}

$dist = Join-Path $root 'app\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "Build output missing: $dist\index.html" }
$jsCount = (Get-ChildItem (Join-Path $dist 'assets') -Filter '*.js' -ErrorAction SilentlyContinue).Count

Write-Host '=== 2) Upload to a timestamped staging dir ===' -ForegroundColor Cyan
# Build-id sentinel: lets the verifier PROVE a deploy actually happened
# (see the "vacuous probe" pitfall above).
$rev = (git -C $root rev-parse --short HEAD 2>$null)
$buildId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $rev
Set-Content -Path (Join-Path $dist 'build-id.txt') -Value $buildId -Encoding ascii -NoNewline
Write-Host "  build-id: $buildId"

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$stage = "$web.new.$stamp"
$slot  = "/tmp/web-upload-$stamp"

& ssh -i $key -o BatchMode=yes $target "mkdir -p '$stage' && echo staging-ready"
if ($LASTEXITCODE -ne 0) { throw "cannot create staging dir $stage (exit $LASTEXITCODE)" }

& ssh -i $key -o BatchMode=yes $target "mkdir -p '$slot' && echo upload-slot-ready"
if ($LASTEXITCODE -ne 0) { throw "cannot create upload slot $slot (exit $LASTEXITCODE)" }

# Transfer the directory itself (no glob). scp -r <localdir> <remote>/ creates
# <remote>/<basename>, hence reading from $slot/dist below.
& scp -i $key -o BatchMode=yes -r $dist "${target}:$slot/"
if ($LASTEXITCODE -ne 0) { throw "upload failed (scp exit $LASTEXITCODE) - aborted, live site untouched" }

& ssh -i $key -o BatchMode=yes $target "cp -a '$slot/dist/.' '$stage/' && echo staged && find '$stage' -type f | wc -l"
if ($LASTEXITCODE -ne 0) { throw "staging copy failed (exit $LASTEXITCODE)" }

Write-Host '=== 3) Upload remote helper ===' -ForegroundColor Cyan
& scp -i $key -o BatchMode=yes $remoteScript "${target}:/tmp/web-deploy-remote.sh"
if ($LASTEXITCODE -ne 0) { throw "uploading remote helper failed (exit $LASTEXITCODE)" }

Write-Host '=== 4) Atomic swap + fix permissions ===' -ForegroundColor Cyan
# swap validates $stage/index.html before touching the live dir.
& ssh -i $key -o BatchMode=yes $target "bash /tmp/web-deploy-remote.sh swap '$stage'"
$swapExit = $LASTEXITCODE
if ($swapExit -ne 0) { Write-Host 'SWAP FAILED (old version kept)' -ForegroundColor Red; exit 1 }
& ssh -i $key -o BatchMode=yes $target 'bash /tmp/web-deploy-remote.sh perms'

Write-Host '=== 5) Smoke test on server ===' -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes $target 'bash /tmp/web-deploy-remote.sh smoke'
$smokeExit = $LASTEXITCODE

Write-Host '=== 6) Public check (no -k: real trust chain) ===' -ForegroundColor Cyan
# NOTE: use NUL (Windows null device), NOT $null -- PowerShell expands $null to an
# empty string, so curl treats it as a filename and dumps the whole body to stdout.
foreach ($p in @('/', '/favicon.svg', '/api/health', '/build-id.txt')) {
  $r = & curl.exe -s -o NUL -w '%{http_code} verify=%{ssl_verify_result} bytes=%{size_download}' --max-time 15 "https://8.148.156.146$p" 2>$null
  Write-Host "  https://8.148.156.146$p -> $r"
}

if ($smokeExit -ne 0) { Write-Host 'SMOKE FAILED' -ForegroundColor Red; exit 1 }
Write-Host "DEPLOY_WEB: OK (build-id $buildId)" -ForegroundColor Green
