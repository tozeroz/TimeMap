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
const origin = 'http://127.0.0.1:5189'
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5189', '--strictPort'],
  { cwd: 'app', windowsHide: true, stdio: 'ignore', env: { ...process.env, VITE_API_ORIGIN: origin } })
let browser
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
  browser=await chromium.launch({headless:true,executablePath})
  for(const width of [320,390,1024]) {
    const page=await browser.newPage({viewport:{width,height:844}})
    page.setDefaultTimeout(10000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    const me='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',other='aaaaaaaa-aaaa-4aaa-8aaa-000000000002',thread='bbbbbbbb-bbbb-4bbb-8bbb-000000000001'
    const peer={id:other,displayName:'另一位同学',avatarMediaId:'cccccccc-cccc-4ccc-8ccc-000000000001'}
    await page.addInitScript(({me})=>localStorage.setItem('campus.demo.session.v1',JSON.stringify({token:'test-dm-session-token',expiresAt:'2099-01-01',user:{id:me,displayName:'本人',handle:'me'}})),{me})
    const messages=Array.from({length:75},(_,i)=>({id:`dddddddd-dddd-4ddd-8ddd-${String(i+1).padStart(12,'0')}`,threadSeq:String(i+1),clientRequestId:null,senderId:other,sender:'另一位同学',senderAvatarMediaId:peer.avatarMediaId,body:`历史消息${i+1}`,kind:'text',media:[],revoked:false,createdAt:new Date().toISOString()}))
    let blocked=false,first=true,postKeys=[],readPositions=[],polls=0
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname
      let data={items:[]}
      if(path.startsWith('/api/media/')){await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#698051"/></svg>'});return}
      if(path===`/api/users/${other}`)data=peer
      else if(path===`/api/users/${other}/block`){blocked=req.method()==='POST';data={blocked}}
      else if(path==='/api/threads/direct')data={id:thread,kind:'direct',peer}
      else if(path===`/api/threads/${thread}`)data={id:thread,kind:'direct',title:null,peerName:peer.displayName,peer,memberCount:2,members:[{id:me,displayName:'本人'},peer],blockedByMe:blocked,canMessage:!blocked}
      else if(path===`/api/threads/${thread}/read`){readPositions.push(req.postDataJSON().throughSeq);data={lastReadSeq:req.postDataJSON().throughSeq}}
      else if(path===`/api/threads/${thread}/messages`) {
        if(req.method()==='POST') {
          const input=req.postDataJSON();postKeys.push(input.clientRequestId)
          if(blocked){await route.fulfill({status:403,json:{error:'messaging_unavailable'}});return}
          let message=messages.find(m=>m.clientRequestId===input.clientRequestId)
          if(!message){message={...messages[0],id:`eeeeeeee-eeee-4eee-8eee-${String(messages.length+1).padStart(12,'0')}`,threadSeq:String(messages.length+1),body:input.body,senderId:me,sender:'本人',clientRequestId:input.clientRequestId};messages.push(message)}
          if(first){first=false;await route.fulfill({status:503,json:{error:'not_ready'}});return}
          data={id:message.id,threadSeq:message.threadSeq,kind:'text',mediaId:null}
        } else {
          const before=url.searchParams.get('beforeSeq'),after=url.searchParams.get('afterSeq')
          if(after)polls++
          const all=messages.filter(m=>before?BigInt(m.threadSeq)<BigInt(before):after?BigInt(m.threadSeq)>BigInt(after):true)
          const items=after?all.slice(0,50):all.slice(-50)
          data={threadId:thread,items,hasMore:all.length>50,olderCursor:items[0]?.threadSeq??null,newerCursor:items.at(-1)?.threadSeq??after}
        }
      } else if(path==='/api/threads') data={items:[{id:thread,kind:'direct',peerId:other,peerName:peer.displayName,peerAvatarMediaId:peer.avatarMediaId,unreadCount:2,lastMessage:{body:'最新私信',kind:'text',createdAt:new Date().toISOString()}}],nextCursor:null}
      else if(path==='/api/inbox')data={through:new Date().toISOString(),counts:{likes:0,favorites:0,comments:0,announcements:0},items:[],threads:[],announcements:[]}
      await route.fulfill({json:data})
    })
    await page.goto(`${origin}/#/user?id=${other}`)
    await page.getByRole('button',{name:'发私信',exact:true}).click()
    await page.locator(`[data-message-id="${messages[74].id}"]`).waitFor()
    assert.equal(await page.locator('[data-message-id]').count(),50)
    await page.getByRole('button',{name:'加载更早消息',exact:true}).click()
    await page.locator(`[data-message-id="${messages[0].id}"]`).waitFor()
    assert.equal(await page.locator('[data-message-id]').count(),75)
    const input=page.getByRole('textbox',{name:'消息输入框'})
    await input.fill('可靠发送测试')
    await page.getByRole('button',{name:'发送',exact:true}).click()
    await page.getByText(/发送未确认，请重试/).waitFor()
    assert.equal(await input.inputValue(),'可靠发送测试')
    await page.getByRole('button',{name:'发送',exact:true}).click()
    await page.locator(`[data-message-id="${messages[75].id}"]`).waitFor()
    assert.equal(postKeys[0],postKeys[1]);assert.equal(messages.length,76)
    assert.equal(await input.inputValue(),'')
    messages.push({...messages[0],id:'ffffffff-ffff-4fff-8fff-000000000077',threadSeq:'77',body:'前台自动收到的新消息'})
    await page.getByText('前台自动收到的新消息',{exact:true}).waitFor()
    await page.getByRole('button',{name:'私信设置',exact:true}).click()
    await page.getByRole('button',{name:'确认拉黑',exact:true}).click()
    await page.getByText('已拉黑该用户，可通过私信设置解除。',{exact:true}).waitFor()
    await input.fill('拉黑时发送')
    await page.getByRole('button',{name:'发送',exact:true}).click()
    await page.getByText('暂时无法向该用户发送私信',{exact:true}).waitFor()
    await page.getByRole('button',{name:'私信设置',exact:true}).click()
    await page.getByRole('button',{name:'确认解除拉黑',exact:true}).click()
    await page.getByText('已拉黑该用户，可通过私信设置解除。',{exact:true}).waitFor({state:'hidden'})
    if(width===390)await page.screenshot({path:'.local/direct-message-390.png'})
    assert(readPositions.some(seq=>BigInt(seq)>=75n))
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
    const beforePolls=polls
    await page.waitForTimeout(3400)
    assert.equal(polls,beforePolls,'Hidden pages must stop polling')
    assert.deepEqual(errors,[])
    await page.close()
  }
  console.log('PASS direct messaging browser: namecard creation, 75-message history, uncertain send retry key/dedup, foreground sync, read positions, block/unblock, hidden polling; 320/390/1024px')
} finally {await browser?.close();dev.kill()}
