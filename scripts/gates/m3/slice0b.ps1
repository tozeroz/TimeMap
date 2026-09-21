<#
  M3 Slice 0B 阶段 Gate
  ==========================================================================
  依据：docs/review-log/08（Slice 0B 的三处修订）+ PLAN §10 的 Gate 方法论
  Gate 只做两件事：**检查**与**FAIL**。它从不自动修复任何东西。

  三层结构（审核记录 04 冻结）：
    1) PERSISTENT   —— 跨阶段必须一直成立的不变量（M0/M1/M2 冻结项，**不删除、按阶段反转**）
    2) STAGE        —— 本阶段新增/改变的不变量（Slice 0B：phone+OTP、就绪门禁、登录 UI）
    3) REGRESSION   —— 回归：确认本阶段没有把之前已经证明过的东西弄坏

  判定口径（审核记录 08 的强制拆分）：
    LOGIN_ENTRY_VISUAL        —— login-select / login-sns 有真实证据 → 可判 PASS
    OTP_UI_FUNCTIONAL         —— 功能可判 PASS
    OTP_UI_VISUAL_CONFORMANCE —— 验证码页无证据（BLOCKED_BY_ETHICS）→ NOT_EVALUATED
  这条拆分是必须的：把"没有证据的页面"算成 1:1 一致，就是自欺。

  用法：powershell -File scripts/gates/m3/slice0b.ps1
#>
param(
  [string]$SshKey = '',
  [switch]$SkipDevice   # 只跑服务端部分（调试用）；正式 Gate 不得使用
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $SshKey) { $SshKey = Join-Path $repo 'TimeMap.pem' }
$SshHost = 'root@8.148.156.146'

$script:Failed = 0
<#
  per-slice 失败记账（审核记录 09 的命名要求）：
  **不要让不同 slice 共享同一个最终结果 key** —— 否则未来自动汇总会把
  "Slice 0B 过没过"和"Slice 1 过没过"混成一个数，产生歧义。
  这里用 $script:CurrentSlice 标记当前正在检查哪一段，Bad() 把失败记到对应 slice 上。
#>
$script:SliceFail = @{ SLICE0B = 0; SLICE1 = 0; SLICE2 = 0 }
$script:CurrentSlice = 'SLICE0B'
function Ok([string]$m) { Write-Output "PASS $m" }
function Bad([string]$m) {
  Write-Output "FAIL $m"
  $script:Failed = 1
  $script:SliceFail[$script:CurrentSlice] = 1
}
function Head([string]$m) { Write-Output ''; Write-Output "=== $m ===" }
function Say([string]$m) { Write-Output $m }

# ssh 会把远端 stderr 带回来；在本脚本 $ErrorActionPreference='Stop' 下，
# 那会被当成终止错误**直接把 Gate 打断**（曾导致第 5 节整段拿不到结果）。
# 所以所有远端调用都要临时放宽 —— 与 device 脚本里 adb 的处理同理。
function Invoke-SshRaw([string]$remoteCommand) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & ssh -i $SshKey -o BatchMode=yes $SshHost $remoteCommand 2>&1
    return @($out | ForEach-Object { "$_" })
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Run-Remote([string]$scriptPath) {
  $bytes = [IO.File]::ReadAllBytes($scriptPath)
  $b64 = [Convert]::ToBase64String($bytes)
  return Invoke-SshRaw "echo '$b64' | base64 -d | bash"
}

<#
  带参数的远端脚本：**先把脚本写到远端文件，再以文件+参数执行**。
  为什么不直接 `bash -s <script> arg`：`bash -s` 之后的位置参数语义在不同 bash 版本上不一致，
  之前踩过（verify-backend.sh 需要 $1 区分 M1/M2 阶段）。写文件最直白。
#>
function Run-RemoteArgs([string]$scriptPath, [string]$scriptArgs) {
  $bytes = [IO.File]::ReadAllBytes($scriptPath)
  $b64 = [Convert]::ToBase64String($bytes)
  return Invoke-SshRaw "echo '$b64' | base64 -d > /tmp/gate-script.sh && bash /tmp/gate-script.sh $scriptArgs"
}

function Run-RemoteNode([string]$scriptPath, [string]$scriptArgs) {
  $bytes = [IO.File]::ReadAllBytes($scriptPath)
  $b64 = [Convert]::ToBase64String($bytes)
  return Invoke-SshRaw "echo '$b64' | base64 -d > /tmp/gate-node.mjs && /opt/node-v24.21.0-linux-x64/bin/node /tmp/gate-node.mjs $scriptArgs"
}

function Emit-Section([string]$title, [string]$resultTag, [array]$lines) {
  Head $title
  # 保留**全部非空行**（审核记录 04：只留 PASS/FAIL 会丢掉诊断信息）
  foreach ($l in $lines) { if ("$l".Trim()) { Say "  $l" } }
  $resultLine = @($lines | Where-Object { "$_" -match $resultTag }) | Select-Object -Last 1
  if ($resultLine -match 'PASS') { Ok "$title → PASS" }
  elseif ($resultLine -match 'FAIL') { Bad "$title → FAIL" }
  else { Bad "$title → 未产出 $resultTag（Gate 不能把'没跑到'当通过）" }
}

Write-Output '############################################################'
Write-Output '# M3 Slice 0B Gate'
Write-Output "############################################################"

# ---------------------------------------------------------------------------
Head '1) 环境前置（不满足就没有可信的 Gate 结果）'
$sshOk = (Invoke-SshRaw 'echo ssh-ok' | Out-String).Trim()
if ($sshOk -match 'ssh-ok') { Ok '可 SSH 到服务器' } else { Bad '无法 SSH 到服务器'; exit 1 }
$remoteReady = (Invoke-SshRaw 'systemctl is-active campus-backend.service' | Out-String).Trim()
if ($remoteReady -eq 'active') { Ok 'campus-backend.service active' } else { Bad "后端服务状态: $remoteReady" }

# ---------------------------------------------------------------------------
Head '2) PERSISTENT：健康语义三分离（M0/M1 冻结不变量）'
$probe = @'
set -uo pipefail
printf 'edge=%s\n'   "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/health)"
printf 'live=%s\n'   "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health)"
printf 'ready=%s\n'  "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready)"
printf 'readybody=%s\n' "$(curl -s -m 5 http://127.0.0.1/api/ready)"
'@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probe))
$health = Invoke-SshRaw "echo '$b' | base64 -d | bash"
foreach ($l in $health) { if ("$l".Trim()) { Say "  $l" } }
$edge = ($health | Where-Object { $_ -match '^edge=' }) -replace '^edge=', ''
$live = ($health | Where-Object { $_ -match '^live=' }) -replace '^live=', ''
$ready = ($health | Where-Object { $_ -match '^ready=' }) -replace '^ready=', ''
if ($edge -eq '200') { Ok 'Nginx /health = 200（网关活着）' } else { Bad "Nginx /health = $edge" }
if ($live -eq '200') { Ok '/api/health = 200（进程活着）' } else { Bad "/api/health = $live" }
if ($ready -eq '200') { Ok '/api/ready = 200（schema 就绪）' } else { Bad "/api/ready = $ready" }
if (($health | Where-Object { $_ -match '"applied":5' }) -and ($health | Where-Object { $_ -match '"expected":5' })) {
  Ok '迁移 5/5（含 004 模型修订与 005 手机号身份）'
} else { Bad '迁移版本数不是 5/5' }

# ---------------------------------------------------------------------------
Head '3) STAGE：Slice 0B 后端（phone+OTP、HMAC、dev sink、就绪门禁）'
Emit-Section '3.1 认证脚本（A–G 组）' 'AUTH_OTP_RESULT' (Run-Remote (Join-Path $repo 'scripts\m3\verify-auth-otp.sh'))

Head '3.2 密码登录必须不存在（审核记录 08 第 1 点）'
$probePw = @'
set -uo pipefail
printf 'login_status=%s\n' "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1/api/auth/login -H 'Content-Type: application/json' -d '{"handle":"anmoss","password":"whatever"}')"
export PGPASSWORD="$(cat /srv/campus/.db_password)"
printf 'password_col=%s\n' "$(psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from information_schema.columns where table_name='users' and column_name='password_hash'")"
before="$(psql -h 127.0.0.1 -U campus -d campus -Atc 'select count(*) from sessions where revoked_at is null')"
printf 'login_body_has_token=%s\n' "$(curl -s -m 5 -X POST http://127.0.0.1/api/auth/login -H 'Content-Type: application/json' -d '{"handle":"anmoss","password":"whatever"}' | grep -c '"token"')"
after="$(psql -h 127.0.0.1 -U campus -d campus -Atc 'select count(*) from sessions where revoked_at is null')"
printf 'sessions_delta=%s\n' "$((after - before))"
'@
$b2 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probePw))
$pw = Invoke-SshRaw "echo '$b2' | base64 -d | bash"
foreach ($l in $pw) { if ("$l".Trim()) { Say "  $l" } }
$st = ($pw | Where-Object { $_ -match '^login_status=' }) -replace '^login_status=', ''
$pc = ($pw | Where-Object { $_ -match '^password_col=' }) -replace '^password_col=', ''
$sd2 = ($pw | Where-Object { $_ -match '^sessions_delta=' }) -replace '^sessions_delta=', ''
$tb = ($pw | Where-Object { $_ -match '^login_body_has_token=' }) -replace '^login_body_has_token=', ''
if ($st -eq '410') { Ok 'POST /api/auth/login = 410（密码登录已退休）' } else { Bad "/api/auth/login = $st（期望 410）" }
if ($pc -eq '0') { Ok 'users 表无 password_hash 列' } else { Bad "password_hash 列仍存在（$pc）" }
# 注意：这里断言的是**外部可观察的事实**（发密码拿不到会话），
# 不是"产物里有没有某个字符串"——后者是实现位置断言，PLAN §10 明确不允许。
if ($sd2 -eq '0') { Ok '发密码后未新增任何会话（这条路拿不到会话）' } else { Bad "发密码后会话数变化 $sd2（期望 0）" }
if ($tb -eq '0') { Ok '响应里没有任何 token 字段' } else { Bad '响应里出现了 token 字段' }

Head '3.3 dev sink 权限与"不进日志"'
$probeSink = @'
set -uo pipefail
echo "sink_dir_perm=$(stat -c %a /run/campus/login-codes 2>/dev/null || echo missing)"
echo "sink_files=$(ls /run/campus/login-codes 2>/dev/null | wc -l)"
echo "runtime_dir=$(systemctl show -p RuntimeDirectory campus-backend.service | tr -d '\n')"
'@
$b3 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probeSink))
$sk = Invoke-SshRaw "echo '$b3' | base64 -d | bash"
foreach ($l in $sk) { if ("$l".Trim()) { Say "  $l" } }
$sd = ($sk | Where-Object { $_ -match '^sink_dir_perm=' }) -replace '^sink_dir_perm=', ''
$rd = ($sk | Where-Object { $_ -match '^runtime_dir=' }) -replace '^runtime_dir=', ''
if ($sd -eq '700') { Ok 'dev sink 目录权限 0700' } else { Bad "dev sink 目录权限 $sd（期望 700）" }
if ($rd -match 'RuntimeDirectory=campus') { Ok 'systemd RuntimeDirectory=campus 已配置（重启后 sink 自动重建）' } else { Bad "RuntimeDirectory 未配置: $rd" }

# ---------------------------------------------------------------------------
Head '4) STAGE：设备端登录 E2E（不注入 session 夹具）'
if ($SkipDevice) {
  Bad '使用了 -SkipDevice：正式 Gate 不允许跳过设备端闭环'
} else {
  $e2eLog = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\m3\verify-device-login.ps1') 2>&1
  $e2e = @($e2eLog | ForEach-Object { "$_" })
  foreach ($l in $e2e) { if ("$l".Trim()) { Say "  $l" } }
  $e2eResult = @($e2e | Where-Object { $_ -match 'DEVICE_LOGIN_E2E_RESULT' }) | Select-Object -Last 1
  if ($e2eResult -match 'PASS') { Ok '设备端完整闭环 PASS' } else { Bad '设备端完整闭环 FAIL' }

  # 拆开判定（审核记录 08 的强制要求）
  if (($e2e | Where-Object { $_ -match '协议弹窗' }) -and ($e2e | Where-Object { $_ -match '登录入口页' })) {
    Ok 'LOGIN_ENTRY_VISUAL: PASS（login-select 有真实证据，逐项走过）'
  } else { Bad 'LOGIN_ENTRY_VISUAL: 未覆盖' }
  if ($e2eResult -match 'PASS') {
    Ok 'OTP_UI_FUNCTIONAL: PASS（发码/输入/校验/落会话全通）'
  } else { Bad 'OTP_UI_FUNCTIONAL: FAIL' }
  Say '  OTP_UI_VISUAL_CONFORMANCE: NOT_EVALUATED reason=BLOCKED_BY_ETHICS'
  Say '    （验证码页无原版证据：取证会给真实号码真发短信，主动停止；故不做 1:1 判定）'
  Say '  SMS_GATEWAY_NOT_INTEGRATED: 真（无短信通道，投递走 dev sink）'
}

# ---------------------------------------------------------------------------
Head '5) REGRESSION：M1/M2 已证明过的能力未被弄坏'
Emit-Section '5.1 后端与作者信任（verify-backend，M3 阶段：用手机号+验证码取会话）' 'BACKEND_RESULT' (Run-RemoteArgs (Join-Path $repo 'scripts\m1\verify-backend.sh') 'M3')
Emit-Section '5.2 seed 幂等 + canonical + 收敛性（M2）' 'SEED_RESULT' (Run-Remote (Join-Path $repo 'scripts\m2\verify-seed.sh'))
Emit-Section '5.3 备份/恢复演练（M2）' 'BACKUP_DRILL_RESULT' (Run-Remote (Join-Path $repo 'scripts\m2\backup-restore-drill.sh'))
Emit-Section '5.4 TLS 服务器侧（M2）' 'TLS_SERVER_RESULT' (Run-Remote (Join-Path $repo 'scripts\m2\verify-tls-server.sh'))

# ---------------------------------------------------------------------------
Head '6) PERSISTENT：基线证据完整性（M0 冻结项 + supplements 审计）'
$manPath = Join-Path $repo 'docs\original-baseline\manifest.json'
if (Test-Path -LiteralPath $manPath) {
  $man = Get-Content -LiteralPath $manPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $cov = $man.coverage.current
  Say "  口径（来自 coverage.current）: total $($cov.total_original_screens) / observed $($cov.observed) / evidence-blocked $($cov.evidence_blocked)"
  if ($cov.expected -and $cov.observed -ne $cov.total_original_screens) { Bad '口径内部不一致' }
  elseif ($cov.observed -ne 22 -or $cov.evidence_blocked -ne 0) { Bad "口径应为 22/0，实际 $($cov.observed)/$($cov.evidence_blocked)" }
  else { Ok '口径 22 observed / 0 evidence-blocked' }
  Say "  历史口径: $(($man.coverage.history | ForEach-Object { "$($_.stage)=$($_.observed)/$($_.evidence_blocked)" }) -join '; ')"
} else { Bad '缺少 manifest.json' }

$m0 = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\m0\verify-m0.ps1') -Stage M1 -LocalOnly 2>&1
$m0lines = @($m0 | ForEach-Object { "$_" })
$m0fail = @($m0lines | Where-Object { $_ -match '^FAIL' })
if ($m0fail.Count -eq 0) { Ok 'M0 基线完整性检查全通过（manifest/枚举/证据文件/SHA256）' }
else { foreach ($f in $m0fail) { Bad "M0: $f" } }

# ---------------------------------------------------------------------------
$script:CurrentSlice = 'SLICE1'
Head '6.5) STAGE Slice 1：帖子详情 / 评论 / 回复（含点卡片进详情的回归）'
Emit-Section '6.5.1 后端评论接口（含层级语义与计数口径）' 'COMMENTS_RESULT' (Run-Remote (Join-Path $repo 'scripts\m3\verify-comments.sh'))

Head '6.5.2 设备端（我们自己的 demo app；允许写操作）'
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$serial = '127.0.0.1:16384'
$appPkg = 'com.campusx.demo'
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $adb -s $serial shell am force-stop $appPkg | Out-Null
  Start-Sleep -Seconds 2
  & $adb -s $serial shell monkey -p $appPkg -c android.intent.category.LAUNCHER 1 | Out-Null
  Start-Sleep -Seconds 7
  $wp = (& $adb -s $serial shell pidof $appPkg | Out-String).Trim()
  & $adb -s $serial forward --remove-all | Out-Null
  if ($wp) { & $adb -s $serial forward tcp:9222 "localabstract:webview_devtools_remote_$wp" | Out-Null }
} finally {
  $ErrorActionPreference = $prevEap
}
if (-not $wp) { Bad '设备未就绪：找不到 app 进程' } else { Say "  WebView pid=$wp（已转发 CDP 9222）" }

foreach ($mode in @('detail', 'cardtap', 'composer', 'authgate')) {
  $out = & node (Join-Path $repo 'scripts\m3\device-slice1.mjs') $mode 2>&1
  $lines = @($out | ForEach-Object { "$_" })
  foreach ($l in $lines) { if ("$l".Trim()) { Say "  $l" } }
  $tag = "SLICE1_$($mode.ToUpper())_RESULT"
  $res = @($lines | Where-Object { $_ -match $tag }) | Select-Object -Last 1
  if ($res -match 'PASS') { Ok "设备端 $mode → PASS" } else { Bad "设备端 $mode → FAIL（未产出 $tag）" }
}
# ---------------------------------------------------------------------------
$script:CurrentSlice = 'SLICE2'
Head '6.6) STAGE Slice 2：点赞（原版侧只读；切换行为 BLOCKED_BY_POLICY）'
Emit-Section '6.6.1 后端点赞接口（幂等 / 鉴权 / 跨用户隔离）' 'LIKES_RESULT' (Run-Remote (Join-Path $repo 'scripts\m3\verify-likes.sh'))

Head '6.6.2 设备端展示规则（与原版只读观察、与数据库权威值比对）'
$adb2 = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$serial2 = '127.0.0.1:16384'
$appPkg2 = 'com.campusx.demo'
$prevEap2 = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $adb2 -s $serial2 shell am force-stop $appPkg2 | Out-Null
  Start-Sleep -Seconds 2
  & $adb2 -s $serial2 shell monkey -p $appPkg2 -c android.intent.category.LAUNCHER 1 | Out-Null
  Start-Sleep -Seconds 7
  $wp2 = (& $adb2 -s $serial2 shell pidof $appPkg2 | Out-String).Trim()
  & $adb2 -s $serial2 forward --remove-all | Out-Null
  if ($wp2) { & $adb2 -s $serial2 forward tcp:9222 "localabstract:webview_devtools_remote_$wp2" | Out-Null }
} finally {
  $ErrorActionPreference = $prevEap2
}
if (-not $wp2) { Bad '设备未就绪：找不到 app 进程' } else { Say "  WebView pid=$wp2（已转发 CDP 9222）" }

# 从数据库读权威计数，作为"UI 与权威值一致"的比对基准
# （用单引号 PS 字符串 + '' 转义，避免嵌套 here-string 把脚本解析打断）
$countsCmd = 'export PGPASSWORD=$(cat /srv/campus/.db_password); for p in aaaaaaaa-0001-4001-8001-000000000001 aaaaaaaa-0002-4002-8002-000000000002; do echo "$p $(psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from likes where post_id=''''$p''''") $(psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from comments where post_id=''''$p''''")"; done'
$counts = Invoke-SshRaw $countsCmd
$p1Line = @($counts | Where-Object { "$_" -match '0001-4001' }) | Select-Object -First 1
$p2Line = @($counts | Where-Object { "$_" -match '0002-4002' }) | Select-Object -First 1
$p1Parts = "$p1Line".Trim().Split(' ')
$p2Parts = "$p2Line".Trim().Split(' ')
$p1L = $p1Parts[1]; $p1C = $p1Parts[2]
$p2L = $p2Parts[1]; $p2C = $p2Parts[2]
Say "  DB 权威计数：p1 likes=$p1L comments=$p1C；p2 likes=$p2L comments=$p2C"

foreach ($case in @(
  @{ args = @('display',  '--post', 'aaaaaaaa-0001-4001-8001-000000000001', '--expect-like', $p1L, '--expect-comment', $p1C); tag = 'SLICE2_DISPLAY_RESULT' },
  @{ args = @('display',  '--post', 'aaaaaaaa-0002-4002-8002-000000000002', '--expect-like', $p2L, '--expect-comment', $p2C); tag = 'SLICE2_DISPLAY_RESULT' },
  @{ args = @('authgate', '--post', 'aaaaaaaa-0001-4001-8001-000000000001', '--expect-like', $p1L); tag = 'SLICE2_AUTHGATE_RESULT' }
)) {
  $out2 = & node (Join-Path $repo 'scripts\m3\device-slice2.mjs') @($case.args) 2>&1
  $lines2 = @($out2 | ForEach-Object { "$_" })
  foreach ($l in $lines2) { if ("$l".Trim()) { Say "  $l" } }
  $res2 = @($lines2 | Where-Object { "$_" -match $case.tag }) | Select-Object -Last 1
  if ($res2 -match 'PASS') { Ok "设备端 $($case.args[0]) → PASS" } else { Bad "设备端 $($case.args[0]) → FAIL（未产出 $($case.tag)）" }
}

# ---------------------------------------------------------------------------
Head '7) POLICY：第三方只读约束的执行情况（用户 2026-09-21 明确要求）'
$pvPath = Join-Path $repo 'docs\POLICY-VIOLATION-2026-09-21.md'
if (Test-Path -LiteralPath $pvPath) {
  $pv = Get-Content -LiteralPath $pvPath -Raw -Encoding UTF8
  Ok '违规记录 docs/POLICY-VIOLATION-2026-09-21.md 存在（不得删除：它是审计线索）'
  if ($pv -match '严禁任何写操作') { Ok '记录里含硬约束原文' } else { Bad '记录里缺少硬约束原文' }
  if ($pv -match '补救') { Ok '记录里含补救选项（待用户裁定）' } else { Bad '记录里缺少补救选项' }
} else {
  Bad '缺少 docs/POLICY-VIOLATION-2026-09-21.md —— 违规记录被删除'
}
# PLAN 里的硬约束必须还在
$planText = Get-Content -LiteralPath (Join-Path $repo 'PLAN.md') -Raw -Encoding UTF8
if ($planText -match '第三方系统只读约束') { Ok 'PLAN §3.1 硬约束存在' } else { Bad 'PLAN 缺少 §3.1 第三方只读约束' }
if ($planText -match 'BLOCKED_BY_POLICY') { Ok 'PLAN 已登记 BLOCKED_BY_POLICY 标签' } else { Bad 'PLAN 缺少 BLOCKED_BY_POLICY' }
# 带违规标记的补充证据必须自曝其违规状态（不能悄悄当普通 observed）
$pvFiles = @(Get-ChildItem -LiteralPath (Join-Path $repo 'docs\original-baseline\supplements') -Filter '*.json' |
  Where-Object { (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8) -match 'POLICY_VIOLATION' })
Say "  带 POLICY_VIOLATION 标记的补充证据: $($pvFiles.Count) 个（$((($pvFiles | ForEach-Object { $_.BaseName }) -join ', '))）"
if ($pvFiles.Count -ge 3) { Ok '违规取得的证据已自曝标签（未被当作普通 observed）' } else { Bad "带违规标记的补充证据只有 $($pvFiles.Count) 个（期望 >=3）" }

# ---------------------------------------------------------------------------
Write-Output ''
Write-Output '############################################################'
# 每个 slice 有自己的结果 key（审核记录 09：不得共享同一个最终结果 key）
if ($script:SliceFail.SLICE0B -eq 0) {
  Write-Output '# M3_SLICE0B_GATE_RESULT: PASS'
  Write-Output '#   LOGIN_ENTRY_VISUAL:        PASS'
  Write-Output '#   OTP_UI_FUNCTIONAL:         PASS'
  Write-Output '#   OTP_UI_VISUAL_CONFORMANCE: NOT_EVALUATED (BLOCKED_BY_ETHICS)'
} else {
  Write-Output '# M3_SLICE0B_GATE_RESULT: FAIL'
}
if ($script:SliceFail.SLICE1 -eq 0) {
  Write-Output '# M3_SLICE1_GATE_RESULT: PASS'
  Write-Output '#   COMMENTS_MODEL:            SUPPORTED / PRESENTATION EXPANDED'
  Write-Output '#   COMMENT_COUNT_INCLUDES_REPLIES: PASS'
  Write-Output '#   REPLY_TARGET_FROM_PARENT_AUTHOR: PASS'
  Write-Output '#   EVIDENCE_OBTAINED_BY_POLICY_VIOLATION: TRUE (结论保留，手段违规已登记)'
} else {
  Write-Output '# M3_SLICE1_GATE_RESULT: FAIL'
}
if ($script:SliceFail.SLICE2 -eq 0) {
  Write-Output '# M3_SLICE2_GATE_RESULT: PASS'
  Write-Output '#   LIKE_TOGGLE_IDEMPOTENT:        PASS'
  Write-Output '#   LIKE_CROSS_USER_ISOLATION:     PASS'
  Write-Output '#   LIKE_COUNT_HIDDEN_WHEN_ZERO:   PASS（与原版只读观察一致）'
  Write-Output '#   COMMENT_COUNT_ZERO_SHOWS_WORD: PASS（与原版只读观察一致）'
  Write-Output '#   LIKE_TOGGLE_EVIDENCE:          BLOCKED_BY_POLICY（原版禁止取证；仅自建系统验证，不声称 1:1）'
} else {
  Write-Output '# M3_SLICE2_GATE_RESULT: FAIL'
}
Write-Output '############################################################'
exit $script:Failed
