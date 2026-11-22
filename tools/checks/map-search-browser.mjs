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
const origin = 'http://127.0.0.1:5193'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5193', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath})
  for(const width of [390,320,1024]){
    const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'})
    page.setDefaultTimeout(10000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    const make=(i,name,lat,lng,category='校园地标')=>({id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12,'0')}`,name,latitude:lat,longitude:lng,category,address:'校园中轴路北侧',enabled:true,postCount:0})
    const places=[make(1,'思源碑',39.9503,116.3396),make(2,'第二食堂',39.9504,116.3397,'食堂'),make(3,'线上活动',null,null),make(4,'威海校区',37.5,122.1),make(5,'香山公园',39.99,116.19)]
    let calls=0
    await page.route('**/appmaptile?**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7ebdd"/></svg>'}))
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),path=url.pathname
      let data={items:[]}
      if(path==='/api/places'){calls++;data={items:places.filter(p=>!url.searchParams.get('category')||url.searchParams.get('category').split(',').includes(p.category))}}
      else if(path==='/api/schools')data={items:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',name:'北京交通大学'}]}
      else if(path.startsWith('/api/places/')){const p=places.find(p=>path.endsWith(p.id));data={...p,history:null,description:'校园地标介绍',photos:[],activities:[],posts:[]}}
      await route.fulfill({json:data})
    })
    await page.goto(`${origin}/#/map?raster=1`)
    await page.getByRole('button',{name:'暂时不要',exact:true}).click()
    await page.locator('[data-marker-phase="ready"]').waitFor()
    await page.getByRole('button',{name:'搜索地标',exact:true}).click()
    await page.locator('[data-map-search-state="ready"]').waitFor()
    assert.equal(await page.locator('[data-map-search-result]').count(),2)
    assert.deepEqual(await page.locator('.map__searchName').allTextContents(),['思源碑','第二食堂'])
    const initialCalls=calls
    const input=page.getByRole('textbox',{name:'搜索地标关键词'})
    await input.fill('线上')
    await page.getByText('当前地图范围内没有找到「线上」相关的地标',{exact:true}).waitFor()
    assert.equal(await page.locator('[data-map-search-result]').count(),0)
    await input.fill('中轴路')
    await page.locator('[data-map-search-count="2"]').waitFor()
    assert.equal(calls,initialCalls,'Typing uses current map places instead of querying a global list')
    await input.fill('')
    if(width===390)await page.screenshot({path:'.local/map-search-390.png'})
    await page.getByRole('button',{name:'关闭搜索',exact:true}).click()
    if(width===390){
      await page.locator('.realmaps.leaflet-container').focus()
      for(let i=0;i<8;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(300)}
      await page.getByRole('button',{name:'搜索地标',exact:true}).click()
      await page.locator('[data-map-search-state="ready"][data-map-search-count="0"]').waitFor()
      await page.getByRole('button',{name:'关闭搜索',exact:true}).click()
      await page.locator('.realmaps.leaflet-container').focus()
      for(let i=0;i<8;i++){await page.keyboard.press('ArrowLeft');await page.waitForTimeout(300)}
    }
    await page.getByRole('button',{name:/地标标签/}).click()
    await page.locator('[data-map-tag="食堂"]').click()
    await page.locator('[data-map-tags-apply]').click()
    await page.locator('[data-marker-count="1"]').waitFor()
    await page.getByRole('button',{name:'搜索地标',exact:true}).click()
    await page.locator('[data-map-search-state="ready"]').waitFor()
    assert.deepEqual(await page.locator('.map__searchName').allTextContents(),['第二食堂'])
    await page.locator(`[data-map-search-result="${places[1].id}"]`).click()
    await page.locator('[data-map-search-open]').waitFor({state:'hidden'})
    await page.getByText('第二食堂',{exact:true}).first().waitFor()
    assert.deepEqual(errors,[])
    await page.close()
  }
  console.log('PASS map search browser: only current viewport landmarks, no online/off-campus places, no global requery, address matching, categories and selection; 320/390/1024px')
}finally{await browser?.close();dev.kill()}
