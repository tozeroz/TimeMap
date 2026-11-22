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
const origin = 'http://127.0.0.1:5188'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5188', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath})
  for (const mode of ['grid','reader']) {
    const page=await browser.newPage({viewport:{width:390,height:844}})
    page.setDefaultTimeout(10000)
    const errors=[]; page.on('pageerror',e=>errors.push(e.message))
    const posts=Array.from({length:53},(_,i)=>({id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`,author:'测试作者',authorId:null,body:`分页回忆${i+1}`,images:[],createdAt:new Date().toISOString(),likeCount:0,commentCount:0,favoriteCount:0}))
    let tailCalls=0
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),path=url.pathname
      let data={items:[]}
      if(path==='/api/posts') {
        if(url.searchParams.has('cursor')) {tailCalls++;if(mode==='grid' && tailCalls===1){await route.fulfill({status:503,json:{error:'not_ready'}});return}data={items:posts.slice(50),nextCursor:null}}
        else data={items:posts.slice(0,50),nextCursor:'tail'}
      } else if(path.endsWith('/comments'))data={items:[],total:0}
      else if(posts.some(p=>path===`/api/posts/${p.id}`))data=posts.find(p=>path.endsWith(p.id))
      await route.fulfill({json:data})
    })
    await page.goto(`${origin}/#/campus`)
    await page.locator('[data-campus-phase="ready"][data-campus-count="50"]').waitFor()
    if(mode==='grid') {
      await page.getByRole('button',{name:'加载更多回忆',exact:true}).scrollIntoViewIfNeeded()
      await page.getByRole('button',{name:'更多回忆加载失败，请重试',exact:true}).click()
      await page.locator('[data-campus-count="53"]').waitFor()
      await page.getByText('已看完全部回忆',{exact:true}).waitFor()
      assert.equal(await page.locator('.square-card__open').count(),53)
    } else {
      await page.locator(`[data-feed-id="${posts[0].id}"] .square-card__open`).click()
      await page.locator(`.reader[data-feed-id="${posts[0].id}"]`).waitFor()
      // Jump through the initial page without scrolling the grid and fetching it first.
      for(let i=1;i<53;i++) {
        await page.keyboard.press('ArrowDown')
        await page.locator(`.reader[data-feed-id="${posts[i].id}"]`).waitFor()
      }
      await page.getByRole('button',{name:'返回',exact:true}).click()
      await page.locator('[data-campus-count="53"]').waitFor()
    }
    assert.equal(tailCalls,mode==='grid'?2:1)
    assert.deepEqual(errors,[])
    await page.close()
  }
  console.log('PASS square pagination: grid loads next page, reader crosses 50-post boundary, source restores all loaded posts, no duplicates or extra requests')
} finally {await browser?.close();dev.kill()}
