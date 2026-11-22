// API/media/tile fixtures only; never writes production data.
import assert from 'node:assert/strict'
import {homedir} from 'node:os'
import {existsSync,readdirSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
const require=createRequire(import.meta.url)
const bundled=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const {chromium}=require(existsSync(bundled)?bundled:'playwright')
const root=join(homedir(),'AppData/Local/ms-playwright'),version=readdirSync(root).filter(n=>/^chromium-/.test(n)).sort().reverse()[0]
const origin='http://127.0.0.1:5192'
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5192','--strictPort'],{cwd:'app',windowsHide:true,stdio:'ignore'})
let browser,page
const tile='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e3edda"/><path d="M0 80H256M90 0V256" stroke="#fffdf7" stroke-width="14"/><g fill="#cfdee6"><rect x="10" y="12" width="60" height="45"/><rect x="125" y="112" width="90" height="110"/></g><text x="5" y="250" font-size="9" fill="#657264">布局测试瓦片</text></svg>'
try{
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath:join(root,version,'chrome-win64/chrome.exe')})
  page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.setDefaultTimeout(10000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const places=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',name:'银杏大道',address:'校园步道',latitude:39.9503,longitude:116.3396,enabled:true,category:'校园地标',description:'校园步道',postCount:4},
    {id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',name:'思源碑',latitude:39.949,longitude:116.338,address:'校园广场',enabled:true,category:'校园地标',postCount:0}]
  const posts=Array.from({length:4},(_,i)=>({id:`bbbbbbbb-bbbb-4bbb-8bbb-${String(i+1).padStart(12,'0')}`,body:['银杏大道的秋天到了','午后的校园随手拍','一起留下校园记忆','一张旧照片'][i],author:'林同学',authorId:null,authorAvatarMediaId:null,placeId:places[0].id,place:'银杏大道',placeLat:39.9503,placeLng:116.3396,createdAt:new Date(Date.now()-(i===3?20:0)*86400000-i*3600000).toISOString(),images:[{id:'cover',width:256,height:256}],likeCount:12-i}))
  const calls=[];let fail=false
  posts[1].body='😴💤';posts[1].images=[]
  await page.route('**/appmaptile?**',route=>route.fulfill({contentType:'image/svg+xml',body:tile}))
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url());let data={items:[]}
    if(u.pathname.startsWith('/api/media/'))return route.fulfill({contentType:'image/svg+xml',body:tile})
    if(u.pathname==='/api/places')data={items:places}
    else if(u.pathname==='/api/posts')data={items:posts}
    else if(u.pathname==='/api/schools')data={items:[{id:'cccccccc-cccc-4ccc-8ccc-000000000001',name:'北京交通大学'}]}
    else if(u.pathname==='/api/map/discover'){
      calls.push(Object.fromEntries(u.searchParams))
      if(fail)return route.fulfill({status:503,json:{error:'not_ready'}})
      const items=u.searchParams.get('filter')==='recent'?posts.slice(0,3):posts
      data={asOf:new Date().toISOString(),total:items.length,items,places:places.map(p=>({...p,updatedAt:posts[0].createdAt,coverMediaId:'cover'})),placesTruncated:false,nextCursor:null}
    }
    await route.fulfill({json:data})
  })
  await page.goto(`${origin}/#/map?raster=1`)
  await page.getByRole('button',{name:'暂时不要',exact:true}).click()
  await page.locator('[data-marker-phase="ready"]').waitFor()
  await page.locator('[data-discovery-phase="ready"]').waitFor()
  const nearbyPaper=page.locator(`[data-discovery-post="${posts[1].id}"] .square-card__paper`)
  await nearbyPaper.waitFor({state:'attached'})
  assert.equal(await nearbyPaper.locator('p').textContent(),posts[1].body)
  const paperStyle=await nearbyPaper.evaluate(el=>({background:getComputedStyle(el).backgroundColor,texture:getComputedStyle(el).backgroundImage,font:getComputedStyle(el.querySelector('p')).fontFamily}))
  assert.equal(await page.locator(`[data-discovery-post="${posts[1].id}"] .md-placeholder`).count(),0)
  const host=page.locator('.realmaps[data-map-instance]');await host.waitFor()
  const originalInstance=await host.getAttribute('data-map-instance')
  const originalMarkers=await page.locator('[data-marker-phase="ready"]').getAttribute('data-marker-place-ids')
  assert.equal(await page.locator('.map-discovery').count(),0)
  assert.equal(await page.locator('.rm--cluster').count(),0)
  assert.equal(await page.locator('.rm__img').first().evaluate(el=>getComputedStyle(el).width),'66px')
  assert.equal(await page.locator('.rm__card').first().evaluate(el=>getComputedStyle(el).display),'flex')
  const tag=await page.locator('[data-map-tags-toggle]').boundingBox()
  const first=await page.getByRole('button',{name:'拍照打卡',exact:true}).boundingBox()
  assert(first.x>=tag.x+tag.width,'new chips must follow existing landmark label')
  mkdirSync('docs/ui/assets',{recursive:true})
  await page.screenshot({path:'docs/ui/assets/map-discovery-lite-open-390.png'})
  await page.getByRole('button',{name:'拍照打卡',exact:true}).click()
  await page.getByText('拍照打卡地正在整理中',{exact:true}).waitFor()
  assert.equal(await page.locator('.md-card').count(),0,'do not label ordinary photos as curated check-ins')
  await page.getByRole('button',{name:'校园故事',exact:true}).click()
  await page.getByText('校园故事正在整理中',{exact:true}).waitFor()
  await page.getByRole('button',{name:'最近更新',exact:true}).click()
  await page.locator('[data-discovery-phase="ready"]').waitFor()
  assert.equal(await page.locator('.md-card').count(),3)
  assert.equal(calls.at(-1).filter,'recent')
  assert.equal(await host.getAttribute('data-map-instance'),originalInstance,'content filters must not rebuild the map')
  assert.equal(await page.locator('[data-marker-phase="ready"]').getAttribute('data-marker-place-ids'),originalMarkers)
  assert.equal(await page.locator('.rm--cluster').count(),0)
  await page.getByRole('button',{name:'关闭内容面板',exact:true}).click()
  await page.locator('.md-sheet').waitFor({state:'detached'})
  await page.getByRole('button',{name:'查看附近内容',exact:true}).waitFor()
  await page.screenshot({path:'docs/ui/assets/map-discovery-lite-closed-390.png'})
  await page.getByRole('button',{name:'查看附近内容',exact:true}).click()
  const grip=await page.locator('.md-grip').boundingBox()
  await page.mouse.move(grip.x+100,grip.y+20);await page.mouse.down();await page.mouse.move(grip.x+100,grip.y+115,{steps:6});await page.mouse.up()
  await page.locator('.md-sheet').waitFor({state:'detached'})
  assert.equal(await host.getAttribute('data-map-instance'),originalInstance,'closing the panel must not alter map instance')
  await page.getByRole('button',{name:'查看附近内容',exact:true}).click()
  await page.locator('[data-map-tags-toggle]').click()
  await page.locator('[data-map-tags-open="1"]').waitFor()
  assert.equal(await page.locator('.md-sheet').count(),0)
  await page.keyboard.press('Escape');await page.locator('.md-sheet').waitFor()
  for(const viewport of [{width:375,height:812},{width:430,height:932},{width:844,height:390}]){
    await page.setViewportSize(viewport)
    assert(await page.locator('.map-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no horizontal page overflow')
    await page.screenshot({path:`docs/ui/assets/map-discovery-lite-open-${viewport.width}.png`})
  }
  await page.setViewportSize({width:390,height:844})
  fail=true;await page.getByRole('button',{name:'附近热门',exact:true}).click()
  await page.getByText('内容加载失败，地图仍可浏览',{exact:true}).waitFor()
  assert.equal(await page.locator('[data-marker-phase="ready"]').getAttribute('data-marker-place-ids'),originalMarkers)
  fail=false;await page.locator('.md-sheet').getByRole('button',{name:'重试',exact:true}).click();await page.locator('[data-discovery-phase="ready"]').waitFor()
  await page.getByText('近 7 天 · 按点赞、评论、收藏热度排序',{exact:true}).waitFor()
  await page.goto(`${origin}/#/campus`)
  const squarePaper=page.locator(`[data-feed-id="${posts[1].id}"] .square-card__paper`)
  await squarePaper.waitFor({state:'attached'})
  assert.equal(await squarePaper.locator('p').textContent(),posts[1].body)
  assert.deepEqual(await squarePaper.evaluate(el=>({background:getComputedStyle(el).backgroundColor,texture:getComputedStyle(el).backgroundImage,font:getComputedStyle(el.querySelector('p')).fontFamily})),paperStyle,'same post must share paper color, texture, font and text in nearby and square')
  assert.deepEqual(errors,[])
  console.log('PASS lite map: retained landmark filter/card styling/marker IDs/map instance; new chips, honest curated placeholders, recent filter, close/reopen/drag-close, category overlay, retry and responsive screenshots')
}catch(error){await page?.screenshot({path:'.local/map-discovery-lite-failure.png'}).catch(()=>{});throw error}finally{await browser?.close();dev.kill()}
