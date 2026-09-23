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
# USAGE
#   powershell -File tools/release-android.ps1                 # build + sync + install
#   powershell -File tools/release-android.ps1 -SkipInstall    # build only
#   powershell -File tools/release-android.ps1 -Verify         # also run key device gates
param(
  [switch]$SkipInstall,
  [switch]$Verify,
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

if ($Verify) {
  Step '6' 'Key device gates (these enforce artifact provenance + platform semantics)'
  # NOTE: the device gate wrapper releases port 9222 from our web-test Chrome
  # itself, so the two targets can no longer be confused.
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
    if ($rc -ne 0) { throw "device gate failed: $g (see $log)" }
  }
}

Write-Host ''
Write-Host "RELEASE_ANDROID: OK (build+sync$(if(-not $SkipInstall){'+install'}))" -ForegroundColor Green
