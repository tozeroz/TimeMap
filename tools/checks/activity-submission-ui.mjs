import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const out = 'docs/zwf/evidence/activity-submission-ui'
fs.mkdirSync(out, { recursive: true })
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5185'], { cwd: process.cwd() + '/app', stdio: 'ignore', windowsHide: true })
for (let attempt = 0; attempt < 40; attempt++) { try { await fetch('http://127.0.0.1:5185'); break } catch { await new Promise(resolve => setTimeout(resolve, 250)) } }
const browser = await chromium.launch({ headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe') })
const base = { title: '校园秋日摄影分享会', placeId: 'lake', placeName: '明湖', startsAt: '2026-11-08T06:00:00Z', endsAt: '2026-11-08T08:00:00Z', description: '一起分享校园摄影作品与拍摄技巧，欢迎感兴趣的同学参加。', coverImageId: null, organizer: '摄影协会', source: '学院公众号', externalLink: '', activityType: '', revision: 1, submittedAt: '2026-11-02T02:30:00Z' }
const submissions = [ { ...base, id: 'one', status: 'pending' }, { ...base, id: 'two', title: '周末读书分享会', placeName: '图书馆', status: 'approved', publicationStatus: 'public', publishedActivityId: 'public-activity' }, { ...base, id: 'three', title: '校园草坪音乐会', placeName: '学生活动中心', status: 'rejected', reviewReason: '请补充活动信息来源及有效的原文链接。' } ]
let created
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('campus.demo.session.v1', JSON.stringify({ token: 'ui-fixture-only', user: { id: 'fixture-user', displayName: 'tozero' } })))
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    if (!path.startsWith('/api/')) return route.continue()
    const reply = body => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (path === '/api/auth/me') return reply({ id: 'fixture-user', displayName: 'tozero' })
    if (path === '/api/places') return reply({ items: [{ id: 'lake', name: '明湖', enabled: true }] })
    if (path === '/api/me/activity-submissions') return reply({ items: submissions.filter(x => !url.searchParams.get('status') || x.status === url.searchParams.get('status')), nextCursor: null })
    if (path.startsWith('/api/me/activity-submissions/')) return reply(submissions[2])
    if (path === '/api/activity-submissions') { created = req.postDataJSON(); return reply({ ...base, id: 'created', status: 'pending' }) }
    if (path === '/api/posts' || path.includes('favorites')) return reply({ items: [] })
    return route.fulfill({ status: 404, json: { error: 'fixture: no endpoint' }, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto('http://127.0.0.1:5185/#/activity-submit')
  await page.locator('#activity-placeId').selectOption('lake')
  assert.equal(await page.getByLabel('活动名称').inputValue(), '')
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  assert.equal(await page.locator('#activity-title').getAttribute('aria-invalid'), 'true')
  await page.getByLabel('活动名称').fill(base.title)
  await page.locator('#activity-startsAt').fill('2026-11-08T14:00')
  await page.locator('#activity-endsAt').fill('2026-11-08T16:00')
  await page.getByLabel('活动简介').fill(base.description)
  await page.getByLabel('主办方').fill(base.organizer)
  await page.getByLabel('信息来源').fill(base.source)
  for (const width of [320, 390, 430, 1024]) {
    await page.setViewportSize({ width, height: 844 })
    assert(await page.evaluate(() => document.querySelector('.screen__body').scrollWidth <= document.querySelector('.screen__body').clientWidth), `form overflow ${width}`)
    const height = await page.locator('.screen__body').evaluate(e => e.scrollHeight + 100)
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: `${out}/form-${width}.png` })

  }
  await page.setViewportSize({ width: 390, height: 844 })
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '我的提交', exact: true }).click()
  assert(page.url().includes('activity-submit'))
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await page.waitForURL('**/me?tab=submissions')
  await page.locator('.submission').first().waitFor()
  assert.equal(created.startsAt, '2026-11-08T06:00:00.000Z')
  assert.equal(await page.locator('.submission').count(), 3)
  for (const width of [320, 390, 430, 1024]) {
    await page.setViewportSize({ width, height: 844 })
    assert(await page.evaluate(() => document.querySelector('.screen__body').scrollWidth <= document.querySelector('.screen__body').clientWidth), `list overflow ${width}`)
    await page.screenshot({ path: `${out}/submissions-${width}.png` })
  }
  await page.getByRole('button', { name: '未通过', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.submission').length === 1)
  await page.getByRole('button', { name: '修改后重提', exact: true }).click()
  await page.waitForURL('**/activity-submit?submissionId=three')
  await page.waitForFunction(() => document.querySelector('#activity-title')?.value === '校园草坪音乐会')
  assert.equal(await page.locator('#activity-startsAt').inputValue(), '2026-11-08T14:00')
  assert.deepEqual(errors, [])
  console.log('PASS: empty form, required validation, Shanghai time, leave cancellation, submission redirect, three states, status filter, resubmit prefill; no overflow at 320/390/430/1024; screenshots use isolated mocked API data, no backend writes.')
} finally { await browser.close(); dev.kill() }
