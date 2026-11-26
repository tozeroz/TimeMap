/** Run after app build. Mocked API only; no remote data is changed. */
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || (existsSync(bundled) ? bundled : 'playwright'))
const browserRoot = join(homedir(), 'AppData/Local/ms-playwright')
const installed = existsSync(browserRoot) ? readdirSync(browserRoot).filter(n => /^chromium-/.test(n)).sort().reverse()[0] : undefined
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (installed ? join(browserRoot, installed, 'chrome-win64/chrome.exe') : undefined)
const origin = 'http://127.0.0.1:5189'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5189', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
  browser = await chromium.launch({headless:true,executablePath})
  const page = await browser.newPage()
  await page.route('**/api/**', route => route.fulfill({json: route.request().url().includes('/api/inbox')
    ? {through: new Date().toISOString(), counts:{likes:0,favorites:0,comments:0}, items:[], announcements:[], threads:[]}
    : {items:[]}}))
  await page.goto(origin + '/#/me')
  await page.getByRole('button', {name:'消息', exact:true}).click()
  await page.waitForURL('**/#/message')
  for (let round=0;round<2;round++) {
    for (const category of ['点赞','收藏','评论和@','应用公告']) {
      await page.getByRole('button', {name:category, exact:category!=='应用公告'}).click()
      await page.waitForURL(/category=/)
      await page.getByRole('button', {name:'返回消息',exact:true}).click()
      await page.waitForURL('**/#/message')
    }
    await page.getByRole('button', {name:'关闭',exact:true}).click()
    await page.waitForURL('**/#/me')
    if(round===0) {
      await page.getByRole('button', {name:'消息',exact:true}).click()
      await page.waitForURL('**/#/message')
    }
  }
  assert.equal(new URL(page.url()).hash,'#/me')
  console.log('PASS: repeated category visits return to inbox; closing returns to the original page without a loop')
} finally {await browser?.close();dev.kill()}
