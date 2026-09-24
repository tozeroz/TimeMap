/**
 * WO#7 Stage 0：**静态追 sendBtn / inputTextView / emojiBtn / plusBtn 的绑定**
 * （审核记录 42 要求的、开产品代码之前的纯本地只读取证）
 *
 * ## 为什么可能追得到
 *   Release APK 里 `R.id.sendBtn` 会被编译成**整数常量**（0x7f0a0692），
 *   所以代码里不会出现 "sendBtn" 这个字符串 —— 从 id 侧追是死路。
 *   但**另一侧是活的**：ViewBinding / DataBinding / 反射式 findViewById
 *   生成的**字段名/方法名会以字符串形式留在 dex 字符串池里**：
 *     · ViewBinding: 类名形如 `ImInputBoxBinding`，字段名就是 `sendBtn` / `inputTextView` …
 *     · 手写代码: `findViewById(0x7f0a0692)`，但类/方法名仍可作为线索
 *   → 所以先扫 dex 字符串池，看这些**名字**出现在哪些 dex、以及**邻近字符串**里有没有
 *     类名 / 方法名 / 状态相关词（VISIBLE / setVisibility / TextWatcher / doAfterTextChanged …）。
 *
 * ## 声明强度（写清楚，避免夸大）
 *   命中"字段名/类名" = 证明**存在 ViewBinding 之类的绑定**（静态证据，可复现）
 *   **不等于**证明了"什么条件切换 VISIBLE/GONE" —— 后者需要看方法体（需要反汇编）。
 *   → 因此本脚本的产出应表述为：
 *       SEND_BTN_BINDING_EXISTS: CONFIRMED（或 NOT_FOUND）
 *       COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED（除非能读到方法体）
 *   若只拿到"名字存在"，按审核 42 的指示：**不要为了填状态机而猜**。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const DEXDIR = 'G:\\demo map\\tools\\tmp\\apk-dex'
const DEXFILES = ['classes.dex', 'classes2.dex', 'classes3.dex', 'classes4.dex', 'classes5.dex']
const OUT = 'G:\\demo map\\tools\\tmp\\wo7-stage0-binding.json'

/** 要找的名字（ViewBinding 字段名 / layout 名 / 绑定类名） */
const NAMES = [
  'sendBtn',
  'inputTextView',
  'emojiBtn',
  'plusBtn',
  'voiceIv',
  'chat_voice_bar',
  'plusRedDot',
  'quoteViewStub',
  'ImInputBoxBinding',
  'ImInputBox',
  'im_input_box',
]

/** 邻近线索词（判断"绑定类"还是"随便出现的字符串"） */
const NEIGHBOR_HINTS = [
  'setVisibility',
  'getVisibility',
  'VISIBLE',
  'GONE',
  'TextWatcher',
  'afterTextChanged',
  'doAfterTextChanged',
  'addTextChangedListener',
  'setOnClickListener',
  'onClick',
  'ViewBinding',
  'binding',
  'LayoutInflater',
]

const report = { startedAt: new Date().toISOString(), dex: {}, summary: {} }
for (const d of DEXFILES) {
  const p = `${DEXDIR}\\${d}`
  if (!existsSync(p)) {
    report.dex[d] = { missing: true }
    continue
  }
  const buf = readFileSync(p)
  const s = buf.toString('latin1')
  const found = {}
  for (const n of NAMES) {
    const idxs = []
    let from = 0
    for (;;) {
      const i = s.indexOf(n, from)
      if (i < 0 || idxs.length >= 8) break
      idxs.push(i)
      from = i + 1
    }
    if (idxs.length) {
      // 取第一处附近的文本窗口作为"邻近线索"
      const win = s.slice(Math.max(0, idxs[0] - 200), idxs[0] + 200)
      const hints = NEIGHBOR_HINTS.filter((h) => win.includes(h))
      found[n] = { count: idxs.length, firstAt: idxs[0], neighborHints: hints }
    }
  }
  report.dex[d] = { size: buf.length, found }
}

console.log('=== WO#7 Stage 0：dex 字符串池里的 composer 绑定线索 ===')
for (const d of DEXFILES) {
  const r = report.dex[d]
  if (!r || r.missing) {
    console.log(`  ${d}: 不存在（先跑一次 extract）`)
    continue
  }
  const keys = Object.keys(r.found)
  console.log(`  ${d} (${(r.size / 1048576).toFixed(1)}MB): 命中 ${keys.length} 个名字`)
  for (const k of keys) {
    const f = r.found[k]
    console.log(`      ${k.padEnd(20)} ×${String(f.count).padStart(2)}  邻近线索: ${f.neighborHints.length ? f.neighborHints.join(', ') : '(无)'}`)
  }
}

// 汇总：哪些名字在**任何** dex 里出现
const allNames = new Set()
for (const d of DEXFILES) {
  const r = report.dex[d]
  if (r && r.found) for (const k of Object.keys(r.found)) allNames.add(k)
}
report.summary.namesFound = [...allNames]

console.log('')
console.log('=== 汇总 ===')
console.log(`  在 dex 里出现过的名字: ${allNames.size ? [...allNames].join(', ') : '（无）'}`)

const bindingClass = allNames.has('ImInputBoxBinding')
const bothFields = allNames.has('sendBtn') && allNames.has('inputTextView')
report.summary.SEND_BTN_BINDING_EXISTS = bindingClass || bothFields ? 'STRONGLY_SUPPORTED' : 'NOT_FOUND'
report.summary.COMPOSER_EXACT_VISIBILITY_STATE = 'NOT_EVALUATED'

console.log('')
console.log(`  SEND_BTN_BINDING_EXISTS:             ${report.summary.SEND_BTN_BINDING_EXISTS}`)
console.log('    （判据：dex 里同时出现 sendBtn 与 inputTextView 字段名，或出现 ImInputBoxBinding 类名）')
console.log('  COMPOSER_EXACT_VISIBILITY_STATE:     NOT_EVALUATED')
console.log('    ⚠️ 仅凭字符串池**无法**读出"什么条件切换 VISIBLE/GONE"（那要看方法体）。')
console.log('    按审核记录 42：**不要为了填状态机而猜**；追不到就照此标注。')
console.log('')
console.log('  ⚠️ 本脚本的边界：命中/未命中都只覆盖**字符串池**这一层；')
console.log('     未命中**不等于**不存在绑定（名字可能被混淆或内联）。')

writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log(`\n报告: ${OUT}`)
