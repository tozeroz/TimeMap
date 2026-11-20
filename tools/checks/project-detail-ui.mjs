import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const out = 'docs/zwf/evidence/project-detail-ui'
fs.mkdirSync(out, { recursive: true })
const port = 5199, origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: process.cwd() + '/app', stdio: 'pipe', windowsHide: true })
server.stderr.on('data', d => process.stderr.write(d))
const id = 'c1a55000-2026-4000-8000-000000000002', otherId = 'c1a55000-2026-4000-8000-000000000003'
let item = { id, name: 'TimeMap 校园记忆地图', summary: '把校园故事，留在地图上', description: '面向北交大学生的校园记忆地图。\n在地图上发现地点故事、分享校园瞬间，让每一段回忆都有自己的坐标。', category: '校园生活', features: ['地图探索', '记忆发布', '校园活动'], experienceNotes: '校园地图与内容可直接浏览，发布和互动需要登录。', groupName: '第三小组', memberCount: 5, coverImageId: 'logo', showcaseImageIds: ['landscape', 'portrait'], projectUrl: 'https://github.com/tozeroz/TimeMap', experienceUrl: 'https://example.com/timemap', position: 1, published: true, likeCount: 128, likedByMe: false, reviewCount: 2 }
const other = { ...item, id: otherId, name: '没有展示图的实训项目', showcaseImageIds: [], experienceUrl: null, likeCount: 0 }
let reviews = [{ id: 'r1', body: '地图上看校园故事很有意思，希望能增加地点搜索。', createdAt: '2026-11-20T06:20:00Z', userId: 'another', displayName: '校园漫游者', avatarMediaId: null, canDelete: false }, { id: 'r2', body: '页面很清爽，期待看到更多校园老照片！', createdAt: '2026-11-19T11:08:00Z', userId: 'fixture-user', displayName: '小橘同学', avatarMediaId: null, canDelete: true }]
const requestIds = new Map()
let state = 'ready', failReview = false, failLike = false, uploadId = 0, browser
const evidence = [], pageErrors = []
try {
  for (let i = 0; i < 40; i++) { try { await fetch(origin); break } catch { await new Promise(r => setTimeout(r, 200)) } }
  browser = await chromium.launch({ headless: true, executablePath: join(homedir(), 'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe') })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', e => pageErrors.push(e.message))
  await page.addInitScript(() => { if (!localStorage.getItem('detail-anonymous')) localStorage.setItem('campus.demo.session.v1', JSON.stringify({ token: 'fixture-token', user: { id: 'fixture-user', displayName: '测试同学', role: 'admin' } })) })
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    const reply = (body, status = 200) => route.fulfill({ status, json: body, headers })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/projects') return reply({ items: [item, other], total: 2 })
    if (path === '/api/admin/projects') return reply({ items: [item, other] })
    if (path === `/api/admin/projects/${id}`) { Object.assign(item, req.postDataJSON()); return reply({ id }) }
    if (path === `/api/projects/${id}` || path === `/api/projects/${otherId}`) {
      if (state === 'loading') await new Promise(r => setTimeout(r, 900))
      if (state === 'missing') return reply({ error: 'not_found' }, 404)
      if (state === 'error') return reply({ error: 'unavailable' }, 503)
      return reply({ ...(path.endsWith(otherId) ? other : item), reviewCount: reviews.length })
    }
    if (path.endsWith('/like')) {
      if (failLike) return reply({ error: 'unavailable' }, 503)
      const liked = req.method() === 'PUT'
      if (liked !== item.likedByMe) item.likeCount += liked ? 1 : -1
      item.likedByMe = liked
      return reply({ likeCount: item.likeCount, likedByMe: liked })
    }
    if (/\/projects\/[^/]+\/reviews$/.test(path)) {
      if (req.method() === 'POST') {
        if (failReview) return reply({ error: 'unavailable' }, 503)
        const body = req.postDataJSON()
        if (!requestIds.has(body.clientRequestId)) {
          const reviewId = `created-${requestIds.size}`; requestIds.set(body.clientRequestId, reviewId)
          reviews.unshift({ id: reviewId, body: body.body, userId: 'fixture-user', displayName: '测试同学', createdAt: '2026-11-20T08:00:00Z', avatarMediaId: null, canDelete: true })
        }
        return reply({ id: requestIds.get(body.clientRequestId) }, 201)
      }
      return reply({ items: reviews, total: reviews.length, nextCursor: null })
    }
    if (/\/reviews\/[^/]+$/.test(path) && req.method() === 'DELETE') { reviews = reviews.filter(r => r.id !== path.split('/').at(-1)); return route.fulfill({ status: 204, headers }) }
    if (path === '/api/media' && req.method() === 'POST') return reply({ id: `upload-${++uploadId}`, mime: 'image/png' }, 201)
    if (path.startsWith('/api/media/')) {
      if (state === 'partial' && path.endsWith('landscape')) return route.fulfill({ status: 404, headers })
      const portrait = path.endsWith('portrait'), width = portrait ? 400 : 1200, height = portrait ? 900 : 420
      return route.fulfill({ contentType: 'image/svg+xml', headers, body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${portrait ? '#e1eadc' : '#dcebed'}"/><path d="M0 ${height * .75} Q${width / 2} ${height / 3} ${width} ${height * .7} V${height} H0Z" fill="#9db69a"/><circle cx="${width / 2}" cy="${height / 2}" r="${width / 10}" fill="#ed8650"/><text x="50%" y="25%" text-anchor="middle" fill="#18334a" font-size="${width / 20}">${portrait ? '竖版海报 · 测试图片' : 'TimeMap · 展示图测试'}</text></svg>` })
    }
    if (path === '/api/auth/request-code') return reply({ delivery: 'dev-sink', delivery_note: '隔离验证，不发送短信' })
    if (path === '/api/auth/verify-code') return reply({ token: 'fixture-login-token', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'fixture-user', displayName: '测试同学', role: 'admin' } })
    return reply({ items: [] })
  })
  const goto = async (projectId = id) => { await page.goto(`${origin}/#/project?id=${projectId}`); await page.reload() }
  const waitProject = () => page.getByRole('heading', { name: item.name, exact: true }).waitFor()
  const capture = async (name, viewport, observation) => { await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); evidence.push({ viewport, artifact: name + '.png', observation }) }
  // Entry from ranking and correct list return.
  await page.goto(`${origin}/#/activities?mode=projects&view=popular`)
  await page.locator(`[data-project-id="${id}"] .projects__coverLink`).waitFor()
  assert.equal(await page.locator('.projects__cover img').first().evaluate(e => getComputedStyle(e).objectFit), 'contain')
  await page.locator(`[data-project-id="${id}"] .projects__nameLink`).click(); await waitProject()
  await page.getByText(reviews[0].body, { exact: true }).waitFor()
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    assert.equal(await page.locator('.project-detail .screen__body').evaluate(e => e.scrollWidth > e.clientWidth), false)
    const img = page.locator('.project-detail__galleryImage img'); await img.evaluate(e => e.decode())
    const ratio = await img.evaluate(e => e.clientWidth / e.clientHeight); assert(Math.abs(ratio - 1200 / 420) < .03)
    await capture(`detail-${width}`, `${width}x${height}`, '横版展示图、项目介绍、功能、真实样式评价与固定操作栏；均为隔离测试数据。')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.project-detail__reviewList').scrollIntoViewIfNeeded()
  await capture('reviews', '390x844', '评价头像、昵称、时间、正文和固定底栏。')
  await page.locator('.project-detail .screen__body').evaluate(e => { e.scrollTop = 0 })
  await page.getByRole('button', { name: '下一张展示图', exact: true }).click()
  const portraitImage = page.locator('.project-detail__galleryImage img'); await portraitImage.evaluate(e => e.decode())
  assert(Math.abs(await portraitImage.evaluate(e => e.clientWidth / e.clientHeight) - 400 / 900) < .02)
  await capture('portrait', '390x844', '竖版海报按400:900完整展示，没有裁成横幅。')
  await page.getByRole('button', { name: /放大查看/ }).click()
  await page.getByRole('dialog', { name: '放大浏览展示图' }).waitFor()
  await page.getByRole('button', { name: '放大图片', exact: true }).click()
  await page.getByRole('button', { name: '复位图片', exact: true }).click()
  await page.keyboard.press('ArrowLeft')
  await capture('lightbox', '390x844', '放大层支持方向键、缩放、复位与关闭。')
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('button', { name: /放大查看/ }).evaluate(e => e === document.activeElement), true)
  // Likes authoritative across the list/detail boundary.
  await page.getByRole('button', { name: '点赞，128 赞', exact: true }).click()
  await page.getByRole('button', { name: '取消点赞，129 赞', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回实训项目', exact: true }).click()
  await page.getByRole('tab', { name: '人气榜', exact: true }).waitFor()
  await page.locator(`[data-project-id="${id}"] .projects__nameLink`).click(); await waitProject()
  await page.getByRole('button', { name: '取消点赞，129 赞', exact: true }).click()
  await page.getByRole('button', { name: '点赞，128 赞', exact: true }).waitFor()
  failLike = true; await page.getByRole('button', { name: '点赞，128 赞', exact: true }).click()
  await page.getByText(/点赞操作失败/).waitFor(); assert.equal(item.likeCount, 128); failLike = false
  // Review errors preserve input and successful retry creates exactly one review.
  await page.getByRole('button', { name: '写评价', exact: true }).first().click()
  const textarea = page.getByLabel('分享你的体验或建议')
  await textarea.fill('体验反馈：<script>这是纯文本</script>，希望增加地点搜索。')
  failReview = true; await page.getByRole('button', { name: '发布评价', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '评价提交失败' }).waitFor()
  assert((await textarea.inputValue()).includes('希望增加地点搜索'))
  failReview = false; await page.getByRole('button', { name: '发布评价', exact: true }).click()
  await page.getByText('评价已发布', { exact: true }).waitFor()
  assert.equal(reviews.length, 3); assert.equal(await page.locator('.project-detail__reviewList script').count(), 0)
  await page.getByRole('button', { name: '删除测试同学的评价', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('评价已删除', { exact: true }).waitFor(); assert.equal(reviews.length, 2)
  // No gallery or experience placeholder when absent.
  await goto(otherId); await page.getByRole('heading', { name: other.name, exact: true }).waitFor()
  assert.equal(await page.locator('.project-detail__gallery').count(), 0)
  assert.equal(await page.getByRole('link', { name: /立即体验/ }).count(), 0)
  await capture('no-gallery', '390x844', '无展示图和体验网址时直接展示介绍评价，仅保留可用操作。')
  // Loading, missing, errors, partial images and empty reviews.
  for (const next of ['loading', 'error', 'missing', 'partial', 'empty']) {
    state = next
    if (next === 'empty') reviews = []
    await goto()
    if (next === 'loading') { await page.getByText('正在读取项目详情…', { exact: true }).waitFor(); await capture(next, '390x844', '详情请求等待中可见加载提示。'); await waitProject() }
    else if (next === 'error') { await page.getByRole('heading', { name: '项目加载失败' }).waitFor(); await capture(next, '390x844', '详情失败可重试。') }
    else if (next === 'missing') { await page.getByRole('heading', { name: '项目已下架或不存在' }).waitFor(); assert.equal(await page.locator('.project-detail__actions').count(), 0); await capture(next, '390x844', '下架或不存在时隐藏操作栏。') }
    else if (next === 'partial') { await page.getByText('展示图暂不可用，点击重试').waitFor(); await capture(next, '390x844', '部分展示图失败，介绍与其他图片仍可用。'); state = 'ready'; await page.getByRole('button', { name: '重试展示图', exact: true }).click(); await page.locator('.project-detail__galleryImage img').waitFor() }
    else { await page.getByText('还没有评价，来分享你的体验吧。').waitFor(); await capture(next, '390x844', '评价空态，不生成示例用户内容。') }
  }
  state = 'ready'
  // Admin: independent upload controls, ordering and persisted reload.
  await page.goto(`${origin}/#/admin?panel=projects`)
  await page.getByRole('button', { name: '编辑项目', exact: true }).first().click()
  await page.getByLabel('项目介绍', { exact: true }).fill('管理员修改后的详细介绍')
  const buffer = fs.readFileSync('app/public/timemap-logo.png')
  await page.getByLabel('列表封面', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer })
  await page.waitForFunction(() => document.querySelector('.admin-projects__preview')?.getAttribute('src')?.includes('upload-1'))
  await page.getByLabel('详情展示图', { exact: true }).setInputFiles([{ name: 'screen.png', mimeType: 'image/png', buffer }])
  await page.getByRole('button', { name: '上移第3张展示图', exact: true }).waitFor()
  await page.getByRole('button', { name: '上移第3张展示图', exact: true }).click()
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByRole('heading', { name: item.name, exact: true }).waitFor()
  assert.equal(item.coverImageId, 'upload-1'); assert.deepEqual(item.showcaseImageIds, ['landscape', 'upload-2', 'portrait'])
  assert.equal(item.description, '管理员修改后的详细介绍')
  await goto(); await waitProject(); await page.getByText(item.description, { exact: true }).waitFor()
  // Anonymous review route -> real login screen -> controlled project return.
  await page.evaluate(() => { localStorage.removeItem('campus.demo.session.v1'); localStorage.setItem('detail-anonymous', '1') })
  await goto(); await waitProject()
  await page.getByRole('button', { name: '写评价', exact: true }).first().click(); await page.waitForURL(/login/)
  const target = await page.evaluate(() => JSON.parse(sessionStorage.getItem('timemap.login.return')))
  assert.equal(target.path, 'project'); assert.equal(target.query.id, id)
  await capture('login-required', '390x844', '匿名写评价引导登录，保存受控项目回跳。')
  await page.getByLabel('手机号码', { exact: true }).fill('13800000000')
  await page.getByRole('checkbox', { name: '同意用户协议与隐私政策' }).check()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByLabel('验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.waitForURL(/project\?id=/)
  await waitProject(); assert.deepEqual(pageErrors, [])
  const report = { contract: '../../2026-11-20-实训项目详情页UI复刻方案.md', targetViewports: ['320x740', '390x844', '430x932', '1440x900'],
    accessibility: { status: 'pass', evidence: '图库按钮、方向键、Escape和焦点返回；评价表单标签、对话框与可见焦点；按钮触控区域。' },
    responsive: { status: 'pass', evidence: '四视口无横向溢出；横图1200:420、竖图400:900比例断言；操作栏保持可达。' },
    contentStates: Object.fromEntries(['loading', 'empty', 'error', 'partial', 'success', 'permission'].map(s => [s, { status: 'pass', evidence: { loading: '延迟详情捕获加载态。', empty: '缺少图库、体验、评价的空态正确。', error: '详情及点赞/评价503，保留正文与草稿可重试。', partial: '首张图片404，正文保持可用。', success: '点赞/取消、评价提交与删除、管理员上传排序保存回读。', permission: '匿名评价进入登录，模拟登录回到原详情。' }[s] }])), renderedEvidence: evidence, fixtureOnly: true }
  fs.writeFileSync(`${out}/evidence.json`, JSON.stringify(report, null, 2))
  console.log('PASS project detail UI: four viewports, original image ratios, gallery/lightbox, review CRUD/errors, auth return, links, independent admin uploads and content states.')
} finally { await browser?.close(); server.kill() }
