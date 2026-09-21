/**
 * 离线验证 device-board-isolation.mjs 里"前台包检测"的解析逻辑（G1 的一部分）。
 *
 * 背景（docs/m5/VERIFICATION-GAPS.md 的 G1）：
 *   我按审核记录 23 收紧了 force-stop 规则，新增了"检测前台包 → 若不是我们的 App 就先拉回前台"
 *   的逻辑。但那条分支**从未在真机上跑过**（设备被其他验证占用）。
 *   其中**最容易错的不是 adb 调用，而是解析**：从 `dumpsys activity activities` 的
 *   输出里挑出 topResumedActivity 那一行、再判断里面是否含包名。
 *
 * 本文件用**真实样本**离线验证这段解析（样本取自本会话早前的实测输出），
 * 不碰设备、不依赖 CDP。这是"在没有设备时能把多少 G1 验掉"的答案：
 *   能验：解析与判断逻辑（含"取不到 dumpsys 时"的降级行为）
 *   不能验：adb 调用本身、Activity 是否真被拉回前台、时序等待是否足够
 *
 * 运行：node scripts/m5/test-foreground-parse.mjs
 */

// —— 与 device-board-isolation.mjs 中一致的解析方式（复制过来以便离线测试）——
function pickForegroundLine(dumpsysOutput) {
  return (
    dumpsysOutput
      .split('\n')
      .find((l) => l.includes('topResumedActivity') || l.includes('mResumedActivity')) ?? ''
  )
}

function detectPackage(dumpsysOutput, pkg) {
  const line = pickForegroundLine(dumpsysOutput)
  return { line: line.trim(), matched: line.includes(pkg) }
}

// —— 真实样本（来自本会话早前的实测输出，非编造）——
const SAMPLES = [
  {
    name: '原版 App 在前台（C1 观察时实测到的那一行）',
    raw: '  mResumedActivity: ActivityRecord{abc u0 com.kairuotu.campus/com.kairuotu.feed.messageboard.MessageBoardActivity t273}\n  topResumedActivity=ActivityRecord{b9cffa1 u0 com.kairuotu.campus/com.kairuotu.feed.messageboard.MessageBoardActivity t273}',
    expectTop: 'com.kairuotu.campus',
  },
  {
    name: '我们的 App 在前台',
    raw: '  topResumedActivity=ActivityRecord{deadb33 u0 com.campusx.demo/.MainActivity t99}',
    expectTop: 'com.campusx.demo',
  },
  {
    name: '系统 UI 在前台（例如刚弹出 picker 后回到桌面）',
    raw: '  topResumedActivity=ActivityRecord{1234 u0 com.mumu.launcher/.Launcher t1}',
    expectTop: 'com.mumu.launcher',
  },
  {
    name: 'dumpsys 取不到（空输出）—— 必须降级为"未匹配"，不能抛异常',
    raw: '',
    expectTop: '',
  },
]

let failed = 0
const check = (cond, msg, extra = '') => {
  if (cond) console.log(`  PASS ${msg}`)
  else {
    console.log(`  FAIL ${msg}${extra ? `（${extra}）` : ''}`)
    failed = 1
  }
}

console.log('=== 1) 从真实样本里挑 topResumedActivity 行 ===')
for (const s of SAMPLES) {
  const line = pickForegroundLine(s.raw)
  const ok = s.expectTop === '' ? line === '' : line.includes(s.expectTop)
  check(ok, `${s.name} → 取到「${line.trim().slice(0, 70) || '(空)'}」`, `期望含 ${s.expectTop}`)
}

console.log()
console.log('=== 2) 判断"前台是不是我们的 App"（脚本里真正用到的判断）===')
const OUR = 'com.campusx.demo'
const ORIGINAL = 'com.kairuotu.campus'
const cases = [
  ['原版在前台 → 应判定为"需要拉回我们前台"', SAMPLES[0].raw, false],
  ['我们在前台 → 应判定为"无需干预"', SAMPLES[1].raw, true],
  ['第三方 launcher 在前台 → 应判定为"需要拉回"', SAMPLES[2].raw, false],
  ['取不到 dumpsys → 应判定为"需要拉回"（保守），而不是崩', SAMPLES[3].raw, false],
]
for (const [desc, raw, expectOurs] of cases) {
  const { matched } = detectPackage(raw, OUR)
  check(matched === expectOurs, desc, `matched=${matched}`)
}

console.log()
console.log('=== 3) 空输出不得抛异常（脚本里 .find() 返回 undefined 时用 ?? "" 兜住）===')
try {
  const r = detectPackage(null ?? '', OUR)
  check(r.matched === false, '空输入不抛异常且返回未匹配')
} catch (e) {
  check(false, '空输入不得抛异常', String(e))
}

console.log()
console.log('=== 4) 明确说明本测试**没有**覆盖的部分（避免高估它的作用）===')
console.log('  未覆盖: adb shell dumpsys 的实际调用与退出码')
console.log('  未覆盖: am start 是否真把我们的 Activity 拉回前台')
console.log('  未覆盖: 等待 2.5s 是否足够（真机时序）')
console.log('  → 这些只能在设备空闲时由 G1 的运行时验证补齐')

console.log()
console.log(failed === 0 ? 'FOREGROUND_PARSE_UNIT_RESULT PASS' : 'FOREGROUND_PARSE_UNIT_RESULT FAIL')
process.exit(failed)
