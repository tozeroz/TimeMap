/**
 * 受控突变：把 `ScannerScreen` **恢复成 Round 319 之前的"假 scanner"**
 * —— 用来证明 scanner 门禁断言**真的能红**
 *
 * ## 复现的历史形态（逐字）
 * ```
 *   const t2 = window.setTimeout(() => setDone(true), 5200)   ← 5.2s 后**无条件**"识别成功"
 *   {done && <span className="scan__ok">识别成功</span>}
 *   {done ? '查看扫描结果' : '正在识别…'}
 *   取景框 .scan__frame + 四角 .scan__corner-* + 扫描线 .scan__line
 *   scannerHints（mock 轮播提示）
 * ```
 *
 * ## 预计打红哪几条
 *   `SCANNER_EXPLICIT_UNAVAILABLE`  —— 「尚未实现」文案消失
 *   `SCANNER_NO_FAKE_SUCCESS`       —— 出现「正在识别…」与（5.2s 后）「识别成功」
 *   `SCANNER_NO_FAKE_VIEWFINDER`    —— 假取景框/扫描线回来了（节点数 > 0）
 *   `SCANNER_NO_MOCK_HINTS`         —— mock 提示文案回来了
 *   ⭐ 而 `SCANNER_ENTRY_PRESENT_IN_DRAWER` 与 `DRAWER_ITEMS_MATCH_ORIGINAL` **应仍 PASS**
 *      —— 突变只动扫码**页**，不动抽屉 ⇒ **归因清晰**
 *
 * ⚠️ 实现要点：注入后**必须通过 tsc**（否则验的是"构建会不会崩"而非"断言能不能红"）。
 *    需要把 mock 的 scannerHints 临时加回（它已被 Round 319 移出生产）。
 *
 * 用法：node scripts/m5/mutate-scanner-fake.mjs inject|restore
 *       MUT_TARGET="app/src/screens/ScannerScreen.tsx app/src/data/mock.ts"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const SCREEN = 'G:\\demo map\\app\\src\\screens\\ScannerScreen.tsx'
const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const TARGETS = [SCREEN, MOCK]
const BACKUPS = TARGETS.map((p) => 'G:\\demo map\\tools\\tmp\\' + p.split('\\').pop() + '.origscan.txt')
const mode = process.argv[2]

function norm(text) {
  const crlf = text.includes('\r\n')
  return [crlf ? text.replace(/\r\n/g, '\n') : text, crlf ? '\r\n' : '\n']
}
function denorm(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}
function restoreAll(quiet) {
  let any = false
  TARGETS.forEach((t, i) => {
    if (existsSync(BACKUPS[i])) {
      writeFileSync(t, readFileSync(BACKUPS[i], 'utf8'), 'utf8')
      rmSync(BACKUPS[i], { force: true })
      any = true
    }
  })
  if (any) console.log(quiet ? '  （回滚）已还原两个源文件' : '  已还原 ScannerScreen.tsx 与 mock.ts')
  return any
}

const LEGACY_MOCK = `
/* [突变] Round 319 之前的历史 mock 扫码提示（现已移出生产 → fixtures/legacy-scanner-hints.json） */
export const scannerHints = ['扫描校园卡二维码', '扫描群邀请二维码', '扫描活动签到码']
`

const LEGACY_SCREEN = `import { useEffect, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconImage } from '../components/icons'
import { scannerHints } from '../data/mock'
import { goBack, navigate } from '../router'
import './scanner.css'

/* [突变] 复现历史形态：伪造的扫码屏（假取景 + 假提示 + 5.2s 无条件"识别成功"） */
export function ScannerScreen() {
  const [hint, setHint] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const t1 = window.setInterval(() => setHint((i) => (i + 1) % scannerHints.length), 2200)
    const t2 = window.setTimeout(() => setDone(true), 5200)
    return () => {
      window.clearInterval(t1)
      window.clearTimeout(t2)
    }
  }, [])

  return (
    <Screen className="scan" scroll={false}>
      <TopBar
        variant="plain"
        left={
          <button className="iconbtn scan__btn" onClick={() => goBack('campus')} aria-label="关闭">
            <IconClose size={22} />
          </button>
        }
        right={
          <button className="iconbtn scan__btn" aria-label="相册">
            <IconImage size={20} />
          </button>
        }
      />

      <div className="scan__stage">
        <div className="scan__frame">
          <span className="scan__corner scan__corner--tl" />
          <span className="scan__corner scan__corner--tr" />
          <span className="scan__corner scan__corner--bl" />
          <span className="scan__corner scan__corner--br" />
          {!done && <span className="scan__line" />}
          {done && <span className="scan__ok">识别成功</span>}
        </div>

        <p className="scan__hint">{scannerHints[hint]}</p>
      </div>

      <div className="scan__foot">
        <button className="scan__result" onClick={() => navigate('onboarding')} disabled={!done}>
          {done ? '查看扫描结果' : '正在识别…'}
        </button>
        <p className="scan__tip">将二维码放入框内，即可自动识别</p>
      </div>
    </Screen>
  )
}
`

if (mode === 'inject') {
  try {
    TARGETS.forEach((t, i) => {
      if (!existsSync(BACKUPS[i])) copyFileSync(t, BACKUPS[i])
    })
    // ① mock.ts：加回 scannerHints
    {
      const [src, eol] = norm(readFileSync(MOCK, 'utf8'))
      if (src.includes('export const scannerHints')) throw new Error('mock.ts 已含突变数据（请先 restore）')
      writeFileSync(MOCK, denorm(src.trimEnd() + '\n' + LEGACY_MOCK, eol), 'utf8')
    }
    // ② 整屏替换为历史实现
    {
      const [src, eol] = norm(readFileSync(SCREEN, 'utf8'))
      if (!src.includes('export function ScannerScreen()')) throw new Error('找不到 ScannerScreen 锚点')
      writeFileSync(SCREEN, denorm(LEGACY_SCREEN, eol), 'utf8')
    }
    console.log('  已注入突变：ScannerScreen 退回"假 scanner"（假取景 + mock 提示 + 5.2s 无条件识别成功）')
  } catch (err) {
    console.error('FAIL ' + String(err && err.message))
    restoreAll(true)
    process.exit(1)
  }
} else if (mode === 'restore') {
  if (!restoreAll(false)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
} else {
  console.error('用法：node mutate-scanner-fake.mjs inject|restore')
  process.exit(2)
}
