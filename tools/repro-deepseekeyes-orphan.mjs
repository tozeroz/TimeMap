// 复现 DeepSeekEyes 上下文裁剪是否会产生「孤儿 tool-result」。
//
// dsh 中消息形状：
//   assistant(tool-call...)  →  user(tool-result...)   （tool result 挂在 user 消息上）
// 一条 assistant 消息可以并发多个 tool call，于是产生「1 个 assistant + N 条 result」。
//
// automation-context.js 的 messageGroups() 只把「assistant + 紧跟的第一条 result」配成一组，
// 第 2 条及以后的 result 会成为独立组。boundAutomationContext() 从尾部往前整组保留，
// 若裁剪边界落在孤儿组上，保留结果里就出现「无对应 tool_calls 的 tool 消息」，
// DeepSeek 返回 400: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'
//
// 用法：node tools/repro-deepseekeyes-orphan.mjs

const MODULE = 'C:/Users/zjx230494186/.dsh/profiles/web/node_modules/@dttxorg/deepseekeyes/src/automation-context.js'
const { boundAutomationContext } = await import(`file:///${MODULE}`)

const big = (t) => [{ type: 'text', text: t.repeat(300) }]
const toolCall = (id, name) => ({ type: 'tool-call', id, name, arguments: '{}' })
const toolResult = (id, name, content) => ({ type: 'tool-result', toolCallId: id, toolName: name, content })
const TIME_CTX = { kind: 'plugin', plugin: 'time-context', form: 'snapshot', sections: [] }
const userText = (t, source = { kind: 'user' }) => ({ role: 'user', source, content: [{ type: 'text', text: t }] })
const assistant = (blocks) => ({ role: 'assistant', source: { kind: 'model' }, content: blocks })

/** 检查：每条 tool-result 之前，最近一条含 tool-call 的 assistant 是否声明了它的 id */
function findOrphan(messages) {
  let declared = new Set()
  let sawAssistantWithCalls = false
  for (let i = 0; i < messages.length; i++) {
    const blocks = messages[i].content ?? []
    const calls = blocks.filter((b) => b.type === 'tool-call')
    if (messages[i].role === 'assistant') {
      declared = new Set(calls.map((c) => c.id))
      sawAssistantWithCalls = calls.length > 0
      continue
    }
    for (const b of blocks) {
      if (b.type !== 'tool-result') continue
      if (!sawAssistantWithCalls || !declared.has(b.toolCallId)) {
        // 注意：tool-result 是挂在 user 消息上的，不会重置 declared
        return { toolCallId: b.toolCallId, index: i }
      }
    }
  }
  return null
}

function buildMessages({ multiCall }) {
  const m = []
  m.push(userText('请把这个 app 复刻出来')) // 直接用户任务（plugin 需要它来定位 task）
  m.push(userText('Time sampled while preparing turn 12, step 1', TIME_CTX))

  // 关键步骤：并发多个 MCP tool call
  if (multiCall) {
    m.push(assistant([
      toolCall('call_A', 'mcp__playwright__browser_navigate'),
      toolCall('call_B', 'mcp__playwright__browser_snapshot'),
      toolCall('call_C', 'mcp__playwright__browser_resize'),
    ]))
    m.push({ role: 'user', content: [toolResult('call_A', 'mcp__playwright__browser_navigate', big('A '))] })
    m.push({ role: 'user', content: [toolResult('call_B', 'mcp__playwright__browser_snapshot', big('B '))] })
    m.push({ role: 'user', content: [toolResult('call_C', 'mcp__playwright__browser_resize', big('C '))] })
  } else {
    m.push(assistant([toolCall('call_A', 'mcp__playwright__browser_navigate')]))
    m.push({ role: 'user', content: [toolResult('call_A', 'mcp__playwright__browser_navigate', big('A '))] })
  }

  // 后续合法历史：每步都是 1 call + 1 result
  for (let i = 0; i < 14; i++) {
    m.push(userText(`Time sampled step ${i}`, TIME_CTX))
    m.push(assistant([toolCall(`c${i}`, 'mcp__x__y')]))
    m.push({ role: 'user', content: [toolResult(`c${i}`, 'mcp__x__y', big(`old ${i} `))] })
  }

  // 最后一步：一次单 call（模拟出事的最后一步）
  m.push(userText('Time sampled final step', TIME_CTX))
  m.push(assistant([toolCall('last', 'mcp__playwright__browser_navigate')]))
  m.push({ role: 'user', content: [toolResult('last', 'mcp__playwright__browser_navigate', big('last '))] })
  return m
}

for (const multiCall of [false, true]) {
  console.log(`\n########## 上游某步是否并发多 tool call: ${multiCall ? '是' : '否'} ##########`)
  const messages = buildMessages({ multiCall })
  const baseOrphan = findOrphan(messages)
  console.log(`输入自检: ${baseOrphan ? '❌ 输入本身就有孤儿 ' + baseOrphan.toolCallId : '✅ 输入合法'}（消息数 ${messages.length}）`)

  const options = { messages, system: 'S'.repeat(200), tools: [] }
  for (const budget of [30000, 12000, 8000, 6000, 5000, 4000, 3000, 2500]) {
    const b = boundAutomationContext(options, budget)
    const orphan = findOrphan(b.options.messages)
    console.log(
      `budget=${String(budget).padStart(6)} changed=${b.changed ? 'yes' : 'no '} 保留=${String(b.options.messages.length).padStart(3)} 条  ` +
      (orphan ? `❌ 死局：孤儿 tool-result ${orphan.toolCallId}（保留后第 ${orphan.index} 条）` : '✅ 结构合法'),
    )
  }
}
