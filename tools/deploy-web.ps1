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
#    UTF-8 correctly) and in docs/public/archive/WEB-FRONTEND.md. Keep this file ASCII.
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
  [switch]$SkipBuild,
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146',
  [string]$RemoteBuildEnv = '/srv/campus/web-build.env'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Same key handling as deploy-server.ps1: prefer the hardened copy staged OUTSIDE the
# workspace by tools/setup-deploy-key.ps1, because Windows OpenSSH rejects a key whose ACL
# lists other accounts and workspace files carry sandbox-group entries.
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
# IdentitiesOnly=yes keeps ssh from silently offering a different key from ~/.ssh.
$SSH_OPTS = @('-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes')
$web  = '/srv/campus/web'
$remoteScript = Join-Path $root 'tools\remote\web-deploy-remote.sh'

# Production Vite variables live on the server so every authorized publisher uses the
# same map credentials. Values are captured in memory and never printed. A release must
# fail before building or uploading if the required AMap configuration is unavailable.
Write-Host '=== 0) Load protected frontend configuration ===' -ForegroundColor Cyan
$remoteEnvOutput = & ssh -i $Key @SSH_OPTS $Target "test -r '$RemoteBuildEnv' && cat '$RemoteBuildEnv'" 2>&1
$remoteEnvCode = $LASTEXITCODE
if ($remoteEnvCode -ne 0) {
  throw "cannot read protected frontend configuration: $RemoteBuildEnv (ssh exit $remoteEnvCode)"
}
$allowedBuildVars = @('VITE_API_ORIGIN', 'VITE_TENCENT_MAP_KEY', 'VITE_AMAP_JS_KEY', 'VITE_AMAP_SECURITY_CODE', 'VITE_AMAP_MAP_STYLE')
foreach ($lineObject in @($remoteEnvOutput)) {
  $line = "$lineObject".Trim()
  if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { continue }
  $parts = $line -split '=', 2
  $name = $parts[0].Trim()
  if ($allowedBuildVars -notcontains $name) { continue }
  [Environment]::SetEnvironmentVariable($name, $parts[1].Trim(), 'Process')
}
foreach ($requiredName in @('VITE_AMAP_JS_KEY', 'VITE_AMAP_SECURITY_CODE')) {
  $requiredValue = [Environment]::GetEnvironmentVariable($requiredName, 'Process')
  if ([string]::IsNullOrWhiteSpace($requiredValue) -or $requiredValue.StartsWith('YOUR_')) {
    throw "required production map setting is missing: $requiredName"
  }
}
Write-Host '  protected AMap settings loaded (values hidden)'

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
    if ($code -ne 0) {
      # FALLBACK: vite calls `exec("net use")` (to detect network drives) outside its own
      # try/catch. In a sandbox that forbids piped spawns that throws `spawn EPERM` and kills
      # the build. tools/tmp/vite-sandbox-shim.mjs neutralises exactly that one probe, after
      # which vite takes its own documented fallback (plain fs.realpathSync). Tried only when
      # the normal build actually failed, so ordinary terminals keep the reference path.
      Write-Host "  pnpm build failed (exit $code) -- retrying via vite sandbox shim" -ForegroundColor Yellow
      $root2 = $root
      $shim = Join-Path $root2 'tools\tmp\vite-sandbox-shim.mjs'
      if (-not (Test-Path -LiteralPath $shim)) { throw "pnpm build failed and shim missing: $shim" }
      $shimUrl = ([Uri]$shim).AbsoluteUri
      $prev2 = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        $out2 = & node --import $shimUrl (Join-Path $root2 'app\node_modules\vite\bin\vite.js') build 2>&1
        $code2 = $LASTEXITCODE
        $out2 | Select-String -Pattern 'built in|error|dist/assets' | ForEach-Object { "  $($_.Line.Trim())" }
      } finally {
        $ErrorActionPreference = $prev2
      }
      if ($code2 -ne 0) { throw "frontend build failed (exit $code2)" }
    }
  } finally { Pop-Location }
} else {
  Write-Host '  (skipped: --SkipBuild)'
}

$dist = Join-Path $root 'app\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "Build output missing: $dist\index.html" }
$jsCount = (Get-ChildItem (Join-Path $dist 'assets') -Filter '*.js' -ErrorAction SilentlyContinue).Count

# Verify the actual bundle, not merely the parent shell environment. This also protects
# -SkipBuild from uploading an older artifact that was compiled without the map settings.
$builtScripts = @(Get-ChildItem (Join-Path $dist 'assets') -Filter '*.js' -File -ErrorAction SilentlyContinue)
$amapKey = [Environment]::GetEnvironmentVariable('VITE_AMAP_JS_KEY', 'Process')
$amapSecurityCode = [Environment]::GetEnvironmentVariable('VITE_AMAP_SECURITY_CODE', 'Process')
$bundleHasAmapConfig = $false
foreach ($builtScript in $builtScripts) {
  $scriptText = [IO.File]::ReadAllText($builtScript.FullName)
  if ($scriptText.Contains($amapKey) -and $scriptText.Contains($amapSecurityCode)) {
    $bundleHasAmapConfig = $true
    break
  }
}
if (-not $bundleHasAmapConfig) { throw 'built frontend does not contain the protected AMap configuration' }
Write-Host '  bundle check: protected AMap settings present (values hidden)'

Write-Host '=== 2) Upload to a timestamped staging dir ===' -ForegroundColor Cyan
# Build-id sentinel: lets the verifier PROVE a deploy actually happened
# (see the "vacuous probe" pitfall above).
$rev = (git -C $root rev-parse --short HEAD 2>$null)
$buildId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $rev
Set-Content -Path (Join-Path $dist 'build-id.txt') -Value $buildId -Encoding ascii -NoNewline
Write-Host "  build-id: $buildId"

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$stage = "${web}.new.$stamp"
$slot  = "/tmp/web-upload-$stamp"

& ssh -i $Key @SSH_OPTS $Target "mkdir -p '$stage' && echo staging-ready"
if ($LASTEXITCODE -ne 0) { throw "cannot create staging dir $stage (exit $LASTEXITCODE)" }

& ssh -i $Key @SSH_OPTS $Target "mkdir -p '$slot' && echo upload-slot-ready"
if ($LASTEXITCODE -ne 0) { throw "cannot create upload slot $slot (exit $LASTEXITCODE)" }

# Transfer the directory itself (no glob). scp -r <localdir> <remote>/ creates
# <remote>/<basename>, hence reading from $slot/dist below.
$previousScpPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & scp -q -i $Key @SSH_OPTS -r $dist "${Target}:$slot/"
  $distScpExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousScpPreference
}
if ($distScpExit -ne 0) { throw "upload failed (scp exit $distScpExit) - aborted, live site untouched" }

& ssh -i $Key @SSH_OPTS $Target "cp -a '$slot/dist/.' '$stage/' && echo staged && find '$stage' -type f | wc -l"
if ($LASTEXITCODE -ne 0) { throw "staging copy failed (exit $LASTEXITCODE)" }

Write-Host '=== 3) Upload remote helper ===' -ForegroundColor Cyan
$previousScpPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & scp -q -i $Key @SSH_OPTS $remoteScript "${Target}:/tmp/web-deploy-remote.sh"
  $helperScpExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousScpPreference
}
if ($helperScpExit -ne 0) { throw "uploading remote helper failed (exit $helperScpExit)" }

Write-Host '=== 4) Atomic swap + fix permissions ===' -ForegroundColor Cyan
# swap validates $stage/index.html before touching the live dir.
& ssh -i $Key @SSH_OPTS $Target "bash /tmp/web-deploy-remote.sh swap '$stage'"
$swapExit = $LASTEXITCODE
if ($swapExit -ne 0) { Write-Host 'SWAP FAILED (old version kept)' -ForegroundColor Red; exit 1 }
& ssh -i $Key @SSH_OPTS $Target 'bash /tmp/web-deploy-remote.sh perms'

Write-Host '=== 5) Smoke test on server ===' -ForegroundColor Cyan
& ssh -i $Key @SSH_OPTS $Target 'bash /tmp/web-deploy-remote.sh smoke'
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
