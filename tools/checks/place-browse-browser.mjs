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
const origin = 'http://127.0.0.1:5186'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5186', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath})
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const errors=[]; page.on('pageerror',e=>errors.push(e.message))
  const place='11111111-1111-4111-8111-111111111111'
  const ids=[1,2,3].map(i=>`aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`)
  const posts=ids.map((id,i)=>({id,author:'匿名同学·ABC123',anonymous:true,authorId:null,body:`帖子${i}`,placeId:i<2?place:'other',place:i<2?'测试地点':'其他地点',images:[],createdAt:new Date().toISOString(),likeCount:0,commentCount:0,favoriteCount:0}))
  let browseRequests=0
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    let data={items:[]}
    if(path===`/api/places/${place}`) data={id:place,name:'测试地点',category:'校园地标',enabled:true,description:null,history:null,photos:[],activities:[],posts:[posts[0]],postCount:2}
    else if(path.endsWith('/browse')){browseRequests++;data={ids}}
    else if(path.endsWith('/comments'))data={items:[],total:0}
    else if(posts.some(p=>path===`/api/posts/${p.id}`))data=posts.find(p=>path.endsWith(p.id))
    await route.fulfill({json:data})
  })
  await page.goto(`${origin}/#/poidetail?id=${place}`)
  const loaded=page.waitForResponse(r=>r.url().endsWith('/browse'))
  await page.locator(`[data-pd-post="${ids[0]}"]`).click()
  await page.locator(`.reader[data-feed-id="${ids[0]}"]`).waitFor()
  await loaded
  await page.keyboard.press('ArrowDown')
  await page.locator(`.reader[data-feed-id="${ids[1]}"]`).waitFor()
  await page.keyboard.press('ArrowDown')
  await page.locator(`.reader[data-feed-id="${ids[2]}"]`).waitFor()
  await page.keyboard.press('ArrowUp')
  await page.locator(`.reader[data-feed-id="${ids[1]}"]`).waitFor()
  assert.equal(browseRequests,1)
  await page.getByRole('button',{name:'返回',exact:true}).click()
  await page.locator('[data-pd-post]').first().waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS place-first browser: loads unseen same-place posts, continues to other place, backwards and source return')
} finally {await browser?.close();dev.kill()}
