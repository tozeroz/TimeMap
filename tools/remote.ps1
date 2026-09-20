<#
  在远程服务器上执行 bash 脚本。

  为什么需要它：从 PowerShell 直接把带引号/管道的命令塞给 ssh，
  内层引号会被 PowerShell 的原生参数处理吃掉（踩过两次）。
  这里改成把脚本 base64 编码后经 stdin 送给远端 bash，彻底绕开引号问题。

  用法（在 G:\demo map 下）：
    & '.\tools\remote.ps1' -Command 'uname -a'
    & '.\tools\remote.ps1' -ScriptFile 'tools\remote\provision.sh'
    Get-Content tools\remote\x.sh -Raw | & '.\tools\remote.ps1' -Stdin

  连接信息（可用参数覆盖）：
    私钥 G:\demo map\TimeMap.pem   目标 root@8.148.156.146
#>
param(
  [string]$Command,
  [string]$ScriptFile,
  [switch]$Stdin,
  [string]$Key = '',
  [string]$Target = 'root@8.148.156.146',
  [int]$TimeoutSec = 20
)

$ErrorActionPreference = 'Continue'

if (-not $Key) {
  $Key = Join-Path (Split-Path $PSScriptRoot -Parent) 'TimeMap.pem'
}
if (-not (Test-Path -LiteralPath $Key)) {
  Write-Error "私钥不存在: $Key"
  exit 2
}

# 组装要执行的脚本正文（按**字节**处理，避免 PS 5.1 默认 ANSI 解码把 UTF-8 中文读坏，
# 那会连带破坏脚本结构 —— 已经踩过一次：中文 log 串被截断，后面几行代码被当成文本打印而不是执行）
if ($Stdin) {
  $bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
} elseif ($ScriptFile) {
  if (-not (Test-Path -LiteralPath $ScriptFile)) { Write-Error "脚本不存在: $ScriptFile"; exit 2 }
  $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ScriptFile).Path)
} elseif ($Command) {
  $bytes = [Text.Encoding]::UTF8.GetBytes("$Command")
} else {
  Write-Error '需要 -Command / -ScriptFile / -Stdin 之一'
  exit 2
}

# base64 传输：远端正则解码后交给 bash
$b64 = [Convert]::ToBase64String($bytes)
$remote = "echo '$b64' | base64 -d | bash"

& ssh -i $Key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=$TimeoutSec -o BatchMode=yes $Target $remote
exit $LASTEXITCODE
