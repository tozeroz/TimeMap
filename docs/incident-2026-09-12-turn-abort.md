# 事故报告：对话「异常停止」根因与修复（2026-09-12）

## 一、结论先行

**「异常停止」不是网络抖动，也不是模型偶然抽风，而是 DeepSeekEyes 插件的上下文裁剪
在特定边界上会发出非法消息结构，被 DeepSeek API 判 400，导致整轮 turn 以 error 结束。**

- 触发条件：**同一轮里曾出现过「一条 assistant 消息并发多个 tool call」**（本会话里很常见，
  例如一次发两个 `write`、`edit`+`pwsh`、`vision`+`vision`），且 DeepSeekEyes 的
  上下文裁剪边界**恰好落在**由此产生的「孤儿 tool-result」分组上。
- 报错原文：
  `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`（HTTP 400）
- 发生时间点：
  - turn 11 step 61（2026-09-12 00:57:14）
  - turn 12 step 66（2026-09-12 01:18:07）

## 二、怎么定位到的

### 1. 从会话日志读到 turn 结束原因是 error

DSH 把每个 turn 的结束原因写进会话日志（`$DSH_SESSION_JSONL`，多帧拼接 zstd）。
解码后（`tools/inspect-session.mjs`）看到：

```
{"type":"turn/end","seq":100852,"data":{"turn":11,"reason":{"kind":"error",
  "error":{"message":"Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
           "code":"INVALID_REQUEST","status":400}}}}
{"type":"turn/end","seq":129008,"data":{"turn":12,"reason":{"kind":"error", ... 同一条错误 ...}}}
```

两次都是**同一个 400**，都在「刚执行完一个 MCP（Playwright）工具之后的那一步」。

### 2. 排除法：消息历史本身是合法的

导出的 `assistant/message` 事件里，tool-call 块带有完整 id：

```json
{"type":"tool-call","id":"call_00_7FaYK1LeR7HWGIwWGegO0914",
 "name":"mcp__playwright__browser_navigate","arguments":"{...}"}
```

对应 `tool/result` 的 callId 也匹配。**durable 历史没问题**，所以问题出在「发给模型的副本」。
而 DeepSeekEyes 正是只改写模型副本的那一层（README 明确写「只裁剪模型副本，保留完整 DSH 任务和证据」）。

### 3. 插件自带的计数器给出了直接线索

`~/.dsh/deepseekeyes/usage-stats.json`：

```json
"automationTurns": 4,
"automationContextCompactions": 9,   // 自动化轮次裁剪次数
"mcpContextCompactions": 6,          // 其中 MCP 轮次裁剪次数
"automationMaxCallsPerTurn": 32,
"estimatedAutomationInputTokensSaved": 1401708
```

即：**裁剪确实发生过 9 次**，而两次崩溃都紧跟在 MCP 轮之后。

### 4. 读代码定位到具体缺陷

`@dttxorg/deepseekeyes@0.8.2` 的 `src/automation-context.js`：

```js
// 原始实现（有缺陷）
if (messageHasToolCall(messages[index])
  && index + 1 < messages.length
  && messageHasToolResult(messages[index + 1])) {
  const group = [messages[index], messages[index + 1]]   // ← 只配第一条 result
  let cursor = index + 2
  while (cursor < messages.length && isMcpContextMessage(messages[cursor])) { ... }
```

DSH 的消息形状是：

```
assistant( tool-call A, tool-call B, tool-call C )   ← 一条消息并发 3 个 call
user( tool-result A )
user( tool-result B )      ← 成为独立分组（孤儿）
user( tool-result C )      ← 成为独立分组（孤儿）
```

`boundAutomationContext()` 从尾部往前**按整组**保留，一旦裁剪边界落在这两个孤儿分组上，
保留下来的消息里就有「tool-result 但前面没有声明它的 tool_calls」→ 400。

### 5. 复现（证据）

`tools/repro-deepseekeyes-orphan.mjs` —— 构造包含「一条 assistant 并发 3 个 tool call」的消息序列，
直接调用插件导出的 `boundAutomationContext()`，检查输出里是否存在孤儿 tool-result：

```
########## 上游某步是否并发多 tool call: 是 ##########
输入自检: ✅ 输入合法（消息数 51）
budget= 8000 changed=yes 保留= 49 条  ❌ 死局：孤儿 tool-result call_B
```

`tools/ab-deepseekeyes-patch.mjs` —— 对 2000~30000 的全部预算档位扫描（步长 200，共 141 档）：

```
原始实现：非法 1 档 / 141
   ❌ budget=7600 → 孤儿 call_B（保留 46 条）
补丁版  ：非法 0 档 / 141
```

**结论**：这是一个窄边界的确定性缺陷（141 档里 1 档），所以只在长时间运行中偶发；
一旦命中，整轮直接失败，表现为「对话突然停下」。

## 三、做了什么修复

### 修复 1（已生效，无需重启）：把裁剪关掉

`~/.dsh/settings.yaml`：

```yaml
deepseekeyes:
  automationContextMaxTokens: 0     # 0 = 不限制，插件不再改写模型侧消息列表
```

`automationContextMaxTokens: 0` 走的是 `if (maximumTokens === 0 ...) return { changed: false }`
这条早退路径，**根本不进入裁剪逻辑**，因此结构风险归零。设置是热加载的，改完立即生效。
代价：自动化轮次不再省 token（该项此前累计省了约 140 万 input token）。

### 修复 2（需要重启 dsh web 生效）：修掉插件缺陷

补丁文件：`patches/automation-context.patched-0.8.2.js`（原版：`patches/automation-context.orig-0.8.2.js`）

两处改动：

1. **`messageGroups()` 吸收全部配对 result**——不再只吃紧跟的第一条，而是把所有
   「回答本条 assistant 已声明 tool call」的连续 result 消息一并纳入同一组，
   并继续吸收其后的 trusted MCP 上下文消息。call 与 results 从此原子化。
2. **`boundAutomationContext()` 增加结构兜底**——保留窗口最旧的一组若仍是「只有结果、
   没有对应 tool call」的孤立结果，直接丢弃该组（宁可少一段旧结果，也不能发出非法请求）。

重新打补丁（插件重装后需要）：

```powershell
& 'G:\demo map\tools\reapply-deepseekeyes-patch.ps1'          # 应用
& 'G:\demo map\tools\reapply-deepseekeyes-patch.ps1' -Restore # 还原
```

脚本带版本守卫：当前文件大小既不是 0.8.2 原版(9675) 也不是补丁版(12489) 时会拒绝操作，
避免把补丁糊到不兼容的新版本上。

### 修复 3：让无人监管真正能跑起来

排查中发现第二个独立原因：**本会话的 goal 处于 `disarmed` 状态**（`roundsStarted: 0`）。
goal 被 disarm 后不会自动续跑，即使没有 400，一轮做完也会停下等人输入
（DSH 在会话 resume/fork 后会 disarm 活动 goal）。已用 `update_goal action resume` 重新武装。

## 四、验证清单

| 项 | 结果 |
|---|---|
| 会话日志里两次 turn 结束原因 | ✅ 均为同一个 400，已定位 |
| durable 消息历史结构 | ✅ 合法（tool-call 带完整 id，result 匹配） |
| 触发器（并发 tool call）在崩溃前确实出现 | ✅ turn 11 步 49–59、turn 12 步 39–60 均为 ×2 |
| 缺陷可复现 | ✅ `tools/repro-deepseekeyes-orphan.mjs` |
| 补丁有效 | ✅ A/B 141 档扫描：原版 1 档非法 → 补丁版 0 档 |
| 止血设置已生效 | ✅ 设置热加载，无需重启 |
| goal 已重新武装 | ✅ `activation: armed` |

## 五、遗留与注意

1. **补丁需要重启 `dsh web` 才生效**（模块在进程启动时加载）。在重启之前，
   靠 `automationContextMaxTokens: 0` 兜底，行为已经安全，只是 token 花得更多。
2. 重启并确认补丁生效后，可以把 `automationContextMaxTokens` 改回 `32768` 恢复省 token；
   若之后再次出现同样的 400，第一动作是把它改回 `0`。
3. 插件升级/重装会覆盖 `node_modules` 里的补丁——重跑 `tools/reapply-deepseekeyes-patch.ps1`。
4. `node_modules/.../src/automation-context.orig.js` 是排查时留下的对照副本（当前沙箱不允许
   删除 `.dsh` 数据根目录内的文件），它不被任何代码引用，无副作用。
5. 同类风险在 Desktop/Browser 自动化轮次共用同一函数，补丁一并覆盖。

## 六、附带发现（不致命，但会拖慢无人监管）

- `session_search` 工具本次超时一次（30s）。不影响 turn，但会浪费一步。
- `dsh-reconnect` 的重试对这类 400 无效：它重发的是**同一份非法 payload**，
  所以重试 1 次后仍然失败。这类错误必须在构造 payload 的环节修，而不是靠重试。
