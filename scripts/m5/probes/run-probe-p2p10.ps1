# WO#5 round-2 probe orchestration (ASCII only - avoid PowerShell ANSI/UTF8 misread of .ps1)
# P2: fire getUserMedia from the WebView; at the same time poll device focus to detect the real Android permission UI (P3)
$ErrorActionPreference = 'Continue'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$S   = '127.0.0.1:16384'
$TMP = 'G:\demo map\tools\tmp'

Write-Output "=== preconditions ==="
$pkg = & $adb -s $S shell dumpsys package com.campusx.demo 2>&1
$g = $pkg | Select-String 'RECORD_AUDIO: granted=' | Select-Object -First 1
Write-Output ("  P1 permission state: " + $g.Line.Trim())
Write-Output ("  P0 permission declared: " + $(if ($pkg | Select-String 'android.permission.RECORD_AUDIO' -Quiet) { 'YES' } else { 'NO' }))

$outFile = Join-Path $TMP 'probe-p2p10.json'
if (Test-Path $outFile) { Remove-Item -LiteralPath $outFile -Force }

Write-Output ""
Write-Output "=== start node probe (background) ==="
$p = Start-Process -FilePath 'node' -ArgumentList 'probe-p2p10.mjs' -WorkingDirectory $TMP `
      -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $TMP 'probe-p2p10.out.log') `
      -RedirectStandardError  (Join-Path $TMP 'probe-p2p10.err.log')
Write-Output ("  node pid = " + $p.Id)

Write-Output ""
Write-Output "=== P3: poll for real Android permission UI (every 400ms, up to 25s) ==="
$seen = New-Object System.Collections.Generic.List[string]
$dialogSeen = $false
for ($i = 0; $i -lt 62; $i++) {
  Start-Sleep -Milliseconds 400
  $w = & $adb -s $S shell dumpsys window 2>&1 | Select-String 'mCurrentFocus' | Select-Object -First 1
  if ($w) {
    $line = $w.Line.Trim()
    if (-not $seen.Contains($line)) {
      $seen.Add($line)
      $sec = [Math]::Round($i * 0.4, 1)
      Write-Output ("  [" + $sec + "s] " + $line)
    }
    if ($line -match 'permissioncontroller|packageinstaller|GrantPermission') {
      $dialogSeen = $true
      Write-Output "  >> permission UI detected"
      break
    }
  }
  if ($p.HasExited) {
    $sec = [Math]::Round($i * 0.4, 1)
    Write-Output ("  node exited at " + $sec + "s")
    break
  }
}

Write-Output ""
Write-Output "=== P3 result ==="
if ($dialogSeen) { Write-Output "  system permission UI: YES" } else { Write-Output "  system permission UI: NO (no permissioncontroller/packageinstaller focus seen)" }
Write-Output "  focus transitions:"
$seen | ForEach-Object { Write-Output ("    " + $_) }

if ($dialogSeen) {
  Write-Output ""
  Write-Output "=== try to tap Allow on the permission UI ==="
  & $adb -s $S shell uiautomator dump /sdcard/probe-perm.xml 2>&1 | Out-Null
  & $adb -s $S pull /sdcard/probe-perm.xml (Join-Path $TMP 'probe-perm.xml') 2>&1 | Out-Null
  $permFile = Join-Path $TMP 'probe-perm.xml'
  if (Test-Path $permFile) {
    $x = [IO.File]::ReadAllText($permFile, [Text.Encoding]::UTF8)
    $texts = [regex]::Matches($x, 'text="([^"]{1,24})"') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne '' } | Select-Object -Unique
    Write-Output ("  UI texts: " + ($texts -join ' | '))
    # look for an allow-ish button by resource-id first (locale independent)
    $m = [regex]::Match($x, '<node[^>]*resource-id="[^"]*permission_allow[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    if (-not $m.Success) {
      $m = [regex]::Match($x, '<node[^>]*text="[^"]*(Allow|ALLOW)[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    }
    if ($m.Success) {
      $cx = [int](([int]$m.Groups[1].Value + [int]$m.Groups[3].Value) / 2)
      $cy = [int](([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2)
      Write-Output ("  tap Allow at (" + $cx + "," + $cy + ")")
      & $adb -s $S shell input tap $cx $cy 2>&1 | Out-Null
    } else {
      Write-Output "  WARN: no allow button matched; dump saved for inspection"
    }
  }
}

Write-Output ""
Write-Output "=== wait for node probe ==="
$p.WaitForExit(90000) | Out-Null
Write-Output ("  node exit code = " + $p.ExitCode)
Write-Output ""
Write-Output "=== node stdout ==="
$o1 = Join-Path $TMP 'probe-p2p10.out.log'
if (Test-Path $o1) { Get-Content $o1 | ForEach-Object { Write-Output ("  " + $_) } }
Write-Output ""
Write-Output "=== node stderr ==="
$o2 = Join-Path $TMP 'probe-p2p10.err.log'
if (Test-Path $o2) { Get-Content $o2 | Select-Object -First 12 | ForEach-Object { Write-Output ("  " + $_) } }
