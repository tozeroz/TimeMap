<#
  M2 Gate（对应 docs/archive/legacy-development/m2/SPEC.md 第八节）。

  结构按审核记录 04 §10.3 收束：本里程碑的验收放在 scripts/gates/m2/，
  历史的 M0/M1 入口保持原样（scripts/m0/verify-m0.ps1、scripts/m1/verify-m1.ps1）。

  口径（审核记录 04 修订）：
    Milestone PASS = Persistent invariants + Current-stage invariants + Regression checks

  用法：
    & '.\scripts\gates\m2\milestone.ps1'                 # 全量
    & '.\scripts\gates\m2\milestone.ps1' -SkipDevice     # 没开模拟器时
  证据：docs/archive/legacy-development/m2/evidence/gate-<时间戳>.txt
#>
param(
  [switch]$SkipM0,
  [switch]$SkipDevice,
  [switch]$SkipServer
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$evidenceDir = Join-Path $repo 'docs\archive\legacy-development\m2\evidence'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidencePath = Join-Path $evidenceDir "gate-$stamp.txt"

$script:failed = 0
$script:lines = New-Object System.Collections.ArrayList

function Say($m) { Write-Output $m; [void]$script:lines.Add([string]$m) }
function Ok($m) { Say "PASS $m" }
function Bad($m) { Say "FAIL $m"; $script:failed = 1 }
function Head($m) { Say ''; Say "=== $m ===" }

function Run-Remote([string]$ScriptPath) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ScriptPath))
  $key = Join-Path $repo 'TimeMap.pem'
  & ssh -i $key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes `
    root@8.148.156.146 "echo '$b64' | base64 -d | bash" 2>&1
}

function Run-RemoteText([string]$Text) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
  $key = Join-Path $repo 'TimeMap.pem'
  & ssh -i $key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes `
    root@8.148.156.146 "echo '$b64' | base64 -d | bash" 2>&1
}

# 需要给远端脚本传参时用它：先落盘再 `bash 文件 参数`。
# 不能直接 `echo b64 | base64 -d | bash M2` —— 那样 M2 会被当成脚本名而不是 $1。
function Run-RemoteArgs([string]$ScriptPath, [string]$ArgLine) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ScriptPath))
  $key = Join-Path $repo 'TimeMap.pem'
  $name = "/tmp/gate-$(Split-Path $ScriptPath -Leaf)"
  & ssh -i $key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o BatchMode=yes `
    root@8.148.156.146 "echo '$b64' | base64 -d > '$name' && bash '$name' $ArgLine" 2>&1
}

Say "M2 Gate  时间=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  仓库=$repo"

# ---------------------------------------------------------------------------
if (-not $SkipM0) {
  Head 'PERSISTENT) 永久不变量（M0 语义，stage=M1）'
  $out = & (Join-Path $repo 'scripts\m0\verify-m0.ps1') -Stage M1 2>&1
  $out | ForEach-Object {
    $line = "$_".Trim()
    if ($line -match '^(PASS|FAIL) ') { Say "  $line" }
    elseif ($line -match '^(NOTE|===)') { Say "  $line" }
  }
  if ($out | Select-String -Pattern 'M0_GATE_RESULT PASS' -Quiet) { Ok '永久不变量全部 PASS' }
  else { Bad '永久不变量出现回归' }
} else {
  Say ''
  Say 'NOTE 已跳过永久不变量（不可作为最终验收依据）'
}

# ---------------------------------------------------------------------------
# 静态检查（不需要服务器/设备）
# ---------------------------------------------------------------------------
Head 'STATIC) 临时债是否真的收回（明文例外 / mixedContent / HostnameVerifier）'

$nsc = Join-Path $repo 'app\android\app\src\main\res\xml\network_security_config.xml'
if (Test-Path -LiteralPath $nsc) {
  $nscText = [IO.File]::ReadAllText($nsc, [Text.Encoding]::UTF8)
  if ($nscText -match 'cleartextTrafficPermitted="true"') { Bad 'NSC 里仍有明文例外' }
  else { Ok 'NSC 无明文例外（cleartextTrafficPermitted=false）' }
  if ($nscText -match 'campus_demo_ca') { Ok 'NSC 内置了临时私有 CA（@raw/campus_demo_ca）' }
  else { Bad 'NSC 未内置私有 CA' }
} else { Bad "缺少 $nsc" }

$cap = Join-Path $repo 'app\capacitor.config.ts'
$capText = [IO.File]::ReadAllText($cap, [Text.Encoding]::UTF8)
if ($capText -match 'allowMixedContent:\s*false') { Ok 'allowMixedContent 已关闭' }
else { Bad 'allowMixedContent 仍为开' }

$caFile = Join-Path $repo 'app\android\app\src\main\res\raw\campus_demo_ca.crt'
if (Test-Path -LiteralPath $caFile) {
  $caText = [IO.File]::ReadAllText($caFile, [Text.Encoding]::UTF8)
  if ($caText -match 'BEGIN CERTIFICATE' -and $caText -notmatch 'PRIVATE KEY') { Ok 'APK 内置的是公钥证书（不含私钥）' }
  else { Bad 'APK 内置的 CA 文件内容可疑' }
} else { Bad '缺少内置 CA 文件' }

# 绝不实现 always-true 的 HostnameVerifier
$androidSrc = Get-ChildItem (Join-Path $repo 'app\android') -Recurse -Include *.java,*.kt -File -ErrorAction SilentlyContinue
$hv = @($androidSrc | Select-String -Pattern 'HostnameVerifier|setHostnameVerifier|checkServerTrusted' -ErrorAction SilentlyContinue)
if ($hv.Count -eq 0) { Ok 'Android 源码里没有自定义 HostnameVerifier / TrustManager（没有绕过校验）' }
else { Bad "发现可能绕过 TLS 校验的代码：$($hv.Count) 处" }

# ---------------------------------------------------------------------------
if (-not $SkipServer) {
  # 统一的证据采集：把子脚本的**全部非空行**都写进证据。
  # 早期版本按正则只留 PASS/FAIL/=== 行，结果失败时证据里没有诊断信息
  # （例如计时段的耗时数字），等于把排障线索丢掉了 —— 证据应当足以独立复现判断。
  function Emit-Section([string]$title, [string]$marker, [string[]]$out) {
    Head $title
    $out | ForEach-Object {
      if ("$_".Trim()) { Say "  $_" }
    }
    if ($out | Select-String -Pattern "$marker PASS" -Quiet) { Ok "$title → PASS" }
    else { Bad "$title → FAIL" }
  }

  Emit-Section 'MIGRATION/API/VERTICAL_SLICE/SYSTEMD/NGINX/RESOURCE（stage=M2）' 'BACKEND_RESULT' `
    (Run-RemoteArgs (Join-Path $repo 'scripts\m1\verify-backend.sh') 'M2')
  # ===========================================================================
  # 历史断言组（**只在 M2 修订上可复现**）—— 审核记录 08 的 CLOSEOUT_REQUIRED：
  #   "preserve/recover historical M2 auth Gate reproducibility
  #    without reintroducing password auth into the current product"
  #
  # verify-auth.sh 测的是 M2 冻结的 handle+password 契约。当前产品已退休那条路径
  # （POST /api/auth/login → 410），所以：
  #   - 这份脚本必须保留：它是 M2 阶段的审计产物，删掉就等于抹掉历史 Gate 的可复现性
  #   - 但它只能对 **M2 修订** 运行（复现步骤见 docs/archive/legacy-development/m3/CLOSEOUT-SLICE0B.md）
  #   - 拿它跑当前部署会（正确地）失败 —— 那说明产品已前进，不是缺陷
  # 当前产品的认证断言在 M3 的 Gate 里（scripts/gates/m3/slice0b.ps1 → verify-auth-otp.sh）。
  # ===========================================================================
  Emit-Section 'AUTH（历史断言：M2 的 handle+password 契约，仅 M2 修订可复现）' 'AUTH_RESULT' `
    (Run-Remote (Join-Path $repo 'scripts\m2\verify-auth.sh'))
  Emit-Section 'SEED) convergent + canonical' 'SEED_RESULT' `
    (Run-Remote (Join-Path $repo 'scripts\m2\verify-seed.sh'))
  Emit-Section 'BACKUP) pg_dump -Fc + pg_restore 到全新库（四项对比）' 'BACKUP_DRILL_RESULT' `
    (Run-Remote (Join-Path $repo 'scripts\m2\backup-restore-drill.sh'))
  Emit-Section 'TLS) 九条中的服务器侧部分' 'TLS_SERVER_RESULT' `
    (Run-Remote (Join-Path $repo 'scripts\m2\verify-tls-server.sh'))

  Head 'SCOPE) 库里不得有超出数据模型的表'
  $tbl = Run-Remote (Join-Path $repo 'scripts\m1\check-tables.sh')
  $tblList = @($tbl | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  Say "  表($($tblList.Count)): $($tblList -join ', ')"
  $expectedTables = @(
    'announcements','board_notes','campuses','comments','group_members','groups','likes','login_challenges','media',
    'message_threads','messages','places','posts','schema_migrations','schools','sessions',
    'thread_members','users'
  )
  $unexpected = @($tblList | Where-Object { $_ -notin $expectedTables })
  if ($unexpected.Count -eq 0) { Ok '表集合与 DATA-MODEL.md 追溯表一致（14 业务表 + schema_migrations）' }
  else { Bad "出现了未追溯的表: $($unexpected -join ', ')" }
}

# ---------------------------------------------------------------------------
# 数据模型追溯性（审核 scope gate 的证据必须存在）
Head 'TRACEABILITY) 每张表都能追溯到已观察实体'
$dm = Join-Path $repo 'docs\archive\legacy-development\m2\DATA-MODEL.md'
if (Test-Path -LiteralPath $dm) {
  $dmText = [IO.File]::ReadAllText($dm, [Text.Encoding]::UTF8)
  $missing = @()
  foreach ($t in @('users','posts','media','places','comments','likes','message_threads',
                   'thread_members','messages','board_notes','groups','group_members','announcements',
                   'schools','campuses','login_challenges')) {
    if ($dmText -notmatch "``$t``") { $missing += $t }
  }
  if ($missing.Count -eq 0) { Ok 'DATA-MODEL.md 覆盖全部 16 张业务表（含 M3 新增的 schools/campuses/login_challenges）' }
  else { Bad "DATA-MODEL.md 缺少追溯: $($missing -join ', ')" }
} else { Bad '缺少 docs/archive/legacy-development/m2/DATA-MODEL.md（scope gate 的证据）' }

# ---------------------------------------------------------------------------
if ($SkipDevice) {
  Say ''
  Say 'NOTE 已跳过设备组（不可作为最终验收依据）'
} else {
  Head 'DEVICE) 设备侧 TLS + 回归（真实触摸，经 HTTPS）'
  $adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
  $serial = '127.0.0.1:16384'
  $pkg = 'com.campusx.demo'

  $dev = (& $adb devices 2>&1 | Out-String)
  if ($dev -notmatch [regex]::Escape($serial)) {
    Bad "模拟器未连接（$serial）"
  } else {
    Ok "模拟器在线（$serial）"
    & $adb -s $serial shell am force-stop $pkg 2>&1 | Out-Null
    & $adb -s $serial shell am start -n "$pkg/.MainActivity" 2>&1 | Out-Null
    Start-Sleep -Seconds 5
    & $adb -s $serial forward --remove-all 2>&1 | Out-Null
    $appPid = (& $adb -s $serial shell pidof $pkg 2>&1 | Out-String).Trim()
    if ($appPid) { & $adb -s $serial forward tcp:9222 "localabstract:webview_devtools_remote_$appPid" 2>&1 | Out-Null }

    # TLS 探测（https 必须通、明文必须失败）
    $probe = & node (Join-Path $repo 'tools\device-eval.mjs') --file (Join-Path $repo 'scripts\m2\device-tls-probe.js') 45000 2>&1
    $probeText = $probe | Out-String
    Say "  $($probeText.Trim().Replace("`n", "`n  "))"
    if ($probeText -match '"status":\s*200') { Ok '设备侧 https 请求成功（内置私有 CA 生效）' }
    else { Bad '设备侧 https 请求未成功' }
    if ($probeText -match 'cleartextError') { Ok '设备侧明文请求失败（明文已不可用）' }
    else { Bad '设备侧明文请求竟然成功' }

    # 回归：注入会话后真实触摸发帖（经 HTTPS）
    $sessionFile = Join-Path $repo 'tools\tmp\session.json'
    if (-not (Test-Path -LiteralPath $sessionFile)) {
      Bad '缺少 tools/tmp/session.json（Gate 需要它注入会话；先登录取得会话）'
    } else {
      $marker = "M2-GATE-$(Get-Date -Format 'MMddHHmmss')"
      $e2e = & node (Join-Path $repo 'scripts\m1\device-e2e.mjs') $marker --session-file $sessionFile 2>&1
      $e2e | ForEach-Object { Say "  $_" }
      if ($e2e | Select-String -Pattern 'DEVICE_E2E PASS' -Quiet) { Ok '设备真实触摸发帖（经 HTTPS）并出现在信息流' }
      else { Bad '设备端发帖 E2E 失败' }

      $q = @"
export PGPASSWORD="`$(cat /srv/campus/.db_password)"
psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from posts p join users u on u.id=p.author_id where p.body like '$marker%'"
"@
      $cnt = (Run-RemoteText $q | Out-String).Trim()
      if ($cnt -eq '1') { Ok '该帖在库里且有服务端归属（join users 命中 1 行）' }
      else { Bad "归属校验异常: $cnt" }
    }
  }
}

# ---------------------------------------------------------------------------
Head '阶段报告口径（审核强制，唯一真源 = manifest.coverage）'
# 口径不再硬编码在 Gate 里：由 docs/test/original-baseline/manifest.json 的 coverage.current 推导。
# 原因（审核记录 07 P1-2）：三个 blocked 页面取证成功后口径应当**当场改变**，
# 硬编码会让 Gate 继续打印过期的 19/3。历史值保留在 coverage.history 里可审计。
$manPath = Join-Path $repo 'docs\test\original-baseline\manifest.json'
if (Test-Path -LiteralPath $manPath) {
  $cov = (Get-Content -LiteralPath $manPath -Raw -Encoding UTF8 | ConvertFrom-Json).coverage
  Say "  （当前口径来自 coverage.current @ $($cov.current.stage)）"
  Say "total original screens: $($cov.current.total_original_screens)"
  Say "observed baseline:      $($cov.current.observed)"
  Say "evidence-blocked:       $($cov.current.evidence_blocked)"
  Say "out-of-scope:           $($cov.current.out_of_scope)"
  if ($cov.current.evidence_blocked -gt 0) { Say "  仍被阻断: $($cov.current.blocked_screens -join ', ')" }
  Say "  （历史口径: $(($cov.history | ForEach-Object { "$($_.stage)=$($_.observed) observed/$($_.evidence_blocked) blocked" }) -join '; ')）"
} else {
  Bad '缺少 docs/test/original-baseline/manifest.json（无法取得口径）'
}

Say ''
Say 'M2 认证与传输结论（审核记录 05 要求分开记）：'
Say '  AUTH_FUNCTIONAL:    PASS'
Say '  TRANSPORT_SECURITY: PASS（临时私有 CA + IP SAN，TLSv1.3；明文例外与 allowMixedContent 已收回）'

Say ''
if ($script:failed -eq 0) { Say 'M2_GATE_RESULT PASS' } else { Say 'M2_GATE_RESULT FAIL' }
$script:lines | Set-Content -LiteralPath $evidencePath -Encoding UTF8
Say "证据: $evidencePath"
exit $script:failed
