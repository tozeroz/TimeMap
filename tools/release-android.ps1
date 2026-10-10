# One-command Android release pipeline (and the web/APK artifact consistency it needs).
#
# ============================================================================
# WHY THIS SCRIPT EXISTS (a bug I hit TWICE in one session)
# ============================================================================
# The correct sequence is:
#     tsc -> pnpm build -> **npx cap sync android** -> gradle build+install
# I kept running "pnpm build + build-android.ps1" and FORGETTING cap sync.
# Consequence: the APK still contains the OLD web bundle, and the device gates
# fail with:
#     ARTIFACT_PROVENANCE: FAIL (source changed != executed artifact changed)
# That guard exists precisely because this happened before (review 50 made it a
# mechanical proof). Forgetting a step that a GUARD catches is still a process
# bug: the guard tells you after the fact, and you burn a debug round.
# => Encode the sequence once, here, and never hand-assemble it again.
#
# NOTE: keep this file ASCII-only.
# Windows PowerShell 5.1 parses a BOM-less UTF-8 .ps1 with the local ANSI
# codepage. Non-ASCII then breaks PARSING (not just messages) - a mis-decoded
# Chinese comment once silently swallowed an assignment and a variable came out
# empty, producing "mkdir: cannot create directory ''".
# Chinese rationale for this project lives in docs/ and in the .sh files.
#
# ⚠️ WHEN THE REPO PATH CONTAINS NON-ASCII CHARACTERS, USE tools/build-apk.ps1 INSTEAD.
#    (Update 2026-10-09.) This script's step 4 calls gradlew directly. If the checkout path has
#    non-ASCII characters, the Kotlin compile fails with the very misleading
#      "error: cannot access 'String' which is a supertype of ..."
#    because Gradle escapes non-ASCII paths as \uXXXX in its compiler argfiles and the Kotlin
#    compiler does not understand that escape. tools/build-apk.ps1 builds through an ASCII
#    junction view of the same files and verifies the packaged version + in-APK web bundle.
#    This script remains useful for its device-install and device-gate steps on an ASCII path.
#
# USAGE
#   powershell -File tools/release-android.ps1                 # full: build+sync+provenance+install+provenance
#   powershell -File tools/release-android.ps1 -SkipInstall    # build + sync + provenance (no device needed)
#   powershell -File tools/release-android.ps1 -SkipVerify     # explicit opt-out of the post-install check
#
# WHY THIS IS THE ONLY SANCTIONED ANDROID ENTRY POINT
#   Review 71 asked for exactly this: "you only need ONE canonical Android
#   build/release entry point", with the fixed order
#     build -> cap sync -> provenance -> build -> install
#   and these fail-fast rules (quoted from that review, translated):
#     "cap sync failure -> the entire release command must fail"
#     "provenance failure -> the entire release command must fail"
#     "never warn and then keep packaging an APK anyway"
#   The point: move the fix from "remind the agent to remember" to
#   "the pipeline structurally cannot skip it".
param(
  [switch]$SkipInstall,
  [switch]$SkipVerify,
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'

function Step($n, $msg) { Write-Host "=== $n) $msg ===" -ForegroundColor Cyan }

# WHY the helper instead of plain "& cmd":
# pnpm/tsc write progress lines to STDERR. With $ErrorActionPreference='Stop'
# PowerShell turns native stderr into a terminating error, so a perfectly fine
# build aborts. Relax it for the call and judge by $LASTEXITCODE instead.
function RunNative($label, $pwd, [scriptblock]$body) {
  Push-Location $pwd
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $body 2>&1
    $code = $LASTEXITCODE
    $out | Select-String -Pattern 'built in|error|FAIL|Success|BUILD|dist/|Sync finished|Copied' |
      ForEach-Object { "  $($_.Line.Trim())" }
  } finally {
    $ErrorActionPreference = $prev
    Pop-Location
  }
  if ($code -ne 0) { throw "$label failed (exit $code)" }
}

if ($Version) {
  Step '0' "Bump version to $Version (both places must agree)"
  # Single source of truth check: app/src/version.ts AND android versionName.
  # A device gate (APP_VERSION_MATCHES_ANDROID) compares them mechanically.
  $vt = Join-Path $app 'src\version.ts'
  $gradle = Join-Path $app 'android\app\build.gradle'
  (Get-Content $vt -Raw) -replace "APP_VERSION = '[^']*'", "APP_VERSION = '$Version'" |
    Set-Content $vt -NoNewline -Encoding utf8
  Write-Host "  version.ts -> $Version"
  $g = Get-Content $gradle -Raw
  $g = $g -replace 'versionName "[^"]*"', "versionName `"$Version`""
  $g = $g -replace 'versionCode \d+', ("versionCode " + ([int](($g | Select-String -Pattern 'versionCode (\d+)').Matches[0].Groups[1].Value) + 1))
  $g | Set-Content $gradle -NoNewline -Encoding utf8
  Write-Host "  build.gradle -> $Version (versionCode incremented)"
}

Step '1' 'Typecheck (leaf config; the solution config checks nothing)'
RunNative 'tsc' $app { & npx tsc --noEmit -p tsconfig.app.json }

Step '2' 'Build web bundle'
RunNative 'pnpm build' $app { & pnpm build }

Step '3' 'cap sync android  <-- THE STEP THAT KEEPS GETTING FORGOTTEN'
# Without this the APK bundles a stale web bundle and ARTIFACT_PROVENANCE fails.
RunNative 'cap sync' $app { & npx cap sync android }

Step '3.5' 'PROVENANCE (web dist == cap asset) -- MANDATORY, no device needed'
# Review 71: "provenance failure -> entire release command fails".
# This is the cheap half of the existing three-way proof: if cap sync did not
# actually copy the new bundle, we must stop HERE, not warn and keep packaging.
# The authoritative three-way check (adding the installed APK) stays
# scripts/m5/check-artifact-provenance.sh -- reused, not reinvented.
$distAssets = Join-Path $app 'dist\assets'
$capAssets  = Join-Path $app 'android\app\src\main\assets\public\assets'
function NewestIndexJs($dir) {
  $f = Get-ChildItem $dir -Filter 'index-*.js' -ErrorAction SilentlyContinue |
       Sort-Object Name | Select-Object -Last 1
  if (-not $f) { return $null }
  return $f
}
$d = NewestIndexJs $distAssets
$c = NewestIndexJs $capAssets
if (-not $d) { throw "no web bundle in $distAssets (build step did not produce one)" }
if (-not $c) { throw "no cap asset in $capAssets (cap sync produced nothing)" }
$dSha = (Get-FileHash $d.FullName -Algorithm SHA256).Hash
$cSha = (Get-FileHash $c.FullName -Algorithm SHA256).Hash
Write-Host "  dist: $($d.Name)  $($dSha.Substring(0,16))..."
Write-Host "  cap : $($c.Name)  $($cSha.Substring(0,16))..."
if ($d.Name -ne $c.Name -or $dSha -ne $cSha) {
  throw "PROVENANCE FAIL: web dist != cap asset -- cap sync did not take effect. Aborting (no APK produced)."
}
Write-Host '  PASS web dist == cap asset (same name and same sha256)' -ForegroundColor Green

Step '4' 'Gradle assemble + install'
if ($SkipInstall) {
  RunNative 'gradle assembleDebug' (Join-Path $app 'android') { & .\gradlew.bat assembleDebug }
} else {
  RunNative 'gradle installDebug' (Join-Path $app 'android') { & .\gradlew.bat installDebug }
}

$apk = Join-Path $app 'android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }
$sha = (Get-FileHash $apk -Algorithm SHA256).Hash
$size = (Get-Item $apk).Length
Step '5' 'APK'
Write-Host "  path : $apk"
Write-Host "  size : $size bytes"
Write-Host "  sha256: $sha"

if (-not $SkipInstall -and -not $SkipVerify) {
  Step '6' 'Three-way provenance + platform semantics via device gates'
  # This reuses the EXISTING authoritative script (scripts/m5/check-artifact-provenance.sh)
  # through run-device-gate.sh, which also runs it before any device conclusion.
  # NOTE: the wrapper releases port 9222 from our web-test Chrome itself, so the
  # device and web targets can no longer be confused.
  $gates = @(
    'gate-wo23-update-check.mjs',
    'gate-wo23-update-platform.mjs',
    'gate-wo6-tabbar-orientation.mjs'
  )
  $bash = 'C:\Program Files\Git\bin\bash.exe'
  foreach ($g in $gates) {
    $log = Join-Path $env:TEMP "release-gate-$g.log"
    & $bash (Join-Path $root 'scripts\m5\run-device-gate.sh') (Join-Path $root "scripts\m5\$g") *>&1 |
      Out-File $log -Encoding UTF8
    $rc = $LASTEXITCODE
    # NOTE: no "??" here -- that operator is PowerShell 7+ only; this runs on 5.1.
    $provLine = Select-String -Path $log -Pattern 'ARTIFACT_PROVENANCE: ' | Select-Object -First 1
    $prov = ''
    if ($provLine) { $prov = $provLine.Line.Trim() }
    Write-Host ("  {0,-38} exit={1}  {2}" -f $g, $rc, $prov)
    if ($rc -ne 0) { throw "device gate failed: $g (see $log) -- release aborted" }
  }
} elseif ($SkipVerify) {
  Write-Host ''
  Write-Host '  NOTE: -SkipVerify given -> the installed-APK provenance check DID NOT run.' -ForegroundColor Yellow
  Write-Host '        Do not cite device conclusions without it.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "RELEASE_ANDROID: OK (build+sync+provenance$(if(-not $SkipInstall){'+install+provenance'}))" -ForegroundColor Green
