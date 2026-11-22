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
const origin = 'http://127.0.0.1:5183'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5183', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ headless: true, executablePath })
  for (const width of [390, 320, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true })
    page.setDefaultTimeout(10000)
    const errors = [], userRequests = []
    page.on('pageerror', error => errors.push(error.message))
    const authors = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const avatars = ['dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000002']
    const posts = Array.from({ length: 4 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${index + 1}`,
      authorId: index < 2 ? authors[index] : index === 2 ? authors[0] : null,
      author: index === 2 ? '匿名同学' : index === 3 ? '历史作者' : `作者${index + 1}`,
      anonymous: index === 2, body: `测试帖子${index + 1}`, images: [],
      createdAt: new Date().toISOString(), likeCount: 0, commentCount: 0, favoriteCount: 0,
    }))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname
      if (path.startsWith('/api/media/')) {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>' })
        return
      }
      let data = { items: [] }
      if (path === '/api/posts') data = { items: url.searchParams.has('authorId') ? posts.filter(post => post.authorId === url.searchParams.get('authorId') && !post.anonymous) : posts }
      else if (posts.some(post => path === `/api/posts/${post.id}`)) data = posts.find(post => path.endsWith(post.id))
      else if (path.startsWith('/api/users/')) {
        const id = path.split('/').at(-1)
        userRequests.push(id)
        data = { id, displayName: `作者${authors.indexOf(id) + 1}`, avatarMediaId: avatars[authors.indexOf(id)] }
      }
      await route.fulfill({ json: data })
    })
    await page.goto(`${origin}/#/campus`)
    try {
      await page.locator(`[data-feed-id="${posts[0].id}"] .square-card__open`).click()
    } catch (error) {
      console.error({ url: page.url(), body: await page.locator('body').innerText(), errors })
      throw error
    }
    await page.locator('[data-reader-author]').waitFor()
    await page.locator('[data-reader-author] img').click()
    await page.locator('[data-user-state="ready"]').waitFor()
    assert.equal(new URL(page.url().replace('#/', '')).searchParams.get('id'), authors[0])
    assert.equal(await page.locator('.up__name').textContent(), '作者1')
    assert((await page.locator('[data-user-avatar]').getAttribute('src')).includes(avatars[0]))
    avatars[0] = 'dddddddd-dddd-4ddd-8ddd-000000000003'
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.locator('[data-reader-author]').waitFor()
    await page.locator('[data-reader-author] img').click()
    await page.locator('[data-user-state="ready"]').waitFor()
    assert((await page.locator('[data-user-avatar]').getAttribute('src')).includes(avatars[0]))
    avatars[0] = null
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.locator('[data-reader-author]').waitFor()
    await page.locator('[data-reader-author] img').click()
    await page.locator('[data-user-state="ready"]').waitFor()
    assert.equal(await page.locator('[data-user-avatar]').count(), 0)
    assert.equal(await page.locator('[data-user-avatar-placeholder]').textContent(), '作')

    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.locator('[data-reader-author]').waitFor()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('button', { name: '查看作者2的主页', exact: true }).waitFor()
    await page.locator('[data-reader-author] .reader__author').click()
    await page.locator('[data-user-state="ready"]').waitFor()
    assert.equal(await page.locator('.up__name').textContent(), '作者2')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('button', { name: '查看作者2的主页', exact: true }).waitFor()
    // The same semantic button must also work without a pointer.
    await page.locator('[data-reader-author]').focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-user-state="ready"]').waitFor()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.locator('[data-reader-author]').waitFor()
    for (const index of [2, 3]) {
      await page.keyboard.press('ArrowDown')
      await page.locator(`.reader[data-feed-id="${posts[index].id}"]`).waitFor()
      assert.equal(await page.locator('[data-reader-author]').count(), 0)
      await page.locator('.reader__identity').click()
      assert(page.url().includes('#/feed?'))
    }
    assert.deepEqual(userRequests, [authors[0], authors[0], authors[0], authors[1], authors[1]])
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS post author: avatar/name/keyboard navigation, switched author, back restoration, anonymous and legacy posts; 320/390/1024px')
} finally {
  await browser?.close()
  dev.kill()
}
