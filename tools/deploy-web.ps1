# Deploy web frontend to the Aliyun server: build -> upload -> fix perms -> smoke test.
#
# WHY THIS SCRIPT EXISTS (do not replace it with ad-hoc scp):
#   First manual deploy hit a bug that makes the web page BLANK:
#     `scp -r` left the upload dir with mode drwx---rwx (group bits = 0).
#     nginx workers run as www-data (reaching it via the campus group), so they
#     could not traverse the dir => every /assets/*.js returned 403 => blank page.
#     Note: / and /index.html still returned 200, so a naive check of the home
#     page alone does NOT catch it.
#   => permissions must be guaranteed by the DEPLOY step, otherwise this silently
#      returns on every future deploy.
#
# NOTE: any server-side logic with non-ASCII text lives in
# tools/remote/web-deploy-remote.sh (bash reads UTF-8 fine), because Windows
# PowerShell 5.1 parses a BOM-less UTF-8 .ps1 using the local ANSI codepage and
# would mangle Chinese strings.
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

Write-Host '=== 2) Reset target dir then upload ===' -ForegroundColor Cyan
# Wipe first: hashed filenames accumulate, and files deleted from dist would
# otherwise stay reachable as "ghost" resources.
& ssh -i $key -o BatchMode=yes $target "rm -rf $web && mkdir -p $web && echo reset-ok"
& scp -i $key -o BatchMode=yes -r (Join-Path $dist '*') "${target}:$web/"
Write-Host "  uploaded: index.html + $jsCount JS + css/svg"

Write-Host '=== 3) Upload remote helper ===' -ForegroundColor Cyan
& scp -i $key -o BatchMode=yes $remoteScript "${target}:/tmp/web-deploy-remote.sh"

Write-Host '=== 4) Fix permissions (SKIPPING THIS => /assets 403 => blank page) ===' -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes $target 'bash /tmp/web-deploy-remote.sh perms'

Write-Host '=== 5) Smoke test on server ===' -ForegroundColor Cyan
& ssh -i $key -o BatchMode=yes $target 'bash /tmp/web-deploy-remote.sh smoke'
$smokeExit = $LASTEXITCODE

Write-Host '=== 6) Public check (no -k: real trust chain) ===' -ForegroundColor Cyan
# NOTE: use NUL (Windows null device), NOT $null -- PowerShell expands $null to an
# empty string, so curl treats it as a filename and dumps the whole body to stdout.
foreach ($p in @('/', '/favicon.svg', '/api/health')) {
  $r = & curl.exe -s -o NUL -w '%{http_code} verify=%{ssl_verify_result} bytes=%{size_download}' --max-time 15 "https://8.148.156.146$p" 2>$null
  Write-Host "  https://8.148.156.146$p -> $r"
}

if ($smokeExit -ne 0) { Write-Host 'SMOKE FAILED' -ForegroundColor Red; exit 1 }
Write-Host 'DEPLOY_WEB: OK' -ForegroundColor Green
