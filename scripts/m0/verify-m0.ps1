<#
  M0 Exit Gate —— 总编排（在开发机执行）
  用法：
    .\scripts\m0\verify-m0.ps1                # 本地断言 + 服务器断言 + 外部可达性
    .\scripts\m0\verify-m0.ps1 -Phase pre     # 额外记录 boot_id（reboot 前）
    .\scripts\m0\verify-m0.ps1 -Phase post    # 额外校验 boot_id 已变化（reboot 后）
    .\scripts\m0\verify-m0.ps1 -LocalOnly     # 只跑本地断言
  退出码：任一 mandatory 断言失败 → 1
#>
param(
  [ValidateSet('none','pre','post')][string]$Phase = 'none',
  [switch]$LocalOnly
)
$ErrorActionPreference = 'Continue'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # scripts/m0 -> repo root
Set-Location $root

$script:failed = 0
function Pass([string]$sec, [string]$msg) { Write-Output "PASS $sec $msg" }
function Fail([string]$sec, [string]$msg) { Write-Output "FAIL $sec $msg"; $script:failed = 1 }
function Chk([string]$sec, [string]$msg, [scriptblock]$cond) {
  try { if (& $cond) { Pass $sec $msg } else { Fail $sec $msg } } catch { Fail $sec "$msg [exception: $($_.Exception.Message)]" }
}
function Expect([string]$sec, [string]$msg, $actual, $expected) {
  if ("$actual" -eq "$expected") { Pass $sec "$msg (=$actual)" } else { Fail $sec "$msg (got='$actual' want='$expected')" }
}

Write-Output "M0_GATE_VERSION=1"
Write-Output ""

# ---------------- [GIT] ----------------
$branch = (git branch --show-current).Trim()
Expect GIT "current branch == fullstack" $branch 'fullstack'

$baseFile = 'docs/m0/base-commit.txt'
Chk GIT "base-commit recorded" { Test-Path -LiteralPath $baseFile }
$base = if (Test-Path -LiteralPath $baseFile) { (Get-Content -LiteralPath $baseFile -Raw).Trim() } else { '' }
if ($base) {
  git merge-base --is-ancestor $base HEAD 2>$null
  Chk GIT "recorded M0 base commit is ancestor of HEAD" { $LASTEXITCODE -eq 0 }
}
Chk GIT "git status --porcelain == empty" { -not (git status --porcelain) }
Chk GIT "PLAN.md exists" { Test-Path -LiteralPath 'PLAN.md' }
$reviews = @(Get-ChildItem -Path 'docs/review-log' -Filter '*.md' -ErrorAction SilentlyContinue)
Chk GIT "docs/review-log contains >= 1 review" { $reviews.Count -ge 1 }
Chk GIT "private key is NOT tracked by git" { -not (@(git ls-files | Select-String '\.pem$').Count -gt 0) }
$historyPem = @(git log --all --name-only --pretty=format: | Select-String '\.pem$')
Chk GIT "private key is NOT present in git history" { $historyPem.Count -eq 0 }

# M0 diff allowlist
if ($base) {
  $allow = @('PLAN.md','.gitignore','.gitattributes')
  $allowPrefix = @('docs/','ops/','scripts/m0/','tools/')
  $changed = @(git diff --name-only "$base..HEAD") + @(git diff --name-only) + @(git ls-files --others --exclude-standard)
  $changed = @($changed | Where-Object { $_ } | Sort-Object -Unique)
  $disallowed = @($changed | Where-Object {
      $f = $_ -replace '\\','/'
      -not (($allow -contains $f) -or (@($allowPrefix | Where-Object { $f.StartsWith($_) }).Count -gt 0))
    })
  Chk GIT "M0 diff touches only allowed paths" { $disallowed.Count -eq 0 }
  if ($disallowed.Count -gt 0) { Write-Output ("     disallowed: " + ($disallowed -join ', ')) }

  # ---------------- [SCOPE] ----------------
  Chk SCOPE "no frontend source file changed since M0 base" {
    -not (@($changed | Where-Object { ($_ -replace '\\','/') -like 'app/src/*' }).Count -gt 0)
  }
  Chk SCOPE "no business API source added" {
    -not (@($changed | Where-Object { ($_ -replace '\\','/') -like 'server/src/*' }).Count -gt 0)
  }
  Chk SCOPE "no business migration/schema added" {
    -not (@($changed | Where-Object { ($_ -replace '\\','/') -match '(^|/)(migrations|schema)(/|$)' }).Count -gt 0)
  }
}

# ---------------- [ORIGINAL_BASELINE] ----------------
$baseDir = 'docs/original-baseline'
Chk ORIGINAL_BASELINE "manifest.json exists" { Test-Path -LiteralPath "$baseDir/manifest.json" }
Chk ORIGINAL_BASELINE "environment.json exists" { Test-Path -LiteralPath "$baseDir/environment.json" }
Chk ORIGINAL_BASELINE "SHA256SUMS exists" { Test-Path -LiteralPath "$baseDir/SHA256SUMS" }

if (Test-Path -LiteralPath "$baseDir/manifest.json") {
  $man = Get-Content -LiteralPath "$baseDir/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  Expect ORIGINAL_BASELINE "manifest expected_screens == 22" $man.expected_screen_count 22
  $completed = @($man.screens | Where-Object { $_.has_evidence }).Count
  Expect ORIGINAL_BASELINE "completed_screens == 22" $completed 22

  $allowed = @('observed','not_applicable','not_reproducible','blocked','unknown')
  $badSchema = @()
  $badEnum = @()
  $badEvidence = @()
  $noNormal = @()
  foreach ($s in $man.screens) {
    $bj = Join-Path $baseDir "screens/$($s.id)/baseline.json"
    if (-not (Test-Path -LiteralPath $bj)) { $badSchema += $s.id; continue }
    $doc = Get-Content -LiteralPath $bj -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @('screen_id','title','target_route','entry','states','interactions','navigation','persistence','known_unknowns')) {
      if ($null -eq $doc.$k) { $badSchema += "$($s.id):$k" }
    }
    foreach ($st in @('loading','empty','normal','error')) {
      $status = $doc.states.$st.status
      if (-not $status) { $badEnum += "$($s.id):$st=missing" }
      elseif ($allowed -notcontains $status) { $badEnum += "$($s.id):$st=$status" }
      foreach ($ev in @($doc.states.$st.evidence)) {
        if ($ev -and -not (Test-Path -LiteralPath (Join-Path $baseDir "screens/$($s.id)/$ev"))) {
          $badEvidence += "$($s.id)/$ev"
        }
      }
    }
    if ($doc.states.normal.status -ne 'observed') { $noNormal += $s.id }
  }
  Chk ORIGINAL_BASELINE "every screen has required schema fields" { $badSchema.Count -eq 0 }
  if ($badSchema.Count) { Write-Output ("     missing: " + ($badSchema -join ', ')) }
  Chk ORIGINAL_BASELINE "every state has explicit status enum" { $badEnum.Count -eq 0 }
  if ($badEnum.Count) { Write-Output ("     bad: " + ($badEnum -join ', ')) }
  Chk ORIGINAL_BASELINE "every referenced evidence file exists" { $badEvidence.Count -eq 0 }
  if ($badEvidence.Count) { Write-Output ("     dangling: " + ($badEvidence -join ', ')) }

  # 每一页都必须有 normal.png 截图证据（审核要求的 Exit Gate 条件之一）
  $pngMissing = @($man.screens | Where-Object { -not (Test-Path -LiteralPath (Join-Path $baseDir "screens/$($_.id)/normal.png")) })
  Chk ORIGINAL_BASELINE "every screen has normal-state evidence" { $pngMissing.Count -eq 0 }
  if ($pngMissing.Count) { Write-Output ("     no png: " + (($pngMissing | ForEach-Object { $_.id }) -join ', ')) }

  # 校验和：每个证据文件都要在 SHA256SUMS 里且哈希匹配
  $sumMap = @{}
  if (Test-Path -LiteralPath "$baseDir/SHA256SUMS") {
    foreach ($line in Get-Content -LiteralPath "$baseDir/SHA256SUMS") {
      if ($line -match '^([0-9a-f]{64})\s+(.+)$') { $sumMap[$matches[2].Trim()] = $matches[1] }
    }
  }
  $sumBad = @()
  foreach ($s in $man.screens) {
    $rel = "screens/$($s.id)/normal.png"
    if (-not $sumMap.ContainsKey($rel)) { $sumBad += "$rel(未登记)"; continue }
    $actual = (Get-FileHash -LiteralPath (Join-Path $baseDir $rel) -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $sumMap[$rel]) { $sumBad += "$rel(不匹配)" }
  }
  Chk ORIGINAL_BASELINE "every evidence file has matching SHA256" { $sumBad.Count -eq 0 }
  if ($sumBad.Count) { Write-Output ("     bad sums: " + ($sumBad -join ', ')) }
}

if ($LocalOnly) { Write-Output ''; if ($script:failed -eq 0) { Write-Output 'SECTION_RESULT PASS' } else { Write-Output 'SECTION_RESULT FAIL' }; exit $script:failed }

# ---------------- 服务器断言 ----------------
Write-Output ""
$key = Join-Path $root 'TimeMap.pem'
$sshBase = @('-i', $key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', 'root@8.148.156.146')

function Run-Remote([string]$remoteCmd) {
  & ssh @sshBase $remoteCmd 2>&1
}

if ($Phase -eq 'pre') {
  Write-Output "--- Phase pre: record boot_id ---"
  # 直接内联一段 bash（base64 传递，避开 PowerShell → ssh 的引号问题；这条路径已验证可行）
  $bootSh = @'
mkdir -p /srv/campus
printf '{"boot_id":"%s","saved_at":"%s"}\n' "$(cat /proc/sys/kernel/random/boot_id)" "$(date -Is)" > /srv/campus/m0-reboot-state.json
cat /srv/campus/m0-reboot-state.json
'@
  $encBoot = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootSh))
  $saved = Run-Remote "echo '$encBoot' | base64 -d | bash"
  $saved | ForEach-Object { Write-Output "     $_" }
  if (-not ($saved -match 'boot_id')) { Fail REBOOT "boot_id_before recorded" } else { Pass REBOOT "boot_id_before recorded" }
}

$serverScript = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'scripts\m0\verify-m0-server.sh')))
$mode = if ($Phase -eq 'post') { 'check-boot' } else { 'assert' }
$out = Run-Remote "echo '$serverScript' | base64 -d > /tmp/verify-m0-server.sh && bash /tmp/verify-m0-server.sh $mode"
$out | ForEach-Object {
  $line = "$_".Trim()
  if ($line -match '^PASS ') { Write-Output $line }
  elseif ($line -match '^FAIL ') { Write-Output $line; $script:failed = 1 }
  elseif ($line -match '^SAMPLE|^  sampled') { Write-Output "     $line" }
}

# ---------------- 外部可达性 ----------------
Write-Output ""
$submit = curl.exe -sS -m 30 -H 'Accept: application/json' 'https://check-host.net/check-http?host=http%3A%2F%2F8.148.156.146%2Fhealth&max_nodes=3' 2>$null
try {
  $jid = ($submit | ConvertFrom-Json).request_id
  Start-Sleep -Seconds 14
  $res = curl.exe -sS -m 30 -H 'Accept: application/json' "https://check-host.net/check-result/$jid" 2>$null | ConvertFrom-Json
  $ok = 0; $tot = 0
  foreach ($node in $res.PSObject.Properties) {
    $tot++
    $r = $node.Value[0]
    if ($r -and $r[0] -eq 1 -and "$($r[2])" -eq 'OK') { $ok++ }
  }
  Expect EXTERNAL "external /health == HTTP 200 (check-host $ok/$tot nodes)" $ok $tot
} catch {
  Fail EXTERNAL "external /health check failed to run: $($_.Exception.Message)"
}

Write-Output ""
if ($script:failed -eq 0) { Write-Output 'M0_GATE_RESULT PASS' } else { Write-Output 'M0_GATE_RESULT FAIL' }
exit $script:failed
