// Browser fixtures only; all API traffic is intercepted and no real users are changed.
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const require = createRequire(import.meta.url)
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || (existsSync(bundled) ? bundled : 'playwright'))
const root = join(homedir(),'AppData/Local/ms-playwright')
const installed = existsSync(root) ? readdirSync(root).filter(n=>/^chromium-/.test(n)).sort().reverse()[0] : null
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (installed ? join(root,installed,'chrome-win64/chrome.exe') : undefined)
const origin = 'http://127.0.0.1:5189'
const dev = spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5189','--strictPort'],{cwd:'app',windowsHide:true,stdio:'ignore'})
let browser
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath})
  const page=await browser.newPage({viewport:{width:390,height:624}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const names=['林同学','小陈','校园摄影社','阿泽']
  const previews=['你分享的校园照片好好看！','请问这个活动在哪里报名呀？','周末一起去拍银杏吧','好的，到时候见～']
  const ids=names.map((_,i)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`)
  const now=new Date().toISOString()
  let mode='ready',read=false,published=false,posted
  await page.addInitScript(()=>localStorage.setItem('campus.demo.session.v1',JSON.stringify({token:'test-token-inbox-browser',expiresAt:'2099-01-01',user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',role:'admin'}})))
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    let data={items:[]}
    if(path==='/api/inbox') {
      if(mode==='error')return route.fulfill({status:503,json:{error:'not_ready'}})
      if(mode==='unauth')return route.fulfill({status:401,json:{error:'unauthorized'}})
      data={through:now,counts:{likes:read?0:3,favorites:read?0:1,comments:read?0:2},items:mode==='empty'?[]:[{id:'event1',category:'likes',actor:'林同学',action:'赞了你的帖子',preview:'校园记录',postId:ids[0],createdAt:now,unread:!read}],announcements:mode==='empty'?[]:[{id:'announcement1',title:published?'测试公告':'校园时光地图使用指南已更新',body:published?'管理员发布的正文':'第一行公告内容\n第二行公告内容',createdAt:now,unread:!read}],threads:ids.map((id,i)=>({id,avatarMediaId:null,unreadCount:read?0:i===0?2:i===1?1:0}))}
    } else if(path==='/api/threads')data={items:mode==='empty'?[]:ids.map((id,i)=>({id,kind:'direct',peerName:names[i],lastMessage:{body:previews[i],kind:'text',createdAt:i===0?now:new Date(Date.now()-i*86400000).toISOString()}}))}
    else if(path==='/api/inbox/read'){assert.equal(route.request().method(),'POST');assert.equal(route.request().postDataJSON().through,now);read=true;data={ok:true}}
    else if(path==='/api/admin/announcements'){posted=route.request().postDataJSON();published=true;return route.fulfill({status:201,json:{id:'published'}})}
    await route.fulfill({json:data})
  })
  const home=async()=>{await page.goto(`${origin}/#/message`);await page.locator('[data-thread-id]').first().waitFor();await page.locator('[aria-label="全部标记已读"]:enabled').waitFor()}
  const noOverflow=async()=>assert(await page.locator('.screen__body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'horizontal overflow')
  await home()
  assert.equal(await page.locator('.inbox__shortcut').allTextContents().then(v=>v.map(x=>x.replace(/\d/g,'').trim()).join(',')),'点赞,收藏,评论和@')
  assert.equal(await page.locator('.inbox__conversation').count(),4)
  assert.equal(await page.getByText('新增关注',{exact:true}).count(),0)
  assert.equal(await page.getByText('有人喜欢你的校园记录').count(),0)
  await noOverflow()
  mkdirSync('docs/ui/assets',{recursive:true})
  await page.screenshot({path:'docs/ui/assets/message-implemented-390.png'})
  const geometry=await page.locator('.inbox__announcement').boundingBox()
  assert(geometry.y>=150&&geometry.y<=180,`announcement y=${geometry.y}`)
  writeFileSync('docs/ui/assets/message-layout.json',JSON.stringify(await page.evaluate(()=>Object.fromEntries(['.topbar','.inbox__tile','.inbox__announcement','.inbox__heading','.inbox__conversations','.inbox__conversation','.inbox__avatar'].map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return [selector,{x:r.x,y:r.y,width:r.width,height:r.height}]}))),null,2))
  await page.locator('.inbox__shortcut').first().click()
  await page.getByText('赞了你的帖子',{exact:true}).waitFor()
  await page.getByRole('button',{name:'返回消息',exact:true}).click()
  await page.getByRole('button',{name:/应用公告/}).click()
  await page.getByRole('button',{name:/校园时光地图使用指南已更新/}).click()
  await page.locator('.inbox__article').waitFor()
  assert.match(await page.locator('.inbox__article').innerText(),/第二行公告内容/)
  await page.getByRole('button',{name:'返回消息',exact:true}).click()
  await page.getByRole('button',{name:'全部标记已读',exact:true}).click()
  await page.getByText('已标记为已读',{exact:true}).waitFor()
  assert.equal(await page.locator('.inbox__badge,.inbox__dot').count(),0)
  for(const viewport of [{width:375,height:812},{width:844,height:390}]) {
    await page.setViewportSize(viewport);await noOverflow()
    await page.screenshot({path:`docs/ui/assets/message-implemented-${viewport.width}.png`})
  }
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'})
  await page.setViewportSize({width:375,height:812})
  await page.evaluate(()=>document.documentElement.style.zoom='1.5');await noOverflow()
  await page.evaluate(()=>document.documentElement.style.zoom='')
  mode='empty';await page.reload();await page.getByText('还没有私聊会话',{exact:true}).waitFor();await page.getByText('暂无应用公告',{exact:true}).waitFor()
  mode='error';await page.reload();await page.getByRole('button',{name:'重试',exact:true}).waitFor()
  mode='ready';await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('[data-thread-id]').first().waitFor()
  await page.goto(`${origin}/#/admin?panel=announcements`)
  await page.getByLabel('公告标题',{exact:true}).fill('测试公告')
  await page.getByLabel('公告正文',{exact:true}).fill('管理员发布的正文')
  await page.getByRole('button',{name:'发布公告',exact:true}).click()
  await page.getByText('公告已发布',{exact:true}).waitFor()
  assert.deepEqual(posted,{title:'测试公告',body:'管理员发布的正文'})
  await home();await page.getByText('测试公告',{exact:true}).waitFor()
  mode='unauth';await page.reload();await page.getByRole('button',{name:'去登录',exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS inbox browser: reference layout, categories, announcement detail/publication, unread, empty/error/unauth, 375/390/landscape, reduced motion and enlarged text; screenshots saved')
} finally {await browser?.close();dev.kill()}
