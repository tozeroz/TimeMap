<#
  重新应用 DeepSeekEyes 的 automation-context 补丁。
  用途：@dttxorg/deepseekeyes 重新安装/升级后，node_modules 里的补丁会丢失，
        运行本脚本即可重新打上。

  背景（2026-09-12 排查结论）：
    插件 src/automation-context.js 的 messageGroups() 只把「assistant(tool-call) + 紧跟的
    第一条 tool-result」配成一组；当一条 assistant 消息并发多个 tool call 时（DSH 会为每个
    call 追加一条独立 result 消息），第 2 条及以后的 result 会各自成为独立分组。
    boundAutomationContext() 从尾部按「整组」裁剪上下文，如果裁剪边界正好落在这些分组上，
    保留下来的消息里就会出现「没有对应 tool_calls 的 tool 消息」，
    DeepSeek API 返回 400:
      Messages with role 'tool' must be a response to a preceding message with 'tool_calls'
    该轮直接以 error 结束 —— 表现为「对话异常停止」。

    补丁做了两件事：
      1) messageGroups() 吸收「回答本条 assistant 已声明 tool call」的全部连续 result 消息
         （以及其后的 trusted MCP 上下文消息），保证 call 与 results 原子化；
      2) boundAutomationContext() 增加结构兜底：若保留窗口最旧一组仍是没有对应 tool call 的
         孤立 result，直接丢弃该组，绝不让非法结构发出去。

  验证：
    node tools/ab-deepseekeyes-patch.mjs
    （扫描 2000~30000 全部预算档位：原始实现有 1 档产生非法结构，补丁版 0 档）
#>
param(
  [switch]$Restore,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$target = 'C:\Users\zjx230494186\.dsh\profiles\web\node_modules\@dttxorg\deepseekeyes\src\automation-context.js'
$patchDir = 'G:\demo map\patches'
$patched = Join-Path $patchDir 'automation-context.patched-0.8.2.js'
$original = Join-Path $patchDir 'automation-context.orig-0.8.2.js'

if (-not (Test-Path $target)) { throw "目标文件不存在：$target" }
$current = (Get-Item $target).Length

if ($Restore) {
  Write-Output "还原原始实现：$original -> $target"
  if (-not $WhatIf) { Copy-Item -LiteralPath $original -Destination $target -Force }
  Write-Output "done (原大小 9675 / 补丁版 12489)"
  exit 0
}

if (-not (Test-Path $patched)) { throw "补丁文件不存在：$patched" }

if ($current -eq 12489) {
  Write-Output "补丁已在位（大小 12489），无需重复应用。"
  exit 0
}
if ($current -ne 9675) {
  throw "当前文件大小 $current 与已知的 0.8.2 原版(9675)、补丁版(12489) 都不匹配；插件版本可能已变化，请先人工比对再打补丁。"
}

Write-Output "应用补丁：$patched -> $target"
if (-not $WhatIf) { Copy-Item -LiteralPath $patched -Destination $target -Force }
Write-Output "完成。**需要重启 dsh web 才会生效**（模块在进程启动时加载）。"
