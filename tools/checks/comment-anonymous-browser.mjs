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
const origin = 'http://127.0.0.1:5185'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5185', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ headless: true, executablePath })
  for (const width of [320, 390, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
    const me = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'
    await page.addInitScript(({ me }) => localStorage.setItem('campus.demo.session.v1', JSON.stringify({
      token: 'browser-test-session-token', expiresAt: '2099-01-01', user: { id: me, displayName: '我的昵称', handle: 'test' }
    })), { me })
    const post = { id, author: '匿名同学·A1B2C3', authorId: null, anonymous: true, body: '匿名评论浏览器测试',
      images: [], createdAt: new Date().toISOString(), likeCount: 0, favoriteCount: 0, commentCount: 2 }
    const root = { id: 'cccccccc-cccc-4ccc-8ccc-000000000001', author: '匿名同学·A1B2C3', authorId: null,
      anonymous: true, isPostAuthor: true, isMine: false, body: '楼主的评论', createdAt: new Date().toISOString(), parentId: null, replyTo: null, replies: [] }
    const own = { ...root, id: 'cccccccc-cccc-4ccc-8ccc-000000000002', author: '匿名同学 01',
      isPostAuthor: false, isMine: true, body: '我的匿名评论', replies: [] }
    const items = [root, own]
    let failSend = true, submitted
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      let data = { items: [] }
      if (path === `/api/posts/${id}`) data = post
      else if (path === `/api/posts/${id}/comments`) {
        if (req.method() === 'POST') {
          submitted = req.postDataJSON()
          if (failSend) { await route.fulfill({ status: 400, json: { error: 'invalid_payload' } }); return }
          data = { ...own, id: 'cccccccc-cccc-4ccc-8ccc-000000000003', body: submitted.body,
            parentId: submitted.parentId, replyTo: root.author }
          root.replies.push(data)
        } else data = { items, total: 2 + root.replies.length }
      } else if (path.startsWith('/api/comments/') && req.method() === 'DELETE') {
        const index = items.findIndex(c => c.id === path.split('/').at(-1))
        if (index >= 0) items.splice(index, 1)
        data = { removed: true }
      }
      await route.fulfill({ json: data })
    })
    await page.goto(`${origin}/#/feed?id=${id}`)
    await page.getByRole('button', { name: '评论', exact: true }).click()
    await page.getByRole('switch', { name: '匿名评论' }).click()
    await page.locator(`[data-comment-id="${root.id}"]`).getByRole('button', { name: '回复', exact: true }).click()
    const textarea = page.getByRole('textbox', { name: '回复 匿名同学·A1B2C3', exact: true })
    await textarea.fill('匿名回复测试')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '评论失败' }).waitFor()
    assert.equal(await textarea.inputValue(), '匿名回复测试')
    assert.equal(submitted.parentId, root.id)
    assert.equal(submitted.anonymous, true)
    failSend = false
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByRole('button', { name: '取消回复', exact: true }).waitFor({ state: 'hidden' })
    await page.locator(`[data-comment-id="cccccccc-cccc-4ccc-8ccc-000000000003"]`).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '写下你的评论', exact: true }).inputValue(), '')
    assert.equal(await page.locator('.reader__replyTo').last().textContent(), '回复 匿名同学·A1B2C3')
    assert.equal(await page.locator('.reader__authorBadge').count(), 1)
    assert.equal(await page.locator(`[data-comment-delete="${own.id}"]`).count(), 1)
    const overflow = await page.locator('.reader__sheet').evaluate(el => el.scrollWidth > el.clientWidth + 1)
    assert.equal(overflow, false)
    if (width === 390) await page.screenshot({ path: '.local/anonymous-comments-390.png' })
    await page.locator(`[data-comment-delete="${own.id}"]`).click()
    await page.getByRole('alert').getByRole('button', { name: '删除', exact: true }).click()
    await page.locator(`[data-comment-id="${own.id}"]`).waitFor({ state: 'hidden' })
    // Anonymous post owners cannot accidentally switch their comments to real-name mode.
    post.authorId = me
    await page.reload()
    await page.getByRole('button', { name: '评论', exact: true }).click()
    const toggle = page.getByRole('switch', { name: '匿名评论' })
    assert.equal(await toggle.getAttribute('aria-checked'), 'true')
    assert.equal(await toggle.isDisabled(), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS anonymous comments browser: reply targets, anonymous request, failed draft retention, own deletion, forced owner anonymity; 320/390/1024px')
} finally {
  await browser?.close()
  dev.kill()
}
