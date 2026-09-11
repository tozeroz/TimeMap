// A/B 对比：原始版 vs 打过补丁的 automation-context.js
// 证明「并发多 tool call」场景下，原实现会产生非法消息结构，补丁版不会。
const DIR = 'C:/Users/zjx230494186/.dsh/profiles/web/node_modules/@dttxorg/deepseekeyes/src'
const orig = await import(`file:///${DIR}/automation-context.orig.js`)
const fixed = await import(`file:///${DIR}/automation-context.js`)

const big = (t) => [{ type: 'text', text: t.repeat(300) }]
const toolCall = (id, name) => ({ type: 'tool-call', id, name, arguments: '{}' })
const toolResult = (id, name, content) => ({ type: 'tool-result', toolCallId: id, toolName: name, content })
const TIME_CTX = { kind: 'plugin', plugin: 'time-context', form: 'snapshot', sections: [] }
const userText = (t, source = { kind: 'user' }) => ({ role: 'user', source, content: [{ type: 'text', text: t }] })
const assistant = (blocks) => ({ role: 'assistant', source: { kind: 'model' }, content: blocks })

function findOrphan(messages) {
  let declared = new Set()
  let sawCalls = false
  for (let i = 0; i < messages.length; i++) {
    const blocks = messages[i].content ?? []
    if (messages[i].role === 'assistant') {
      const calls = blocks.filter((b) => b.type === 'tool-call')
      declared = new Set(calls.map((c) => c.id))
      sawCalls = calls.length > 0
      continue
    }
    for (const b of blocks) {
      if (b.type === 'tool-result' && (!sawCalls || !declared.has(b.toolCallId))) return b.toolCallId
    }
  }
  return null
}

function build() {
  const m = [userText('请复刻这个 app'), userText('Time sampled step 1', TIME_CTX)]
  // 一条 assistant 并发 3 个 MCP tool call
  m.push(assistant([
    toolCall('call_A', 'mcp__playwright__browser_navigate'),
    toolCall('call_B', 'mcp__playwright__browser_snapshot'),
    toolCall('call_C', 'mcp__playwright__browser_resize'),
  ]))
  m.push({ role: 'user', content: [toolResult('call_A', 'mcp__playwright__browser_navigate', big('A '))] })
  m.push({ role: 'user', content: [toolResult('call_B', 'mcp__playwright__browser_snapshot', big('B '))] })
  m.push({ role: 'user', content: [toolResult('call_C', 'mcp__playwright__browser_resize', big('C '))] })
  for (let i = 0; i < 14; i++) {
    m.push(userText(`Time sampled step ${i + 2}`, TIME_CTX))
    m.push(assistant([toolCall(`c${i}`, 'mcp__x__y')]))
    m.push({ role: 'user', content: [toolResult(`c${i}`, 'mcp__x__y', big(`old ${i} `))] })
  }
  return m
}

const messages = build()
const options = { messages, system: 'S'.repeat(200), tools: [] }

// 扫描整个预算区间，统计两种实现各产生多少次「非法结构」
let badOrig = 0
let badFixed = 0
const origBad = []
const fixedBad = []
for (let budget = 2000; budget <= 30000; budget += 200) {
  const a = orig.boundAutomationContext(options, budget)
  const b = fixed.boundAutomationContext(options, budget)
  const oa = findOrphan(a.options.messages)
  const ob = findOrphan(b.options.messages)
  if (oa) {
    badOrig++
    if (origBad.length < 6) origBad.push(`budget=${budget} → 孤儿 ${oa}（保留 ${a.options.messages.length} 条）`)
  }
  if (ob) {
    badFixed++
    if (fixedBad.length < 6) fixedBad.push(`budget=${budget} → 孤儿 ${ob}`)
  }
}

console.log(`扫描预算 2000~30000（步长 200，共 141 档）`)
console.log(`\n原始实现：非法 ${badOrig} 档 / 141`)
for (const s of origBad) console.log(`   ❌ ${s}`)
console.log(`\n补丁版  ：非法 ${badFixed} 档 / 141`)
for (const s of fixedBad) console.log(`   ❌ ${s}`)
console.log(`\n结论：${badOrig > 0 && badFixed === 0 ? '✅ 补丁消除了非法消息结构' : '⚠️ 需要进一步分析'}`)

