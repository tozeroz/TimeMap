<#
  把一个本地 .sh 脚本**原样**送到远端执行（ssh + base64）。
  =========================================================================
  为什么要套一层 base64：
    直接 `ssh root@host "bash -s" < file` 或把脚本文本拼进 ssh 命令行时，
    引号会被 PowerShell → ssh → bash 三层解析吃掉，结果是"脚本跑了但参数/引号全错"
    （本项目踩过：Gate 因此把通过判成失败）。base64 之后内容原样到达，不经第二次解析。

  用法：
    & scripts/m5/run-remote-script.ps1 -Path scripts/m5/cleanup-native-picker-residue.sh
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$SshKey = '',
  [string]$SshHost = 'root@8.148.156.146'
)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $SshKey) { $SshKey = Join-Path $repo 'TimeMap.pem' }
if (-not (Test-Path $Path)) { Write-Output "REMOTE_RUN_FAIL 找不到脚本：$Path"; exit 1 }
$full = (Resolve-Path $Path).Path
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
# 注意：base64 要按**字节**做（.sh 里可能有非 ASCII 注释）
$bytes = [System.IO.File]::ReadAllBytes($full)
$b64 = [Convert]::ToBase64String($bytes)
$out = & ssh -i $SshKey -o BatchMode=yes $SshHost "echo '$b64' | base64 -d | bash" 2>&1
$ErrorActionPreference = $prev
$out | ForEach-Object { "$_" }
