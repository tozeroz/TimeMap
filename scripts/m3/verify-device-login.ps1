<#
  M3 Slice 0B 设备端登录 E2E 编排（**全程不注入 session 夹具**）
  ==========================================================================
  审核记录 08 要求：Slice 0B 主路径不得用 injected session fixture，
  Gate 至少要证明一次完整闭环：

     App 冷启动 → 无 session → 登录入口页 → 协议弹窗行为 → 手机号页 → 请求验证码
     → 运维从 dev sink 取本次随机 code → UI 输入 → 服务端消费 challenge → 签发 session
     → /api/auth/me 身份正确 → 重启 App 会话仍有效 → logout → 旧 token 401

  本脚本负责"设备生命周期"（真正的进程重启），node 脚本负责"UI 驱动与断言"。
  这样分工的原因：本脚本第一版让 node 自己做 location.reload() 当冷启动，
  结果 reload 后连到的调试目标还不能执行脚本，读取全部超时 —— 见 device-login-e2e.mjs 注释。

  用法：powershell -File scripts/m3/verify-device-login.ps1 [-Phone 13800000001]
#>
param(
  [string]$Phone = '',
  [string]$Adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe',
  [string]$Serial = '127.0.0.1:16384',
  [string]$Pkg = 'com.campusx.demo',
  [string]$SshKey = '',
  [string]$SshHost = 'root@8.148.156.146'
)

<#
  号码默认**每次运行随机生成**。
  为什么：服务端对「请求验证码」按 (IP, 手机号) 做滑动窗口限流（LOGIN_REQUEST_MAX=5/300s）。
  反复用同一个号码跑 E2E 会在第 6 次拿到 429 —— App 的行为是对的（会提示"请求太频繁"），
  但测试就会莫名其妙失败。这正是这个脚本此前"时好时坏"的原因。
  随机号码同时顺带覆盖"登录即注册"这条路径；结束时会把测试账号清理掉。
  格式：138 + 8 位随机数字（满足 ^1[3-9]\d{9}$，且明显是编造号段）。
#>
if (-not $Phone) {
  $Phone = "138$(Get-Random -Minimum 10000000 -Maximum 99999999)"
}

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $SshKey) { $SshKey = Join-Path $repo 'TimeMap.pem' }

$script:Failed = 0
function Ok([string]$m) { Write-Output "PASS $m" }
function Bad([string]$m) { Write-Output "FAIL $m"; $script:Failed = 1 }
function Step([string]$m) { Write-Output ''; Write-Output "=== $m ===" }

function Invoke-Adb([string[]]$Arguments) {
  # adb 会把一些正常信息（例如 monkey 的 "args: [...]"）写到 stderr，
  # 而本脚本设了 $ErrorActionPreference='Stop' —— 那会把这类正常输出当成终止错误。
  # 所以这里临时放宽，只取文本，不因 stderr 中断。
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Adb -s $Serial @Arguments 2>&1
    return ($out | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Forward-Cdp {
  Invoke-Adb @('forward', '--remove-all') | Out-Null
  $webviewPid = (Invoke-Adb @('shell', 'pidof', $Pkg)).Trim()
  if (-not $webviewPid) { throw "找不到 $Pkg 的进程（App 没起来？）" }
  Invoke-Adb @('forward', 'tcp:9222', "localabstract:webview_devtools_remote_$webviewPid") | Out-Null
  return $webviewPid
}

function ColdRestart {
  Invoke-Adb @('shell', 'am', 'force-stop', $Pkg) | Out-Null
  Start-Sleep -Seconds 2
  Invoke-Adb @('shell', 'monkey', '-p', $Pkg, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
  Start-Sleep -Seconds 6
  return (Forward-Cdp)
}

function Run-Node([string[]]$NodeArgs) {
  # 注意：函数里同时 Write-Output 和 return 会让输出重复（PowerShell 的返回就是输出流），
  # 所以这里只 return，由调用方决定是否打印。
  $out = & node (Join-Path $repo 'scripts\m3\device-login-e2e.mjs') @NodeArgs 2>&1
  return (($out | Out-String).TrimEnd())
}

function Get-LoginCode([string]$phone) {
  # 运维取码：读 dev sink（不经日志）。这是整个流程里唯一必须由运维替身完成的动作
  # —— 因为本 demo 没有短信通道（SMS_GATEWAY_NOT_INTEGRATED）。
  #
  # 两个踩过的坑：
  #  1) 用 `sudo -u campus ...`，**不是** `su - campus -c` ——
  #     campus 账号的 shell 是 nologin（有意的加固），su - 会因"账号不可用"直接失败。
  #  2) **不要**把带引号的命令直接拼进 ssh 的命令行：经 PowerShell → ssh → 远端 shell
  #     三层解析后引号会被吃掉，ssh 会**静默返回空输出**。统一走 base64 传输。
  $remoteScript = @'
LOGIN_CODE_SINK=/run/campus/login-codes sudo -u campus /opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/admin.mjs latest-code
'@
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
  $out = & ssh -i $SshKey -o BatchMode=yes $SshHost "echo '$b64' | base64 -d | bash" 2>&1
  $text = ($out | Out-String)
  if ($text -match 'code=(\d{6})') { return $Matches[1] }
  Write-Output "  (取码命令输出: '$($text.Trim())')"
  return ''
}

# ---------------------------------------------------------------------------
Step '前置检查'
$ready = (Invoke-Adb @('shell', 'getprop', 'sys.boot_completed')).Trim()
if ($ready -ne '1') { Bad '模拟器未就绪'; exit 1 }
Ok '模拟器已就绪'
$installed = Invoke-Adb @('shell', 'pm', 'list', 'packages', $Pkg)
if ($installed -notmatch [regex]::Escape($Pkg)) { Bad "未安装 $Pkg"; exit 1 }
Ok "$Pkg 已安装"

Step 'A. 清空本地存储并真正冷启动（无 session 前提）'
$webviewPid = Forward-Cdp
Ok "已转发 CDP 端口（WebView pid=$webviewPid）"
$null = Run-Node @('reset')
if ($LASTEXITCODE -ne 0) { Bad 'reset 失败' }
$webviewPid = ColdRestart
Ok "已 force-stop + 重启（WebView pid=$webviewPid）"

Step 'B. 登录入口页 → 协议弹窗 → 手机号页 → 请求验证码'
$prepareOut = Run-Node @('prepare', '--phone', $Phone)
if ($prepareOut -match 'DEVICE_LOGIN_PREPARE OK') { Ok 'prepare 阶段通过' } else { Bad 'prepare 阶段失败' }

Step 'C. 运维从 dev sink 取本次随机验证码'
$code = Get-LoginCode $Phone
if ($code -match '^\d{6}$') { Ok "已从 dev sink 取到 6 位验证码（长度 6，内容不打印）" }
else { Bad '未能从 dev sink 取到验证码' }

Step 'D. 输入验证码 → 登录 → 服务端身份'
if ($code) {
  $completeOut = Run-Node @('complete', '--phone', $Phone, '--code', $code)
  if ($completeOut -match 'DEVICE_LOGIN_COMPLETE OK') { Ok 'complete 阶段通过（会话已签发）' }
  else { Bad 'complete 阶段失败' }
} else {
  Bad '没有验证码，无法继续'
}

Step 'E. 重启 App：会话必须仍然有效'
$webviewPid = ColdRestart
Ok "已再次冷启动（WebView pid=$webviewPid）"
$restartOut = Run-Node @('restart')
if ($restartOut -match 'DEVICE_LOGIN_RESTART OK') { Ok '重启后会话仍有效' } else { Bad '重启后会话失效' }

Step 'F. 真实点击「退出登录」→ 旧 token 必须失效'
$logoutOut = Run-Node @('logout')
if ($logoutOut -match 'DEVICE_LOGIN_LOGOUT OK') { Ok '退出登录通过（服务端撤销 + 本地清空 + 旧 token 401）' }
else { Bad '退出登录失败' }

Step 'G. 清理本次测试账号'
$cleanup = @"
set -uo pipefail
export PGPASSWORD="`$(cat /srv/campus/.db_password)"
psql -h 127.0.0.1 -U campus -d campus -q -c "delete from sessions where user_id in (select id from users where phone_e164='+86$Phone')"
psql -h 127.0.0.1 -U campus -d campus -q -c "delete from login_challenges where phone_e164='+86$Phone'"
psql -h 127.0.0.1 -U campus -d campus -q -c "delete from users where phone_e164='+86$Phone'"
echo cleaned
"@
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cleanup))
$cl = (& ssh -i $SshKey -o BatchMode=yes $SshHost "echo '$b' | base64 -d | bash" 2>&1 | Out-String).Trim()
if ($cl -match 'cleaned') { Ok "测试账号 +86$Phone 已清理（含会话与挑战）" } else { Bad "清理失败: $cl" }

Write-Output ''
if ($script:Failed -eq 0) { Write-Output 'DEVICE_LOGIN_E2E_RESULT PASS' } else { Write-Output 'DEVICE_LOGIN_E2E_RESULT FAIL' }
exit $script:Failed
