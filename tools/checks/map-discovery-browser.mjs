// Deterministic browser fixtures: no production API calls or data writes.
import assert from 'node:assert/strict'
import {homedir} from 'node:os'
import {existsSync,readdirSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const require=createRequire(import.meta.url)
const bundled=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||(existsSync(bundled)?bundled:'playwright'))
const root=join(homedir(),'AppData/Local/ms-playwright')
const installed=readdirSync(root).filter(n=>/^chromium-/.test(n)).sort().reverse()[0]
const origin='http://127.0.0.1:5191'
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5191','--strictPort'],{cwd:'app',windowsHide:true,stdio:'ignore'})
const tile='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eedf"/><path d="M0 80H256M90 0V256" stroke="#fffdf7" stroke-width="16"/><path d="M0 82H256M92 0V256" stroke="#dcd8cd" stroke-width="1"/><g fill="#cddde6"><rect x="14" y="12" width="57" height="45"/><rect x="120" y="12" width="97" height="45"/><rect x="125" y="115" width="90" height="110"/></g><text x="5" y="250" font-size="9" fill="#66756d">布局测试瓦片</text></svg>'
const photo='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="320" height="220" fill="#ead7a6"/><path d="M100 220 150 70H170L220 220Z" fill="#f7f0d9"/><g stroke="#79603b" stroke-width="9"><path d="M45 220V55m230 165V55M90 220V30M235 220V30"/></g><g fill="#d5a647"><circle cx="40" cy="40" r="44"/><circle cx="95" cy="30" r="39"/><circle cx="240" cy="30" r="39"/><circle cx="280" cy="45" r="44"/></g><text x="10" y="205" font-size="13" fill="#795d30">测试封面</text></svg>'
let browser,page
try{
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||join(root,installed,'chrome-win64/chrome.exe')})
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
  page=await context.newPage();page.setDefaultTimeout(10000)
  const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message))
  const places=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',name:'银杏大道',latitude:39.9503,longitude:116.3396,category:'校园地标',enabled:true,description:'校园里的银杏步道',postCount:45,updatedAt:new Date().toISOString(),coverMediaId:'cover'},
    {id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',name:'思源碑',latitude:39.9504,longitude:116.3397,category:'校园地标',enabled:true,description:'留住校园记忆',postCount:0,updatedAt:null,coverMediaId:null}]
  const posts=Array.from({length:45},(_,i)=>({id:`bbbbbbbb-bbbb-4bbb-8bbb-${String(i+1).padStart(12,'0')}`,author:i===1?'匿名同学':'小林',authorId:null,anonymous:i===1,authorAvatarMediaId:null,body:i===0?'银杏大道的秋天到了，一起记录校园的颜色':i===1?'午后的校园，值得慢慢走一走':`校园里的第 ${i+1} 条记忆`,place:'银杏大道',placeId:places[0].id,placeLat:places[0].latitude,placeLng:places[0].longitude,createdAt:new Date(Date.now()-i*3600000).toISOString(),images:i%2===0?[{id:'cover',width:320,height:220}]:[],likeCount:i===0?12:8,commentCount:0}))
  let fail=false,empty=false,failMore=false,slowPhotos=false
  const calls=[]
  await page.route('**/appmaptile?**',r=>r.fulfill({contentType:'image/svg+xml',body:tile}))
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url()),path=u.pathname
    let data={items:[]}
    if(path.startsWith('/api/media/'))return route.fulfill({contentType:'image/svg+xml',body:photo})
    if(path==='/api/map/discover'){
      calls.push(Object.fromEntries(u.searchParams))
      if(fail)return route.fulfill({status:503,json:{error:'not_ready'}})
      const filter=u.searchParams.get('filter'),cursor=u.searchParams.get('cursor')
      if(slowPhotos&&filter==='photos')await new Promise(r=>setTimeout(r,450))
      if(cursor&&failMore){failMore=false;return route.fulfill({status:503,json:{error:'not_ready'}})}
      let found=posts.filter(p=>filter!=='photos'||p.images.length)
      if(u.searchParams.get('q'))found=found.filter(p=>p.body.includes(u.searchParams.get('q')))
      if(empty)found=[]
      const offset=Number(cursor||0)
      data={asOf:new Date().toISOString(),total:found.length,items:found.slice(offset,offset+20),nextCursor:offset+20<found.length?String(offset+20):null,places:filter==='all'||!filter?places:[{...places[0],postCount:found.length}],placesTruncated:false}
    }else if(path==='/api/places')data={items:u.searchParams.get('q')?places.filter(p=>p.name.includes(u.searchParams.get('q'))):places}
    else if(path==='/api/schools')data={items:[{id:'cccccccc-cccc-4ccc-8ccc-000000000001',name:'北京交通大学'}]}
    else if(path.startsWith('/api/places/'))data={...places[0],history:null,photos:[],activities:[],posts:posts.slice(0,3)}
    else if(path.startsWith('/api/posts/'))data=path.endsWith('/comments')?{items:[],total:0}:posts.find(p=>p.id===path.split('/')[3])||{items:[]}
    await route.fulfill({json:data})
  })
  const ready=()=>page.locator('[data-discovery-phase="ready"]').waitFor()
  await page.goto(`${origin}/#/map?raster=1`)
  await page.getByRole('button',{name:'暂时不要',exact:true}).click();await ready()
  await page.locator('.realmaps[data-map-instance]').waitFor()
  assert.equal(await page.locator('.md-card').count(),20)
  assert.equal(await page.getByRole('button',{name:'校园故事',exact:true}).count(),0)
  const overflow=async()=>assert(await page.locator('.map-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'map horizontal overflow')
  await overflow();mkdirSync('docs/ui/assets',{recursive:true})
  await page.screenshot({path:'docs/ui/assets/map-discovery-implemented-390.png'})
  await page.locator('.rm--cluster[data-cluster-count="2"]').waitFor()
  await page.getByRole('button',{name:'2个地点，放大查看',exact:true}).click()
  await page.waitForFunction(()=>Number(document.querySelector('.map')?.getAttribute('data-map-zoom'))>=18)
  await page.getByRole('button',{name:'有图记录',exact:true}).click();await ready()
  assert(calls.at(-1).filter==='photos')
  assert.equal(await page.locator('.md-card').count(),20)
  failMore=true
  await page.getByRole('button',{name:'加载更多记录',exact:true}).click()
  await page.getByRole('button',{name:'加载更多失败，点击重试',exact:true}).click()
  await page.getByText('已看完当前范围的 23 条记录',{exact:true}).waitFor()
  assert.equal(await page.locator('.md-card').count(),23)
  slowPhotos=true
  const pendingPhoto=page.waitForRequest(request=>request.url().includes('/api/map/discover')&&new URL(request.url()).searchParams.get('filter')==='photos')
  await page.getByRole('button',{name:'全部',exact:true}).click();await ready()
  await page.getByRole('button',{name:'有图记录',exact:true}).click();await pendingPhoto
  await page.getByRole('button',{name:'最近更新',exact:true}).click();await ready()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.md-card').nth(1).getAttribute('data-discovery-post'),posts[1].id,'stale photo response must not replace recent results')
  assert.equal(calls.at(-1).filter,'recent')
  await page.getByRole('button',{name:'附近热门',exact:true}).click();await ready();assert.equal(calls.at(-1).sort,'hot')
  await page.getByRole('button',{name:'全部',exact:true}).click();await ready()
  await page.locator('.md-cardPlace').first().click();await ready();await page.locator('.md-place').waitFor()
  assert.match(await page.locator('.md-place').innerText(),/45 条校园记录/)
  await page.locator('.rm--selected:not(.rm--cluster)').waitFor()
  await page.screenshot({path:'docs/ui/assets/map-discovery-selected.png'})
  await page.getByRole('button',{name:'返回当前范围',exact:true}).click();await ready()
  await page.getByRole('button',{name:'加载更多记录',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.md-card').length===40)
  await page.getByRole('button',{name:'展开内容面板',exact:true}).click()
  await page.getByRole('button',{name:'最小化内容面板',exact:true}).click()
  await page.locator('[data-discovery-detent="collapsed"]').waitFor()
  await page.getByRole('button',{name:'展开内容面板',exact:true}).click()
  await page.locator('[data-discovery-detent="half"]').waitFor()
  await page.getByRole('button',{name:'展开内容面板',exact:true}).click()
  await page.locator('[data-discovery-detent="expanded"]').waitFor()
  await page.locator('.md-list').evaluate(el=>el.scrollTop=200)
  const before=await page.locator('.md-list').evaluate(el=>el.scrollTop)
  await page.locator('.md-cardOpen').nth(25).click();await page.locator('.reader').waitFor()
  await page.getByRole('button',{name:'返回',exact:true}).click();await ready()
  assert.equal(await page.locator('.md-sheet').getAttribute('data-discovery-detent'),'expanded')
  assert.equal(await page.locator('.md-card').count(),40,'restores previously loaded pages')
  assert(await page.locator('.md-list').evaluate(el=>el.scrollTop)>before-60,'restored list scroll')
  await page.getByLabel('搜索地点和校园记录',{exact:true}).fill('银杏')
  await page.locator('.md-results .md-result').first().waitFor()
  assert.match(await page.locator('.md-results').innerText(),/地点/);assert.match(await page.locator('.md-results').innerText(),/校园记录/)
  await page.getByRole('button',{name:'关闭搜索',exact:true}).click()
  await page.getByRole('button',{name:'收起内容面板',exact:true}).click()
  await page.locator('[data-discovery-detent="half"]').waitFor()
  const grip=await page.locator('.md-grip').boundingBox()
  await page.mouse.move(grip.x+80,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x+80,grip.y+90,{steps:6});await page.mouse.up()
  await page.locator('[data-discovery-detent="collapsed"]').waitFor()
  await page.getByRole('button',{name:'展开内容面板',exact:true}).click()
  const box=await page.locator('.map').boundingBox()
  await page.mouse.move(box.x+70,box.y+160);await page.mouse.down();await page.mouse.move(box.x+115,box.y+180,{steps:8});await page.mouse.up()
  await page.getByRole('button',{name:'搜索这片区域',exact:true}).click();await ready();assert(calls.at(-1).bounds)
  for(const viewport of [{width:375,height:812},{width:430,height:932},{width:844,height:390}]){
    await page.setViewportSize(viewport);await overflow();await page.screenshot({path:`docs/ui/assets/map-discovery-implemented-${viewport.width}.png`})
  }
  await page.setViewportSize({width:390,height:844})
  empty=true;await page.getByRole('button',{name:'最近更新',exact:true}).click();await ready()
  await page.getByText('当前范围暂无符合筛选的记录',{exact:true}).waitFor()
  empty=false;fail=true;await page.getByRole('button',{name:'全部',exact:true}).click()
  await page.getByText('内容加载失败，地图仍可浏览',{exact:true}).waitFor()
  assert(await page.locator('.realmaps').count())
  fail=false;await page.locator('.md-sheet').getByRole('button',{name:'重试',exact:true}).click();await ready()
  await page.evaluate(()=>document.documentElement.style.zoom='1.5');await overflow();await page.evaluate(()=>document.documentElement.style.zoom='')
  await page.emulateMedia({reducedMotion:'no-preference'})
  const motionBox=await page.locator('.map').boundingBox()
  await page.mouse.move(motionBox.x+70,motionBox.y+50);await page.mouse.wheel(0,-350)
  await page.getByRole('button',{name:'有图记录',exact:true}).click();await ready()
  await page.getByRole('button',{name:'全部',exact:true}).click();await ready()
  await page.waitForTimeout(700)
  assert.deepEqual(errors,[])
  console.log('PASS map discovery browser: filters, range, search groups, selection, pagination retry, panel dragging, post return restore, empty/error, responsive screenshots and enlarged text')
}catch(error){console.error(await page?.evaluate(()=>({snapshot:sessionStorage.getItem('timemap.map-discovery.v1'),scroll:document.querySelector('.md-list')?.scrollTop})).catch(()=>null));await page?.screenshot({path:'.local/map-discovery-failure.png'}).catch(()=>{});throw error}finally{await browser?.close();dev.kill()}
