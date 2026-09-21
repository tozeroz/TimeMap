<#
  M3 Slice 3 设备端验证：真实 OTP 登录 → UI 发帖 → 归属与持久性
  ==========================================================================
  审核记录 10 批准的工作单：
    真实手机号 OTP 登录 → session → PublishScreen → 请求体不含 author/authorId
    → backend 从 session 解析 author_id → 写入 PG → 返回校园页/刷新
    → UI 作者与登录身份一致 → App 重启后仍存在

  原版侧政策：**只读**。发布是写操作，原版侧的发布后反馈/跳转/动画一律
  BLOCKED_BY_POLICY —— 本脚本只在**我们自己的 app** 上发布。

  本脚本复用 scripts/m3/device-login-helper.ps1（审核要求：不要整段复用
  verify-device-login.ps1，避免 Slice 0B 与 Slice 3 的 Gate 互相耦合）。
  使用 helper 产生的测试账号**由本脚本自己清理**（helper 刻意不带副作用）。
#>
param(
  [string]$Adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe',
  [string]$Serial = '127.0.0.1:16384',
  [string]$Pkg = 'com.campusx.demo',
  [string]$SshKey = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $SshKey) { $SshKey = Join-Path $repo 'TimeMap.pem' }

. (Join-Path $repo 'scripts\m3\device-login-helper.ps1')

$script:Failed = 0
function Ok([string]$m) { Write-Output "PASS $m" }
function Bad([string]$m) { Write-Output "FAIL $m"; $script:Failed = 1 }
function Step([string]$m) { Write-Output ''; Write-Output "=== $m ===" }

function Invoke-Ssh([string]$shell) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($shell))
    return @(& ssh -i $SshKey -o BatchMode=yes root@8.148.156.146 "echo '$b64' | base64 -d | bash" 2>&1 | ForEach-Object { "$_" })
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Run-Dev3([string[]]$NodeArgs) {
  # 本脚本设了 ErrorActionPreference='Stop'，而 Node 在 Windows 上退出时
  # 可能往 stderr 打无关断言（UV_HANDLE_CLOSING）——那会被当成**终止错误**把脚本打断。
  # 与 adb/ssh 的 stderr 同类：调用外部程序必须临时放宽。
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & node (Join-Path $repo 'scripts\m3\device-slice3.mjs') @NodeArgs 2>&1
    return @($out | ForEach-Object { "$_" })
  } finally {
    $ErrorActionPreference = $prev
  }
}

$MARK = "M3SLICE3UIDEV$([int](Get-Date -UFormat %s))"

Step '1. 无 session 夹具：冷启动 → 真实 OTP 登录'
$session = Connect-DeviceLoggedIn
Ok "已登录：phone=$($session.Phone) displayName=$($session.DisplayName)"

# 会话身份必须与 App 内读到的一致（避免"登录了但 App 里不是这个身份"）
$who = (Run-Dev3 @('whoami') | Where-Object { "$_" -match '^\{' } | Select-Object -Last 1)
$whoObj = $who | ConvertFrom-Json
if ($whoObj.DisplayName -eq $session.DisplayName) {
  Ok "App 内会话身份与 helper 返回一致（$($whoObj.DisplayName)）"
} else { Bad "App 内身份 ('$($whoObj.DisplayName)') 与 helper ('$($session.DisplayName)') 不一致" }

Step '2. 走发布页 UI 发一条（文字模式）'
$pub = Run-Dev3 @('publish', '--text', $MARK)
foreach ($l in $pub) { if ("$l".Trim()) { Write-Output "  $l" } }
$pubText = ($pub | Out-String)
# 用**明确的成功标记**判定，而不是"找到了按钮"这种弱信号
# （第一版只断言"找到并点击了发布按钮"，驱动器整个失败时也显示 PASS）
if ($pubText -match 'DEVICE_PUBLISH_DRIVE OK') { Ok '发布页驱动完成（切到文字模式 → 输入 → 点发布）' }
else { Bad '发布页驱动未完成（见上方输出）' }

Step '3. 服务端：这条帖子必须存在，且作者 == 会话身份（作者不是客户端给的）'
$check = Invoke-Ssh "export PGPASSWORD=`$(cat /srv/campus/.db_password); psql -h 127.0.0.1 -U campus -d campus -Atc `"select coalesce(author_id::text,'(null)') || '|' || author_name from posts where body = '$MARK'`""
$row = @($check | Where-Object { "$_" -match '\|' }) | Select-Object -Last 1
if ($row) {
  $parts = "$row".Trim().Split('|')
  $dbAuthorId = $parts[0]
  $dbAuthorName = $parts[1]
  Ok "帖子已写入 PG"
  # helper 拿到的 token 对应的用户 id：用 /api/auth/me 反查
  $meLines = Invoke-Ssh "curl -s -m 10 http://127.0.0.1/api/auth/me -H 'Authorization: Bearer $($session.Token)'"
  $meText = ($meLines | Out-String)
  if ($meText -match '"id":"([0-9a-f-]{36})"') {
    $meId = $Matches[1]
    if ($dbAuthorId -eq $meId) { Ok "author_id == 会话用户 id（服务端从 session 解析，客户端没传作者）" }
    else { Bad "author_id ($dbAuthorId) != 会话用户 id ($meId)" }
  } else { Bad "无法从 /api/auth/me 取到会话用户 id" }
  if ($dbAuthorName -eq $session.DisplayName) { Ok "author_name == 会话展示名（$dbAuthorName）" }
  else { Bad "author_name ('$dbAuthorName') != 会话展示名 ('$($session.DisplayName)')" }
} else {
  Bad "PG 里找不到这条帖子（MARK=$MARK）—— 发布可能没成功"
}

Step '4. UI 上：校园信息流里能看到这条新帖，且作者是登录身份'
$feed = (Run-Dev3 @('feed') | Out-String)
if ($feed -match [regex]::Escape($MARK)) { Ok '校园信息流里出现了新帖正文' }
else { Bad "校园信息流里没有新帖正文（MARK=$MARK）" }
if ($feed -match [regex]::Escape($session.DisplayName)) { Ok "信息流里的作者名是登录身份（$($session.DisplayName)）" }
else { Bad "信息流里找不到登录身份作者名" }

Step '5. App 重启后仍存在（会话与帖子的持久性）'
$null = Restart-DeviceApp
$feed2 = (Run-Dev3 @('feed') | Out-String)
if ($feed2 -match [regex]::Escape($MARK)) { Ok '重启 App 后新帖仍在（且会话未丢）' }
else { Bad '重启 App 后看不到新帖' }

Step '6. 清理（helper 不带副作用，清理由本脚本负责）'
$cleanup = Invoke-Ssh "export PGPASSWORD=`$(cat /srv/campus/.db_password); psql -h 127.0.0.1 -U campus -d campus -q -c `"delete from posts where body like 'M3SLICE3UIDEV%'`"; psql -h 127.0.0.1 -U campus -d campus -q -c `"delete from sessions where user_id in (select id from users where phone_e164 = '+86$($session.Phone)')`"; psql -h 127.0.0.1 -U campus -d campus -q -c `"delete from login_challenges where phone_e164 = '+86$($session.Phone)'`"; psql -h 127.0.0.1 -U campus -d campus -q -c `"delete from users where phone_e164 = '+86$($session.Phone)'`"; echo cleaned"
if (($cleanup | Out-String) -match 'cleaned') { Ok "测试帖子与账号 +86$($session.Phone) 已清理" } else { Bad '清理失败' }
Invoke-Ssh 'rm -f /run/campus/login-codes/*.json' | Out-Null

Write-Output ''
if ($script:Failed -eq 0) { Write-Output 'DEVICE_PUBLISH_RESULT PASS' } else { Write-Output 'DEVICE_PUBLISH_RESULT FAIL' }
exit $script:Failed
