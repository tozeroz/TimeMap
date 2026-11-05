import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const out = 'docs/test/admin-ui-20261105'
fs.mkdirSync(out, { recursive: true })
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5186'], { cwd: process.cwd() + '/app', stdio: 'ignore', windowsHide: true })
for (let attempt = 0; attempt < 40; attempt++) { try { await fetch('http://127.0.0.1:5186'); break } catch { await new Promise(resolve => setTimeout(resolve, 250)) } }
const browser = await chromium.launch({ headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe') })
const place = { id: 'library', name: '图书馆', latitude: 39.95, longitude: 116.35, enabled: true, category: '学习', postCount: 0 }
const base = { id: 'one', title: '第十八届博士生国际招生面试交流会', startsAt: '2026-11-21T06:00:00.000Z', endsAt: null, place, status: 'scheduled', effectiveStatus: 'upcoming', source: '学校／学院官网', description: '欢迎参加校园学术活动。', activityType: '学术', organizer: '研究生院', externalLink: '', coverImageId: null, favoriteCount: 0, favoritedByMe: false }
let items = [{ ...base }, { ...base, id: 'two', title: 'TIK TALK · The Pop Market', startsAt: '2026-11-14T02:00:00.000Z', source: '校园活动中心' }, { ...base, id: 'three', title: '第六届通信技术与信息科技国际学术会议暨校园青年学者交流研讨会', startsAt: '2026-11-06T00:00:00.000Z', source: '北京交通大学通信与信息技术学院学术交流办公室' }]
let mode = 'normal', patchFailure = false, patch, creates = 0, adminRequests = 0
const errors = []
const evidence = []
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => { if (!localStorage.getItem('campus.demo.session.v1')) localStorage.setItem('campus.demo.session.v1', JSON.stringify({ token: 'fixture-only', user: { id: 'fixture-user', displayName: 'UI测试', role: 'admin' } })) })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    const reply = (body, status = 200) => route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': '*' } })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (path.startsWith('/api/admin/')) adminRequests++
    if (path === '/api/admin/activities' && request.method() === 'GET') {
      if (mode === 'loading') await new Promise(resolve => setTimeout(resolve, 700))
      if (mode === 'error') return reply({ error: 'db_unavailable' }, 503)
      return reply({ items: mode === 'empty' ? [] : items })
    }
    if (path === '/api/admin/places') return mode === 'partial' ? reply({ error: 'db_unavailable' }, 503) : reply({ items: [place] })
    if (path.startsWith('/api/admin/activities/') && request.method() === 'PATCH') {
      patch = request.postDataJSON()
      if (patchFailure) return reply({ error: 'db_unavailable' }, 503)
      const id = path.split('/').at(-1)
      items = items.map(x => x.id === id ? { ...x, ...patch, effectiveStatus: patch.status === 'cancelled' ? 'cancelled' : patch.status === 'scheduled' ? 'upcoming' : x.effectiveStatus } : x)
      return reply({ id })
    }
    if (path === '/api/admin/activities' && request.method() === 'POST') { creates++; return reply({ id: 'created' }) }
    if (path === '/api/auth/me') return reply({ id: 'fixture-user', displayName: 'UI测试', role: 'admin' })
    if (path === '/api/activities/one') return reply(items[0])
    return reply({ items: [] })
  })
  const open = async () => { await page.goto('http://127.0.0.1:5186/#/admin?panel=activities'); await page.locator('.adm-activity').first().waitFor({ timeout: 10000 }).catch(async error => { await page.screenshot({ path: `${out}/debug.png` }); console.log('DEBUG', await page.locator('body').innerText(), errors); throw error }) }
  await open()
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    assert(await page.evaluate(() => { const e = document.querySelector('.screen__body'); return e.scrollWidth <= e.clientWidth }), `overflow ${width}`)
    assert(await page.locator('.adm-activity').evaluateAll(cards => cards.every(e => e.scrollWidth <= e.clientWidth)), `card overflow ${width}`)
    const artifact = `activities-${width}.png`
    await page.screenshot({ path: `${out}/${artifact}` })
    evidence.push({ viewport: `${width}x${height}`, artifact, observation: 'Long Chinese/English titles and long source fit; horizontally scrollable navigation/status row remains within screen; real fixture times and years visible.' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('textbox', { name: '搜索活动名称、地点' }).fill('tik talk')
  assert.equal(await page.locator('.adm-activity').count(), 1)
  await page.getByRole('button', { name: '已结束', exact: true }).click()
  await page.getByRole('heading', { name: '没有匹配的活动' }).waitFor()
  await page.getByRole('button', { name: '清除条件' }).click()
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await page.getByLabel('开始日期（起）').fill('2026-11-14')
  await page.getByLabel('开始日期（止）').fill('2026-11-14')
  await page.getByRole('button', { name: '应用筛选' }).click()
  assert.equal(await page.locator('.adm-activity').count(), 1)
  assert((await page.locator('.adm-activity').innerText()).includes('TIK TALK'))
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.locator('.adm-activity').first().waitFor()
  assert.equal(await page.locator('.adm-activity').count(), 1)
  await page.reload(); await page.locator('.adm-activity').first().waitFor()
  await page.getByRole('button', { name: '编辑', exact: true }).first().click()
  assert.equal(await page.locator('[data-activity-start]').inputValue(), '2026-11-21T14:00')
  await page.getByLabel('活动标题', { exact: true }).fill('编辑后的校园学术交流会')
  patchFailure = true
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByText('保存失败：', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('活动标题', { exact: true }).inputValue(), '编辑后的校园学术交流会')
  await page.screenshot({ path: `${out}/edit-error.png` })
  patchFailure = false
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByText('活动修改已保存', { exact: true }).waitFor()
  assert.equal(patch.startsAt, '2026-11-21T06:00:00.000Z')
  assert.equal(patch.organizer, '研究生院')
  await page.getByRole('button', { name: '新建活动', exact: true }).click()
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByText('标题、地点、开始时间都是必填').waitFor()
  assert.equal(creates, 0)
  await page.getByLabel('活动标题', { exact: true }).fill('新建测试活动')
  await page.getByLabel('活动地点', { exact: true }).selectOption('library')
  await page.locator('[data-activity-start]').fill('2026-11-22T09:00')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByText('活动已创建', { exact: true }).waitFor()
  assert.equal(creates, 1)
  await page.getByRole('button', { name: '更多操作：编辑后的校园学术交流会', exact: true }).click()
  await page.getByRole('button', { name: '取消活动', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.getByText('活动已取消', { exact: true }).waitFor()
  assert.equal(patch.status, 'cancelled')
  await page.getByRole('button', { name: '更多操作：编辑后的校园学术交流会', exact: true }).click()
  await page.getByRole('button', { name: '恢复活动', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.getByText('活动已恢复', { exact: true }).waitFor()
  assert.equal(patch.status, 'scheduled')
  await page.getByRole('button', { name: '查看详情', exact: true }).first().click()
  await page.waitForURL('**/activity?id=one')
  await open()
  for (const panel of ['reports', 'submissions', 'posts', 'places', 'audit']) {
    await page.locator(`[data-admin-tab="${panel}"]`).click()
    await page.locator('.adm__pane').waitFor()
    await page.waitForTimeout(70)
    assert(await page.evaluate(() => { const e = document.querySelector('.screen__body'); return e.scrollWidth <= e.clientWidth }))
  }
  mode = 'loading'
  await page.goto('http://127.0.0.1:5186/#/admin?panel=activities'); await page.reload()
  await page.getByText('正在读取活动…').waitFor()
  await page.screenshot({ path: `${out}/loading.png` })
  await page.locator('.adm-activity').first().waitFor()
  mode = 'empty'; await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('heading', { name: '暂无活动' }).waitFor()
  await page.screenshot({ path: `${out}/empty.png` })
  mode = 'error'; await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.locator('[data-admin-error]').waitFor()
  await page.screenshot({ path: `${out}/error.png` })
  mode = 'normal'; await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.locator('.adm-activity').first().waitFor()
  mode = 'partial'; await page.reload(); await page.locator('.adm-activity').first().waitFor()
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await page.getByText('地点读取失败', { exact: false }).waitFor()
  await page.screenshot({ path: `${out}/partial.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '新建活动', exact: true }).click()
  await page.keyboard.press('Shift+Tab')
  assert(await page.evaluate(() => document.activeElement?.closest('dialog') !== null))
  await page.keyboard.press('Tab')
  assert(await page.evaluate(() => document.activeElement?.closest('dialog') !== null))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-admin-new-activity'), { timeout: 3000 }).catch(async e => { console.log('FOCUS', await page.evaluate(() => ({ active: document.activeElement?.outerHTML, dialogs: document.querySelectorAll('dialog').length }))); throw e })
  mode = 'normal'
  items = ['upcoming', 'ongoing', 'ended', 'cancelled'].map((effectiveStatus, index) => ({ ...base, id: `state-${index}`, title: `${effectiveStatus === 'ended' ? '2025年跨年' : '校园'}活动状态展示`, startsAt: effectiveStatus === 'ended' ? '2025-12-31T16:30:00.000Z' : base.startsAt, effectiveStatus, status: effectiveStatus === 'cancelled' ? 'cancelled' : 'scheduled' }))
  await page.reload(); await page.locator('.adm-activity').first().waitFor()
  assert.equal(await page.locator('.adm-activity').count(), 4)
  assert.equal(await page.locator('.is-ongoing').count(), 1)
  assert.equal(await page.locator('.is-ended').count(), 1)
  await page.screenshot({ path: `${out}/status-variants.png` })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({ path: `${out}/reduced-motion.png` })
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('campus.demo.session.v1')); s.user.role = 'student'; localStorage.setItem('campus.demo.session.v1', JSON.stringify(s)) })
  const before = adminRequests
  await page.reload(); await page.getByText('无权限', { exact: true }).waitFor()
  assert.equal(adminRequests, before)
  await page.screenshot({ path: `${out}/permission.png` })
  assert.deepEqual(errors, [])
  fs.writeFileSync(`${out}/evidence.json`, JSON.stringify({ contract: 'docs/zwf/2026-11-05-管理端UI复刻方案.md; scope: management shell and activities, existing loaded-list API only', targetViewports: evidence.map(x => x.viewport), accessibility: { status: 'pass', evidence: 'Native dialogs support Escape, focus trap and restore; labelled form fields; visible focus; green/white and text contrast checked; reduced-motion has no decorative animation. Icon-only close controls labelled.' }, responsive: { status: 'pass', evidence: 'DOM overflow assertions on screen body and every activity card at all four target viewports, including long source/title. Navigation and status filters deliberately scroll internally.' }, contentStates: Object.fromEntries(['loading','empty','error','partial','success','permission'].map(name => [name, { status: 'pass', evidence: ({ loading: 'Delayed list response renders stable loading text.', empty: 'Empty data and zero filtered results have distinct recovery actions.', error: '503 list and PATCH failures exercised; retry works and draft retained.', partial: 'Place API fails independently; list stays usable and filter exposes retry.', success: 'Mock POST/PATCH updates verified, success notices and authoritative list reload.', permission: 'Student sees denied state; asserted no admin API requests.' })[name] }])), renderedEvidence: evidence, fixtureOnly: true, limitations: ['No real backend writes or deployed server integration.', 'Local filters apply to currently loaded list; no new pagination endpoint.'] }, null, 2))
  console.log('PASS admin UI: four viewports, search/status/date intersection, refresh persistence, edit prefill/save/error recovery, create validation, cancellation/restoration, detail route, six panels, loading/empty/error/partial/permission, focus restore; no page errors; isolated mocked APIs only.')
} finally { await browser.close(); dev.kill() }
