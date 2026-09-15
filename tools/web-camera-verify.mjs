/**
 * 用独立 Chromium 验证「发布页页内取景」这条真实链路。
 *
 * 为什么要单独跑一份浏览器：MCP 那个 Playwright 实例里 getUserMedia 会一直挂着
 * （既不 resolve 也不 reject），没法判定到底是环境问题还是代码问题。
 * 这里自己起一个干净实例，分两种模式跑：
 *
 *   node tools/web-camera-verify.mjs               # 尝试真实摄像头（本机 Integrated Camera）
 *   node tools/web-camera-verify.mjs --fake        # 用 Chromium 合成摄像头（确定性，不依赖硬件）
 *
 * --fake 用的是 Chromium 官方的 --use-fake-device-for-media-stream：
 * 它给出的是**真的 MediaStream**（一段动图），所以跑的仍然是我们线上那份
 * getUserMedia 代码，只是摄像头换成了替身 —— 这正是用户允许的「暂时用替代设备」。
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

const PLAYWRIGHT_CANDIDATES = [
  'C:/Users/zjx230494186/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
  'C:/Users/zjx230494186/AppData/Local/npm-cache/_npx/5d33215cde3ffb45/node_modules/playwright-core',
]
const CHROME_CANDIDATES = [
  'C:/Users/zjx230494186/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/zjx230494186/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
]

const playwrightPath = PLAYWRIGHT_CANDIDATES.find((p) => existsSync(path.join(p, 'package.json')))
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!playwrightPath || !chromePath) {
  console.error('playwright-core or chromium not found', { playwrightPath, chromePath })
  process.exit(2)
}

const { chromium } = require(playwrightPath)
const fake = process.argv.includes('--fake')
const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:5175/#/publish'
const origin = new URL(url).origin

const args = ['--no-first-run', '--no-default-browser-check']
if (fake) {
  args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream')
}

const browser = await chromium.launch({ executablePath: chromePath, headless: false, args })
const context = await browser.newContext({ permissions: ['camera'] })
const page = await context.newPage()

const report = { mode: fake ? 'fake-device' : 'real-camera', url }
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.pub__video', { timeout: 15000 })

  // 等状态机出结果（live 或 error），最多 20 秒
  const state = await page
    .waitForFunction(
      () => ['live', 'error'].includes(document.querySelector('.pub__video')?.dataset.camState ?? ''),
      null,
      { timeout: 20000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null)
  report.camState = await page.evaluate(() => document.querySelector('.pub__video')?.dataset.camState ?? null)

  report.video = await page.evaluate(async () => {
    const v = document.querySelector('.pub__video')
    for (let i = 0; i < 20 && !v?.videoWidth; i++) await new Promise((r) => setTimeout(r, 200))
    return v ? { w: v.videoWidth, h: v.videoHeight, readyState: v.readyState, hasStream: !!v.srcObject } : null
  })

  report.buttons = await page.evaluate(() =>
    [...document.querySelectorAll('.pub__controls > *')].map((b) => ({
      aria: b.getAttribute('aria-label') ?? (b.innerText || '').trim(),
      disabled: b.disabled ?? null,
    })),
  )

  if (report.camState === 'live') {
    // 画面不能是纯黑：采样一帧算亮度分布
    report.frame = await page.evaluate(async () => {
      const v = document.querySelector('.pub__video')
      await new Promise((r) => setTimeout(r, 600))
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 48
      c.getContext('2d').drawImage(v, 0, 0, 64, 48)
      const d = c.getContext('2d').getImageData(0, 0, 64, 48).data
      let sum = 0
      let min = 255
      let max = 0
      for (let i = 0; i < d.length; i += 4) {
        const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
        sum += lum
        if (lum < min) min = lum
        if (lum > max) max = lum
      }
      return { avg: Math.round(sum / (d.length / 4)), min: Math.round(min), max: Math.round(max) }
    })

    const shotArg = process.argv.find((a) => a.startsWith('--shot='))
    if (shotArg) {
      await page.setViewportSize({ width: 420, height: 860 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: shotArg.slice('--shot='.length), fullPage: true })
      report.screenshot = shotArg.slice('--shot='.length)
    }

    // 真实点击快门 -> 草稿里应该多一张真实 JPEG
    await page.click('[aria-label="拍摄"]')
    await page.waitForTimeout(900)
    report.draft = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.pub__draftItem img')]
      const src = imgs[0]?.src ?? ''
      return { count: imgs.length, isJpeg: src.startsWith('data:image/jpeg'), bytes: src.length }
    })
    report.shutterLeavesLive = await page.evaluate(
      () => document.querySelector('.pub__video')?.dataset.camState === 'live',
    )

    // 前后置切换：把 enumerateDevices 改成「两个摄像头」，验证状态机与镜像
    // 必须用 addInitScript —— reload 会清掉页面里打的补丁
    await context.addInitScript(() => {
      const md = navigator.mediaDevices
      const orig = md.enumerateDevices.bind(md)
      md.enumerateDevices = async () => [
        ...(await orig()),
        { kind: 'videoinput', deviceId: 'fake-back', label: 'Fake Back', groupId: 'g2', toJSON() {} },
      ]
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => ['live', 'error'].includes(document.querySelector('.pub__video')?.dataset.camState ?? ''),
      null,
      { timeout: 20000 },
    ).catch(() => null)
    const facingBefore = await page.evaluate(() => document.querySelector('.pub__video')?.dataset.facing)
    const streamIdBefore = await page.evaluate(() => document.querySelector('.pub__video')?.srcObject?.id ?? null)
    report.flipButtonEnabled = await page.evaluate(
      () => !document.querySelector('[aria-label="切换前后置摄像头"]')?.disabled,
    )
    await page.click('[aria-label="切换前后置摄像头"]')
    await page.waitForTimeout(3500)
    report.flip = {
      before: facingBefore,
      after: await page.evaluate(() => document.querySelector('.pub__video')?.dataset.facing),
      streamChanged: await page.evaluate(
        (prev) => (document.querySelector('.pub__video')?.srcObject?.id ?? null) !== prev,
        streamIdBefore,
      ),
      mirrored: await page.evaluate(() =>
        document.querySelector('.pub__video')?.classList.contains('is-mirrored'),
      ),
      backLive: await page.evaluate(
        () => document.querySelector('.pub__video')?.dataset.camState === 'live',
      ),
    }
  } else {
    report.fallbackText = await page.evaluate(
      () => document.querySelector('.pub__camFallbackText')?.innerText ?? null,
    )
  }
} catch (error) {
  report.error = String(error).slice(0, 300)
} finally {
  await browser.close()
}

console.log(JSON.stringify(report, null, 2))
