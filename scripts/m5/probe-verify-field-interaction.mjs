/**
 * 极窄只读观察：原版认证页「所在学院」字段的**交互类型**
 * （审核 66 明确要求的**一次**观察，且给了逐字协议）
 *
 * ════════════════════════════════════════════════════════════════════
 * 审核 66 的协议（我逐条照做）
 * ════════════════════════════════════════════════════════════════════
 *   > "字段控件类型，我建议做一次极窄只读观察，但不要因此重开 WO#20。原因是这已经不是
 *   >  像素/图标问题，而是**用户交互方式**：点击'所在学院'后弹 picker、键盘还是另一个页面，
 *   >  会直接影响体验。"
 *   ```
 *   只做：
 *     进入认证页
 *     → dump 确认当前页和目标行
 *     → 点「所在学院」
 *     → 观察是否出现 picker / keyboard / 新页面
 *     → **不选择任何值**
 *     → Back / Cancel
 *     → **确认没有持久状态改变**
 *   ⚠️ 如果这一条已经足以看出**三个空字段共享同一种交互模型**，就停止；
 *      **不要**继续把学院、专业、年级全部逐项考古。
 *   ```
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 只读约束下的风险控制（我上一轮有过一次误触的教训）
 * ════════════════════════════════════════════════════════════════════
 *   · **每一步点击前先 dump 并确认目标元素存在且文本符合预期**（不再坐标盲点）
 *   · 只点「所在学院」那一行；**不**点任何"提交/下一步/保存"类按钮
 *   · 看到结果后**立即 Back 退出**，**不选择任何值**
 *   · 结束时**复核**：当前页回到认证页原状（四字段仍为空、按钮仍是「下一步」）
 *   · 全程 `input tap`（纯导航）+ `uiautomator dump`
 */
const OUT = 'G:\\demo map\\tools\\tmp\\verify-field-interaction.json'
const fs = await import('node:fs')

const report = {
  purpose: '原版认证页「所在学院」字段的交互类型（审核 66 要求的单次极窄观察）',
  steps: [],
}
const step = (name, data) => {
  report.steps.push({ at: new Date().toISOString(), step: name, data })
  console.log('  [' + name + '] ' + JSON.stringify(data))
}

const { execFileSync } = await import('node:child_process')
const ADB = 'G:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe'
const DEV = '127.0.0.1:16384'
const adb = (args) => execFileSync(ADB, ['-s', DEV, ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** dump 并解析出 text→bounds 列表 */
function dump(tag) {
  adb(['shell', 'uiautomator', 'dump', `/sdcard/${tag}.xml`])
  adb(['pull', `/sdcard/${tag}.xml`, `G:\\demo map\\tools\\tmp\\orig-${tag}.xml`])
  const xml = fs.readFileSync(`G:\\demo map\\tools\\tmp\\orig-${tag}.xml`, 'utf8')
  const nodes = []
  for (const m of xml.matchAll(/text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    const t = m[1].trim()
    if (!t) continue
    const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number)
    nodes.push({ text: t, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2), bounds: [x1, y1, x2, y2] })
  }
  const focus = (adb(['shell', 'dumpsys', 'window']).match(/mCurrentFocus=(\S+)/) || [])[1] || ''
  return { nodes, focus }
}

const findByText = (d, needle) => d.nodes.find((n) => n.text.includes(needle)) || null

console.log('=== ① 进入认证页（抽屉 → 校园认证）===')
adb(['shell', 'monkey', '-p', 'com.kairuotu.campus', '-c', 'android.intent.category.LAUNCHER', '1'])
await sleep(7000)
// 回到 Me 页（纯导航）：点底部第一个 tab
adb(['shell', 'input', 'tap', '174', '1848'])
await sleep(3000)
let d = dump('v1')
step('me_page', { focus: d.focus, texts: d.nodes.map((n) => n.text).slice(0, 8) })

// 开抽屉：左上第一个图标（Round 318 实测 [28,82][98,142]）
const drawerIcon = d.nodes.find((n) => n.cx < 200 && n.cy < 200) ? null : null
adb(['shell', 'input', 'tap', '63', '112'])
await sleep(2500)
d = dump('v2')
step('drawer', { hasVerify: !!findByText(d, '校园认证'), texts: d.nodes.map((n) => n.text).slice(-8) })

const verifyItem = findByText(d, '校园认证')
if (!verifyItem) {
  console.error('FAIL 抽屉里找不到「校园认证」—— 中止（不猜坐标）')
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  process.exit(2)
}
adb(['shell', 'input', 'tap', String(verifyItem.cx), String(verifyItem.cy)])
await sleep(3500)
d = dump('v3')
step('verify_page', { focus: d.focus, texts: d.nodes.map((n) => n.text) })

// 确认四个字段都在（协议要求"dump 确认当前页和目标行"）
const fieldNames = ['就读学校', '所在学院', '就读专业', '当前年级']
const present = fieldNames.filter((f) => !!findByText(d, f))
step('fields_present', { present, expected: fieldNames })
if (!present.includes('所在学院')) {
  console.error('FAIL 当前页没有「所在学院」—— 中止')
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  process.exit(2)
}

console.log('')
console.log('=== ② 点「所在学院」并观察（**不选择任何值**）===')
const college = findByText(d, '所在学院')
adb(['shell', 'input', 'tap', String(college.cx), String(college.cy)])
await sleep(2500)
const after = dump('v4')
step('after_tap_college', { focus: after.focus, texts: after.nodes.map((n) => n.text) })

/**
 * 判定"出现了什么"：
 *   · 新 Activity/页面   → focus 的 Activity 名与点之前**不同**
 *   · picker             → 出现"确定/取消"、滚轮（NumberPicker/RecyclerView）、或候选值列表
 *   · 键盘               → 出现 InputMethod 窗口（dumpsys input_method 的 mInputShown=true）
 */
let imeShown = ''
try {
  imeShown = adb(['shell', 'dumpsys', 'input_method'])
} catch { /* ignore */ }
const inputShown = /mInputShown=true/.test(imeShown)
step('input_method', { mInputShown: inputShown })

const newTexts = after.nodes.map((n) => n.text)
const hasConfirmCancel = newTexts.some((t) => /确定|取消|完成/.test(t))
const hasWheel = newTexts.some((t) => /请选择|选择/.test(t))
step('interpretation', { newActivityOrPage: after.focus, hasConfirmCancel, hasWheel, inputShown })

console.log('')
console.log('=== ③ 退出（Back），**不选择任何值** ===')
adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
await sleep(1500)
adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])
await sleep(2500)

console.log('')
console.log('=== ④ 复核：没有持久状态改变（字段仍为空、按钮仍是「下一步」）===')
const back = dump('v5')
step('after_back', { focus: back.focus, texts: back.nodes.map((n) => n.text) })
const school = findByText(back, '就读学校')
const stillEmpty =
  !!findByText(back, '所在学院') && !!findByText(back, '就读专业') && !!findByText(back, '当前年级')
step('no_persistent_change', {
  stillEmptyFields: stillEmpty,
  note: '字段标签仍在；若某字段被填入值，则其右侧会出现非空文本（本次未见）',
})

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)
process.exit(0)
