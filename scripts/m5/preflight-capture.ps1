<#
    VISUAL_TARGET_VALIDITY GATE - preflight / postflight check before and after
    capturing screenshot evidence.

    Usage:
      # before capture
      & 'scripts\m5\preflight-capture.ps1' -ExpectPackage com.campusx.demo
      & 'scripts\m5\preflight-capture.ps1' -ExpectPackage com.campusx.demo -ExpectCdpUrl '#/campus'

      # after capture (same call, run again)
      & 'scripts\m5\preflight-capture.ps1' -ExpectPackage com.campusx.demo -ExpectCdpUrl '#/campus'

    Exit code: 0 = PASS, 1 = FAIL (evidence must be treated as INVALID)

    Why this exists (frozen discipline, review log 41):
      On 2026-09-22 a screenshot used for visual verification actually showed the
      ORIGINAL third-party app (com.kairuotu.campus), not our demo. Both of these
      were true at the same time:
          CDP target URL  = our WebView  (https://localhost/#/campus)
          screen pixels   = original app (foreground)
      That is "the measurement method was completely correct, but the object
      measured was wrong" - more fundamental than a wrong coordinate.

      This is a SEPARATE check from DEVICE_HEALTH:
          DEVICE_HEALTH           -> device responds / repaints
          VISUAL_TARGET_VALIDITY  -> the current frame belongs to the target
      They cannot substitute for each other.

    Note: this file is intentionally ASCII-only. Writing non-ASCII into a .ps1
    without an explicit UTF-8 BOM makes Windows PowerShell read it as ANSI and
    mangles it into parse errors (hit twice already in this project).
#>
param(
  [Parameter(Mandatory = $true)][string]$ExpectPackage,
  # Optional: a substring that must appear in the CDP target url (e.g. '#/campus')
  [string]$ExpectCdpUrl = '',
  # Optional: expected activity (substring). Empty = only check package.
  [string]$ExpectActivity = '',
  [switch]$SkipCdp,
  [int]$CdpPort = 9222
)

$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$serial = '127.0.0.1:16384'

$fail = 0
function Ok($m)   { Write-Output "  PASS $m" }
function Bad($m)  { Write-Output "  FAIL $m"; $script:fail = 1 }
function Info($m) { Write-Output "  info $m" }

Write-Output '=== VISUAL_TARGET_VALIDITY GATE ==='
Write-Output "  expected package : $ExpectPackage"
if ($ExpectActivity) { Write-Output "  expected activity: $ExpectActivity" }
if (-not $SkipCdp)   { Write-Output "  cdp url contains : $ExpectCdpUrl" }
Write-Output ''

# ---------------------------------------------------------------- 1) foreground
Write-Output '--- 1) foreground window (mCurrentFocus) ---'
$win = & $adb -s $serial shell dumpsys window 2>&1 | Select-String 'mCurrentFocus' | Select-Object -First 1
$focusLine = if ($win) { $win.Line.Trim() } else { '' }
Info $focusLine

if ($focusLine -match [regex]::Escape($ExpectPackage)) {
  Ok "foreground package is the expected one ($ExpectPackage)"
} else {
  Bad "foreground is NOT $ExpectPackage  -> screenshot evidence would be INVALID"
}

if ($ExpectActivity) {
  if ($focusLine -match [regex]::Escape($ExpectActivity)) {
    Ok "foreground activity contains $ExpectActivity"
  } else {
    Bad "foreground activity does not contain $ExpectActivity"
  }
}

# Do NOT force-stop the original app (frozen third-party intervention discipline).
if ($fail -eq 1) {
  Write-Output ''
  Write-Output '  hint: bring OUR app to the front instead of stopping anything:'
  Write-Output "        adb -s $serial shell am start -n $ExpectPackage/.MainActivity"
  Write-Output '        NEVER force-stop the original third-party app by default.'
}

# ---------------------------------------------------------------- 2) CDP target
if (-not $SkipCdp) {
  Write-Output ''
  Write-Output '--- 2) CDP target url ---'
  $cdpOk = $false
  try {
    $json = (Invoke-WebRequest "http://127.0.0.1:$CdpPort/json" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $pages = @($json | Where-Object { $_.type -eq 'page' })
    Info "page targets: $($pages.Count)"
    foreach ($p in $pages) { Info "  url=$($p.url)" }
    if ($pages.Count -eq 0) {
      Bad 'no CDP page target (is adb forward tcp:9222 set up for OUR webview pid?)'
    } elseif ($ExpectCdpUrl -eq '') {
      Ok "CDP reachable with $($pages.Count) page target(s)"
      $cdpOk = $true
    } else {
      $match = @($pages | Where-Object { $_.url -like "*$ExpectCdpUrl*" })
      if ($match.Count -gt 0) {
        Ok "CDP target url contains $ExpectCdpUrl"
        $cdpOk = $true
      } else {
        Bad "no CDP page target url contains $ExpectCdpUrl"
      }
    }
  } catch {
    Bad "CDP unreachable: $($_.Exception.Message)"
  }
  # Reminder of the core lesson: CDP being connected does NOT imply the target is foreground.
  if ($cdpOk) {
    Info 'NOTE: CDP reachable != target app is in the foreground. Both checks must pass.'
  }
}

Write-Output ''
if ($fail -eq 0) {
  Write-Output 'VISUAL_TARGET_VALIDITY: PASS'
  exit 0
} else {
  Write-Output 'VISUAL_TARGET_VALIDITY: FAIL'
  Write-Output '  -> screenshot/visual evidence from this moment must be treated as INVALID'
  Write-Output '  -> this is NOT a product FAIL; it is "evidence void"'
  exit 1
}
