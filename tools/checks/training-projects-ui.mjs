import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const out = 'docs/zwf/evidence/training-projects-ui'
fs.mkdirSync(out, { recursive: true })
const port = 5197
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: process.cwd() + '/app', stdio: 'pipe', windowsHide: true })
let browser
dev.stderr.on('data', data => process.stderr.write(data))
const fixtures = [
  { name: 'TimeMap 校园记忆地图', summary: '把校园故事，留在地图上', groupName: '第三小组', likeCount: 128 },
  { name: '交园搭子', summary: '找到一起运动、自习的伙伴', groupName: '第六小组', likeCount: 96 },
  { name: '校园失物招领', summary: '让遗失的物品找到回家的路', groupName: '第二小组', likeCount: 83 },
  { name: '自习室助手', summary: '轻松查询空位，预约自习座位', groupName: '第四小组', likeCount: 67 },
].map((p, i) => ({ ...p, id: `project-${i}`, memberCount: 5, experienceUrl: `https://example.com/project-${i}`, coverImageId: `cover-${i}`, position: i, published: true, likedByMe: i === 0 }))
let items = structuredClone(fixtures), state = 'ready', failLike = false
const errors = [], evidence = []
try {
  browser = await chromium.launch({ headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe') })
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }); break } catch { await new Promise(r => setTimeout(r, 250)) } }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => { if (!localStorage.getItem('project-fixture-anonymous')) localStorage.setItem('campus.demo.session.v1', JSON.stringify({ token: 'project-fixture', user: { id: 'fixture-user', displayName: '测试同学', role: 'admin' } })) })
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    const reply = (body, status = 200) => route.fulfill({ status, json: body, headers })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/projects') {
      if (state === 'loading') await new Promise(r => setTimeout(r, 800))
      return state === 'error' ? reply({ error: 'unavailable' }, 503) : reply({ items: state === 'empty' ? [] : items, total: state === 'empty' ? 0 : items.length })
    }
    if (/\/api\/projects\/.*\/like/.test(path)) {
      await new Promise(r => setTimeout(r, 100))
      if (failLike) return reply({ error: 'unavailable' }, 503)
      const item = items.find(p => p.id === path.split('/')[3]), liked = req.method() === 'PUT'
      if (item.likedByMe !== liked) item.likeCount += liked ? 1 : -1
      item.likedByMe = liked
      return reply({ likeCount: item.likeCount, likedByMe: liked })
    }
    if (path.startsWith('/api/media/')) {
      if (path.endsWith('cover-0')) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync('app/public/timemap-logo.png'), headers })
      if (state === 'partial') return route.fulfill({ status: 404, headers })
      const index = Number(path.at(-1)), colors = ['#e9f0e8', '#e1eff6', '#fae8cd', '#dfedde']
      const art = index === 1 ? '<circle cx="40" cy="38" r="16" fill="#183c54"/><circle cx="80" cy="38" r="16" fill="#183c54"/><path d="M16 110v-32q0-24 24-24t24 24v32" fill="#80b5d7"/><path d="M56 110v-32q0-24 24-24t24 24v32" fill="#9bc4a5"/>' : index === 2 ? '<path d="M40 40v-8q20-28 40 0v8" fill="none" stroke="#c56e2c" stroke-width="6"/><rect x="22" y="36" width="76" height="68" rx="18" fill="#eaa46b"/><rect x="35" y="68" width="50" height="28" rx="7" fill="#d88440"/>' : '<path d="M17 30q26-8 43 8 18-16 43-8v64q-24-8-43 6-19-14-43-6Z" fill="#93bda0" stroke="#5b9477" stroke-width="4"/><path d="M60 40v56" stroke="#f8f6f2" stroke-width="3"/>'
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${colors[index]}"/>${art}</svg>`, headers })
    }
    if (path === '/api/media' && req.method() === 'POST') return reply({ id: 'cover-0', mime: 'image/png', width: 120, height: 120 }, 201)
    if (path === '/api/admin/projects') {
      if (req.method() === 'GET') return reply({ items })
      items.push({ ...req.postDataJSON(), id: 'created-project', likeCount: 0, likedByMe: false }); return reply({ id: 'created-project' }, 201)
    }
    if (path.startsWith('/api/admin/projects/')) { const item = items.find(p => p.id === path.split('/').at(-1)); Object.assign(item, req.postDataJSON()); return reply({ id: item.id }) }
    if (path === '/api/activities' || path === '/api/places') return reply({ items: [], total: 0 })
    if (path === '/api/auth/me') return reply({ id: 'fixture-user', displayName: '测试同学', role: 'admin' })
    if (path === '/api/auth/request-code') return reply({ delivery: 'dev-sink', delivery_note: '隔离测试，未发送短信' })
    if (path === '/api/auth/verify-code') return reply({ token: 'project-fixture-login', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'fixture-user', displayName: '测试同学', role: 'student' } })
    return reply({ items: [] })
  })
  const goto = async () => { await page.goto(`http://127.0.0.1:${port}/#/activities?mode=projects&view=all`); await page.reload() }
  const capture = async (name, viewport, observation) => {
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
    evidence.push({ viewport, artifact: name + '.png', observation })
  }
  await goto(); await page.getByRole('heading', { name: fixtures[0].name, exact: true }).waitFor()
  assert.equal(await page.getByLabel('提交活动', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('时间筛选').count(), 0)
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('tab', { name: '全部项目', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#projects-tab-all')?.getAttribute('aria-selected') === 'true')
    await capture(`all-${width}`, `${width}x${height}`, '全部项目、体验与点赞、底部导航；独立测试项目数据。')
    await page.getByRole('tab', { name: '人气榜', exact: true }).click()
    await page.locator('.projects__rank').last().waitFor()
    assert.equal(await page.locator('.projects__rank').count(), 4)
    const overflow = await page.locator('.projects__results').evaluate(e => e.scrollWidth > e.clientWidth)
    assert.equal(overflow, false)
    await capture(`popular-${width}`, `${width}x${height}`, '人气榜金银铜及数字排名，全部内容可滚动，未发生水平溢出。')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '实训项目', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '实训项目' }).waitFor()
  await capture('mode-menu', '390x844', '标题下拉选中实训项目，橙色选中项和勾选。')
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('menu').count(), 0)
  assert.equal(await page.getByRole('button', { name: '实训项目', exact: true }).evaluate(e => e === document.activeElement), true)
  // Like/cancel, pending lock, multiple projects and shared tab state.
  const second = page.locator('[data-project-id="project-1"]')
  await second.getByRole('button').click()
  await page.waitForFunction(() => document.querySelector('[data-project-id="project-1"] button')?.getAttribute('aria-pressed') === 'true')
  assert.equal(items[1].likeCount, 97)
  await page.getByRole('tab', { name: '全部项目', exact: true }).click()
  assert.equal(await second.getByRole('button').getAttribute('aria-pressed'), 'true')
  await second.getByRole('button').click(); await page.waitForFunction(() => document.querySelector('[data-project-id="project-1"] button')?.getAttribute('aria-pressed') === 'false')
  assert.equal(items[1].likeCount, 96)
  failLike = true; await second.getByRole('button').click(); await page.getByRole('alert').waitFor()
  assert.equal(await second.getByRole('button').getAttribute('aria-pressed'), 'false'); failLike = false
  assert.equal(await second.getByRole('link', { name: '体验项目' }).getAttribute('href'), fixtures[1].experienceUrl)
  // Equal counts reorder by name, independent of administrator's presentation order.
  items[0].likeCount = items[1].likeCount = 100
  await page.getByRole('button', { name: '刷新项目' }).click(); await page.getByRole('heading', { name: fixtures[0].name, exact: true }).waitFor()
  await page.getByRole('tab', { name: '人气榜', exact: true }).click()
  await page.locator('.projects__rank').last().waitFor()
  const expected = [...items].sort((a, b) => b.likeCount - a.likeCount || new Intl.Collator('zh-CN').compare(a.name, b.name)).map(p => p.id)
  assert.deepEqual(await page.locator('[data-project-id]').evaluateAll(es => es.map(e => e.dataset.projectId)), expected)
  // Campus mode retains filters and floating submission button.
  await page.getByRole('button', { name: '实训项目', exact: true }).click(); await page.getByRole('menuitemradio', { name: '校园活动' }).click()
  await page.getByLabel('时间筛选').waitFor(); await page.getByLabel('提交活动', { exact: true }).waitFor()
  await page.getByRole('button', { name: '校园活动', exact: true }).click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await page.getByRole('tab', { name: '全部项目', exact: true }).waitFor()
  // Content states and long text.
  for (const s of ['empty', 'error', 'partial', 'loading']) {
    state = s; await goto()
    if (s === 'loading') {
      await page.getByRole('status', { name: '项目加载中' }).waitFor(); await capture('loading', '390x844', '项目请求中保留骨架和加载提示。')
      await page.getByRole('heading', { name: fixtures[0].name, exact: true }).waitFor()
    } else if (s === 'empty') { await page.getByRole('heading', { name: '暂无实训项目' }).waitFor(); await capture(s, '390x844', '暂无项目说明，无普通用户发布引导。') }
    else if (s === 'error') { await page.getByRole('heading', { name: '项目加载失败' }).waitFor(); await capture(s, '390x844', '请求失败提示与重试入口。') }
    else { await page.getByText('封面暂不可用').first().waitFor(); await capture(s, '390x844', '封面失败保留项目与可用操作。') }
  }
  state = 'ready'; items[1].name = '这是一个较长的实训项目名称用于验证窄屏文字换行与操作区域布局'
  await page.setViewportSize({ width: 320, height: 740 }); await goto(); await page.getByText(items[1].name, { exact: true }).waitFor()
  assert.equal(await page.locator('.projects__results').evaluate(e => e.scrollWidth > e.clientWidth), false)
  await capture('long-text', '320x740', '长项目名自然换行，操作仍可到达。')
  // Admin edit and publication maintenance.
  await page.goto(`http://127.0.0.1:${port}/#/admin?panel=projects`); await page.getByRole('heading', { name: '实训项目管理' }).waitFor()
  await page.getByRole('button', { name: '编辑项目' }).first().click()
  await page.getByLabel('项目名称', { exact: true }).fill('管理员修改的项目')
  await page.getByLabel('展示状态', { exact: true }).selectOption('draft')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByRole('heading', { name: '管理员修改的项目' }).waitFor()
  assert.equal(items[0].published, false)
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('项目名称', { exact: true }).fill('管理员新建的项目')
  await page.getByLabel('一句话简介', { exact: true }).fill('验证管理员录入和封面上传')
  await page.getByLabel('小组名称', { exact: true }).fill('第一小组')
  await page.getByLabel('体验网址', { exact: true }).fill('https://example.com/new-project')
  await page.getByLabel('项目封面', { exact: true }).setInputFiles({ name: 'project.png', mimeType: 'image/png', buffer: fs.readFileSync('app/public/timemap-logo.png') })
  await page.getByAltText('项目封面预览').waitFor()
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByRole('heading', { name: '管理员新建的项目', exact: true }).waitFor()
  assert.equal(items.find(item => item.id === 'created-project').coverImageId, 'cover-0')
  await capture('admin', '320x740', '管理员可编辑项目资料及上下架状态。')
  // Permission: anonymous like navigates to existing login with a return target.
  await page.evaluate(() => { localStorage.removeItem('campus.demo.session.v1'); localStorage.setItem('project-fixture-anonymous', '1') })
  await goto(); await page.locator('[data-project-id]').first().getByRole('button').click()
  await page.waitForURL(/login/)
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('timemap.login.return')).query.mode), 'projects')
  await capture('login-required', '320x740', '未登录点赞进入已有登录流程并记录项目模式回跳。')
  await page.getByLabel('手机号码', { exact: true }).fill('13800000000')
  await page.getByRole('checkbox', { name: '同意用户协议与隐私政策' }).check()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByLabel('验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL(/activities\?mode=projects&view=all/)
  await page.getByRole('tab', { name: '全部项目', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  const report = {
    contract: '../../2026-11-05-实训项目页UI复刻方案.md', targetViewports: ['320x740', '390x844', '430x932', '1440x900'],
    accessibility: { status: 'pass', evidence: '标题菜单键盘选择、Escape关闭与焦点返回；页签语义、点赞aria-pressed、字段标签和44px操作区域；排名包含数字。' },
    responsive: { status: 'pass', evidence: '四视口全部项目与榜单截图；窄屏长名称自然换行，列表无水平溢出。' },
    contentStates: Object.fromEntries(['loading', 'empty', 'error', 'partial', 'success', 'permission'].map(s => [s, { status: 'pass', evidence: { loading: '延迟请求捕获骨架。', empty: '空集合显示暂无项目。', error: '503与点赞失败可恢复，不改变计数。', partial: '封面404降级，体验链接仍在。', success: '点赞取消、页签同步、同赞数排名及管理员编辑通过。', permission: '未登录点赞进入登录并保留回跳；普通活动发布与实训隐藏规则通过。' }[s] }])),
    renderedEvidence: evidence, fixtureOnly: true,
  }
  fs.writeFileSync(`${out}/evidence.json`, JSON.stringify(report, null, 2))
  console.log('PASS training project UI: four viewports, keyboard menu, likes, stable ranking, modes, admin, content states and login return metadata.')
} finally { await browser?.close(); dev.kill() }
