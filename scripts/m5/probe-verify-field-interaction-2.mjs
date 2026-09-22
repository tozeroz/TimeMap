/**
 * 极窄只读观察（第 2 次，仍只做**一个**字段）+ 正确复核"无持久状态改变"
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么还要第二次
 * ════════════════════════════════════════════════════════════════════
 *   ① 审核 66 的停止条件是"**如果这一条已经足以看出三个空字段共享同一种交互模型**，就停止"。
 *      第一次只看了「所在学院」= picker。但**单一样本不足以**推断另外两个也是 picker
 *      （「就读专业」完全可能是真正的文本输入框 —— 在真实 app 里很常见）。
 *      ⇒ 按审核口径，需**再补一个**样本以判定"是否共享模型"；
 *        但**不**做三个字段的逐项考古（补完「就读专业」即可下判断）。
 *   ② 第一次的"无持久状态改变"复核**没测到点上**（BACK 之后设备停在 Me 页/抽屉，
 *      并没有回到认证页）⇒ 那一步**等于没验**。这轮**正确复核**：
 *      重新进入认证页 → 确认四字段与点击前一致（学院/专业/年级仍为空）。
 *
 * ⚠️ 仍然只读：每步先 dump 确认目标；**不选择任何值**；结束前复原并复核。
 */
const OUT = 'G:\\demo map\\tools\\tmp\\verify-field-interaction-2.json'
const fs = await import('node:fs')
const { execFileSync } = await import('node:child_process')

const ADB = 'G:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe'
const DEV = '127.0.0.1:16384'
const adb = (args) => execFileSync(ADB, ['-s', DEV, ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = { purpose: '第 2 次极窄观察：就读专业的交互类型 + 正确复核无持久状态改变', steps: [] }
const step = (n, d) => {
  report.steps.push({ at: new Date().toISOString(), step: n, data: d })
  console.log('  [' + n + '] ' + JSON.stringify(d))
}

function dump(tag) {
  adb(['shell', 'uiautomator', 'dump', `/sdcard/${tag}.xml`])
  adb(['pull', `/sdcard/${tag}.xml`, `G:\\demo map\\tools\\tmp\\orig-${tag}.xml`])
  const xml = fs.readFileSync(`G:\\demo map\\tools\\tmp\\orig-${tag}.xml`, 'utf8')
  const nodes = []
  for (const m of xml.matchAll(/text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    const t = m[1].trim()
    if (!t) continue
    const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number)
    nodes.push({ text: t, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) })
  }
  const focus = (adb(['shell', 'dumpsys', 'window']).match(/mCurrentFocus=(\S+)/) || [])[1] || ''
  return { nodes, focus, texts: nodes.map((n) => n.text) }
}
const find = (d, needle) => d.nodes.find((n) => n.text.includes(needle)) || null

/** 进认证页：Me → 抽屉 → 校园认证（每步都 dump 确认） */
async function gotoVerify() {
  adb(['shell', 'monkey', '-p', 'com.kairuotu.campus', '-c', 'android.intent.category.LAUNCHER', '1'])
  await sleep(6500)
  adb(['shell', 'input', 'tap', '174', '1848']) // Me tab
  await sleep(3000)
  let d = dump('w1')
  if (!d.texts.includes('我的兴趣')) {
    // 可能抽屉已开：先关掉（按 BACK 一次）再重试一次
    adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
    await sleep(1500)
    d = dump('w1b')
  }
  adb(['shell', 'input', 'tap', '63', '112']) // 抽屉图标
  await sleep(2500)
  d = dump('w2')
  const it = find(d, '校园认证')
  if (!it) throw new Error('抽屉里找不到「校园认证」（不猜坐标）')
  adb(['shell', 'input', 'tap', String(it.cx), String(it.cy)])
  await sleep(3500)
  return dump('w3')
}

console.log('=== ① 进入认证页并记录**基线**四字段状态 ===')
let v = await gotoVerify()
step('verify_baseline', { focus: v.focus, texts: v.texts })
const baselineHas = ['就读学校', '所在学院', '就读专业', '当前年级'].filter((f) => v.texts.some((t) => t.includes(f)))
step('baseline_fields', { present: baselineHas })
if (!v.texts.some((t) => t.includes('就读专业'))) throw new Error('当前页没有「就读专业」⇒ 中止')

console.log('')
console.log('=== ② 点「就读专业」并观察（**不选择任何值**）===')
const major = find(v, '就读专业')
adb(['shell', 'input', 'tap', String(major.cx), String(major.cy)])
await sleep(2500)
const after = dump('w4')
step('after_tap_major', { focus: after.focus, texts: after.texts })
let ime = ''
try { ime = adb(['shell', 'dumpsys', 'input_method']) } catch { /* ignore */ }
step('input_method', { mInputShown: /mInputShown=true/.test(ime) })

/** 同一套判定口径（与第 1 次可比） */
const isPicker = after.texts.some((t) => /取消/.test(t)) && after.texts.some((t) => /确认|完成|确定/.test(t))
step('interpretation', {
  sameAsCollege: isPicker,
  hasCancelConfirm: after.texts.some((t) => /取消/.test(t)),
  keyboardShown: /mInputShown=true/.test(ime),
  sample: after.texts.slice(0, 12),
})

console.log('')
console.log('=== ③ 退出（Back ×2），**不选择任何值** ===')
adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
await sleep(1500)
adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
await sleep(2500)

console.log('')
console.log('=== ④ ⭐ 正确复核"无持久状态改变"：**重新进入认证页**与基线比对 ===')
v = await gotoVerify()
step('verify_after', { focus: v.focus, texts: v.texts })
const afterHas = ['就读学校', '所在学院', '就读专业', '当前年级'].filter((f) => v.texts.some((t) => t.includes(f)))
/* 关键判据：四字段标签都还在，且**没有多出"已选中的值"文本** */
const baselineTexts = report.steps.find((s) => s.step === 'verify_baseline').data.texts
const added = v.texts.filter((t) => !baselineTexts.includes(t))
step('no_persistent_change', {
  fieldsStillPresent: afterHas,
  addedTextsVsBaseline: added,
  verdict: added.length === 0 ? 'NO CHANGE（与基线逐字一致）' : 'CHANGED ⇒ 需人工核对',
})

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)
process.exit(0)
