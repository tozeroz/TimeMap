<#
  设备登录 helper（可复用）
  ==========================================================================
  审核记录 10 的工程要求：
    "不要整段复用 verify-device-login.ps1 来驱动 Slice 3，因为它本身包含 logout、
     cleanup 等 Slice 0B 验收副作用。更稳妥的是把其中『冷启动 → OTP 登录 →
     得到已登录设备状态』抽成一个可复用 helper，让 Slice 0B 和 Slice 3 各自调用；
     这样不会让两个 Gate 因测试流程互相耦合。"

  本文件只做"把设备弄成已登录状态"这一件事，**不带任何验收副作用**
  （不 logout、不清理账号、不断言业务语义）—— 那些留给各自的 Gate。

  用法（被其它脚本 dot-source）：
    . scripts/m3/device-login-helper.ps1
    $session = Connect-DeviceLoggedIn            # 返回 @{ Phone=...; Token=...; DisplayName=... }
    Disconnect-Device                            # 断开 CDP 转发（可选）

  单独执行时（-SelfTest）会跑一次自检：冷启动 → 登录 → 断言会话存在。
#>
param(
  [switch]$SelfTest,
  [string]$Adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe',
  [string]$Serial = '127.0.0.1:16384',
  [string]$Pkg = 'com.campusx.demo',
  [string]$SshKey = '',
  [string]$SshHost = 'root@8.148.156.146',
  [string]$SinkDir = '/run/campus/login-codes'
)

$script:HelperRepo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $SshKey) { $SshKey = Join-Path $script:HelperRepo 'TimeMap.pem' }

function Invoke-HelperAdb([string[]]$Arguments) {
  # adb 会把正常信息写 stderr；调用方的 ErrorActionPreference 可能是 Stop，
  # 所以这里必须临时放宽（踩过：monkey 的 "args: [...]" 把脚本打断）
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $Adb -s $Serial @Arguments 2>&1
    return ($out | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-HelperSsh([string]$RemoteShell) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($RemoteShell))
    $out = & ssh -i $SshKey -o BatchMode=yes $SshHost "echo '$b64' | base64 -d | bash" 2>&1
    return @($out | ForEach-Object { "$_" })
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Connect-DeviceCdp {
  Invoke-HelperAdb @('forward', '--remove-all') | Out-Null
  $webviewPid = (Invoke-HelperAdb @('shell', 'pidof', $Pkg)).Trim()
  if (-not $webviewPid) {
    # App 没在跑就**自己把它拉起来**，而不是直接抛错。
    # 为什么：调用方（各 Gate / 验证脚本）关心的只是"设备处于可用状态"，
    # 而不该被迫先记得去启动 App。此前 helper 在这里直接 throw，
    # 结果"App 没起来"被报成"helper 坏了"，白排查一轮（真事）。
    Say-HelperInfo "App 未运行 → 先启动它"
    Invoke-HelperAdb @('shell', 'monkey', '-p', $Pkg, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Seconds 1
      $webviewPid = (Invoke-HelperAdb @('shell', 'pidof', $Pkg)).Trim()
      if ($webviewPid) { break }
    }
  }
  if (-not $webviewPid) { throw "启动后仍找不到 $Pkg 的进程（App 是否已安装？）" }
  Invoke-HelperAdb @('forward', 'tcp:9222', "localabstract:webview_devtools_remote_$webviewPid") | Out-Null
  return $webviewPid
}

<# helper 自己的一行提示（避免依赖调用方定义的 Say，保持 helper 可独立使用） #>
function Say-HelperInfo([string]$msg) { Write-Output "  [helper] $msg" }

<# 冷启动：force-stop + 重启 + 重连 CDP。返回 WebView pid。#>
function Restart-DeviceApp {
  Invoke-HelperAdb @('shell', 'am', 'force-stop', $Pkg) | Out-Null
  Start-Sleep -Seconds 2
  Invoke-HelperAdb @('shell', 'monkey', '-p', $Pkg, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
  Start-Sleep -Seconds 7
  return (Connect-DeviceCdp)
}

function Run-HelperNode([string[]]$NodeArgs) {
  $out = & node (Join-Path $script:HelperRepo 'scripts\m3\device-login-e2e.mjs') @NodeArgs 2>&1
  return (($out | Out-String).TrimEnd())
}

<#
  运维取码：读 dev sink（不经日志）。
  两个坑：用 `sudo -u campus`（campus 的 shell 是 nologin，su - 会失败）；
  命令走 base64 传输（直接拼 ssh 命令行时引号会被三层解析吃掉，返回空）。
#>
function Get-LoginCodeFromSink {
  $lines = Invoke-HelperSsh "LOGIN_CODE_SINK=$SinkDir sudo -u campus /opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/admin.mjs latest-code"
  $text = ($lines | Out-String)
  if ($text -match 'code=(\d{6})') { return $Matches[1] }
  throw "未能从 dev sink 取到验证码（输出: $($text.Trim())）"
}

<#
  把设备弄成"已登录"状态。**只做登录，不做验收**。
  返回 @{ Phone; Token; DisplayName; WebViewPid }。
  每个用例用**随机手机号**：服务端对「请求验证码」按 (IP, 手机号) 限流 5 次/300s，
  反复用同一号码会在第 6 次被 429（App 行为正确，但测试会莫名其妙失败）。
#>
function Connect-DeviceLoggedIn {
  $phone = "138$(Get-Random -Minimum 10000000 -Maximum 99999999)"
  $webviewPid = Connect-DeviceCdp

  # 1) 冷启动 + 清空本地存储（**一个步骤里做完并当场校验**）
  #    为什么不再用「清空 → force-stop → 重启 → 再查」：那两步会互相掩护 ——
  #    清空后立刻杀进程，Chromium 来不及落盘，重启后旧会话又回来；
  #    而"再查"若连到重启前的旧调试目标，反而读到"已清空"，把问题掩盖成通过。
  #    coldreset 模式：清空 → 等落盘 → 页面 reload → 重连 → 当场断言为空。
  $coldOut = Run-HelperNode @('coldreset')
  if ($coldOut -notmatch 'DEVICE_LOGIN_COLDRESET OK') {
    throw "冷启动（无会话前提）失败：`n$coldOut"
  }
  # 重新转发 CDP（reload 后页面目标可能变化）
  $webviewPid = Connect-DeviceCdp

  # 2) 走真实 UI：个人页入口 → 协议弹窗 → 手机号页 → 请求验证码
  $prep = Run-HelperNode @('prepare', '--phone', $phone)
  if ($prep -notmatch 'DEVICE_LOGIN_PREPARE OK') { throw "登录前置失败：`n$prep" }

  # 3) 运维从 dev sink 取本次随机码 → UI 输入 → 登录
  $code = Get-LoginCodeFromSink
  $done = Run-HelperNode @('complete', '--phone', $phone, '--code', $code)
  if ($done -notmatch 'DEVICE_LOGIN_COMPLETE OK') { throw "登录失败：`n$done" }

  # 4) 读回会话，交给调用方。
  #    解析纪律：Node 在 Windows 上退出时可能往 stderr 打无关噪声
  #    （例如 WebSocket 未关闭的 assertion），而 $out 是 2>&1 合并过的。
  #    所以这里**只挑出真正像 JSON 的那一行**，绝不把整段输出硬塞进 ConvertFrom-Json
  #    （否则噪声会变成"解析失败"，看起来像登录失败 —— 第一版就是这样误报的）。
  $sessionJson = $null
  foreach ($line in (Run-HelperNode @('session') -split "`r?`n")) {
    $t = $line.Trim()
    if ($t.StartsWith('{') -and $t.EndsWith('}')) { $sessionJson = $t }
  }
  if (-not $sessionJson) { throw '登录后未能读到会话（输出里没有像 JSON 的行）' }
  $session = $sessionJson | ConvertFrom-Json
  if (-not $session.Token) {
    throw "登录后未能读到会话 token（输出: $sessionJson）"
  }

  return [pscustomobject]@{
    Phone       = $phone
    Token       = $session.Token
    DisplayName = $session.DisplayName
    WebViewPid  = $webviewPid
  }
}

<# 清掉 helper 建立的转发（不删账号、不退出登录 —— 那是各自 Gate 的事） #>
function Disconnect-Device {
  Invoke-HelperAdb @('forward', '--remove-all') | Out-Null
}

<#
  把设备重置成"未登录"状态（Web 应用冷启动 + 无会话）。
  给所有需要"无 session 前提"的流程复用 —— Slice 0B 的登录 E2E 与 Slice 3 都用它。

  为什么必须有这一步：旧写法是「CDP 清空存储 → 立刻 adb force-stop → 重启」，有两个
  互相掩护的问题：
    1) 清空后立刻杀进程，Chromium 来不及落盘 → 重启后旧会话又回来了（prepare 报"本地仍存在会话"）；
    2) "重启后再查"若连到重启前的旧调试目标，会读到"已清空"，把问题掩盖成通过。
  现在统一走 coldreset 模式：清空 → 等落盘 → 页面 reload → 重连 → **当场断言为空**。
#>
function Reset-DeviceToLoggedOut {
  $null = Connect-DeviceCdp
  $out = Run-HelperNode @('coldreset')
  if ($out -notmatch 'DEVICE_LOGIN_COLDRESET OK') {
    throw "冷启动（无会话前提）失败：`n$out"
  }
  # reload 之后页面目标可能变化，重新转发一次
  return (Connect-DeviceCdp)
}

if ($SelfTest) {
  Write-Output '=== helper 自检：冷启动 → OTP 登录 → 已登录状态 ==='
  $s = Connect-DeviceLoggedIn
  Write-Output "  phone=$($s.Phone)  displayName=$($s.DisplayName)  token 长度=$($s.Token.Length)"
  if ($s.Token.Length -gt 20) { Write-Output 'HELPER_SELFTEST PASS' } else { Write-Output 'HELPER_SELFTEST FAIL'; exit 1 }
  Disconnect-Device
}
