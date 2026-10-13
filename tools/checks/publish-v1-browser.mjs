import { homedir } from 'node:os'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || (existsSync(bundled) ? bundled : 'playwright'))
const browserRoot = join(homedir(), 'AppData/Local/ms-playwright')
const installed = existsSync(browserRoot) ? readdirSync(browserRoot).filter(n => /^chromium-/.test(n)).sort().reverse()[0] : undefined
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (installed ? join(browserRoot, installed, 'chrome-win64/chrome.exe') : undefined)
const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5179'], { cwd:'app', windowsHide:true, stdio:'ignore' })
await new Promise(r=>setTimeout(r,1500))
let browser
try {
browser = await chromium.launch({headless:true, executablePath})
const page = await browser.newPage({viewport:{width:390,height:844}})
const placeId='11111111-1111-4111-8111-111111111111'
const postId='22222222-2222-4222-8222-222222222222'
let posts=[], uploads=0, submissions=[], cutouts=0, failPost=false, cutoutFixture=null
await page.route('**/api/**', async route => {
 const req=route.request(), path=new URL(req.url()).pathname
 if (!path.startsWith('/api/')) return route.continue()
 let data={items:[]}, status=200
 if(path==='/api/places') data={items:[{id:placeId,name:'图书馆',enabled:true,category:'地标',latitude:39.95,longitude:116.34}]}
 if(path==='/api/schools') data={items:[]}
 if(path==='/api/posts' && req.method()==='GET') data={items:posts}
 if(path==='/api/media' && req.method()==='POST'){ const body=req.postData();assert(body.indexOf('name="uploadRequestId"')<body.indexOf('name="file"')); uploads++; data={id:'33333333-3333-4333-8333-'+String(uploads).padStart(12,'0'),mime:'image/png',scope:'public'} }
 if(path==='/api/media/cutout'){ cutouts++;status=cutoutFixture?200:503;data=cutoutFixture?{dataUrl:cutoutFixture}:{message:'贴纸服务尚未开通，请先使用原图发布'} }
 if(path==='/api/posts' && req.method()==='POST'){
   const payload=req.postDataJSON();submissions.push(payload)
   if(failPost){status=503;data={error:'temporary_failure'}}
   else{data={...payload,id:postId,place:'图书馆',author:'测试',createdAt:new Date().toISOString(),images:[]}; posts=[data]}
 }
 await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(data)})
})
page.on('requestfailed',r=>{if(r.url().includes('/api/'))console.error('FAILED',r.url(),r.failure())})
page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text())})
page.on('pageerror',e=>console.error('PAGE',e.message))
await page.goto('http://127.0.0.1:5179/#/publish')
await page.locator('.pub__overlay').waitFor({state:'hidden'})
await page.locator('#pub-place').waitFor({timeout:10000}).catch(async e=>{console.error(await page.locator('body').innerText());throw e})
await page.locator('#pub-place').selectOption(placeId)
assert(await page.locator('.pub__publish').isDisabled())
await page.locator('#pub-text').fill('😀'.repeat(501))
assert(await page.locator('.pub__publish').isDisabled())
await page.locator('#pub-text').fill('保存草稿验证')
await page.getByRole('button',{name:'关闭',exact:true}).click()
await page.getByRole('button',{name:'保存草稿并退出'}).click()
await page.waitForURL('**/#/map')
await page.evaluate(()=>{location.hash='#/publish'})
await page.getByRole('button',{name:/保存草稿验证/}).click()
assert.equal(await page.locator('#pub-text').inputValue(),'保存草稿验证')
// Browser back/navigation must show the exit dialog and preserve the editor.
await page.evaluate(()=>{location.hash='#/campus'})
await page.getByRole('button',{name:'继续编辑'}).waitFor({timeout:5000}).catch(async e=>{console.error('GUARD',page.url(),await page.locator('body').innerText());throw e})
await page.getByRole('button',{name:'继续编辑'}).click()
assert(page.url().endsWith('#/publish'))
await page.getByRole('button',{name:'关闭',exact:true}).click()
await page.getByRole('button',{name:'保存草稿并退出'}).click()
await page.waitForURL('**/#/map')
await page.evaluate(()=>{location.hash='#/publish'})
await page.getByRole('button',{name:/新建帖子/}).click()
assert.equal(await page.locator('#pub-text').inputValue(),'')
await page.locator('#pub-place').selectOption(placeId)
await page.getByRole('button',{name:'＋ 添加图片'}).click()
const chooser=page.waitForEvent('filechooser')
await page.getByRole('button',{name:'从相册选择',exact:true}).click()
const fileChooser=await chooser
// A real browser canvas creates a valid PNG fixture.
const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(32,32,192,192);return c.toDataURL('image/png').split(',')[1]})
await fileChooser.setFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
await page.locator('[data-pub-draft]').waitFor()
assert(await page.locator('.pub__publish').isEnabled(),'pure image permitted')
await page.getByRole('button',{name:'生成贴纸',exact:true}).click()
await page.locator('[data-publish-err]').filter({hasText:'尚未开通'}).waitFor()
assert.equal(cutouts,1)
assert(await page.locator('[data-pub-draft]').isVisible())
failPost=true
await page.locator('.pub__publish').click()
await page.locator('[data-publish-err]').filter({hasText:'发布失败'}).waitFor()
assert(await page.locator('#pub-text').isDisabled(),'uncertain submission freezes payload')
const first=submissions[0]
failPost=false
await page.locator('.pub__publish').click()
await page.waitForURL('**/map?*')
assert.equal(submissions[1].clientRequestId,first.clientRequestId)
assert.equal(uploads,1,'valid original upload reused')
assert.equal(submissions[1].body,'')
await page.getByRole('button',{name:'查看帖子',exact:true}).waitFor()
await page.evaluate(()=>{location.hash='#/publish'})
await page.getByRole('button',{name:/保存草稿验证/}).waitFor()
await page.getByRole('button',{name:/新建帖子/}).click()
await page.locator('#pub-place').selectOption(placeId)
await page.getByRole('button',{name:'＋ 添加图片'}).click()
const secondChooser=page.waitForEvent('filechooser')
await page.getByRole('button',{name:'从相册选择',exact:true}).click()
await (await secondChooser).setFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})
await page.locator('[data-pub-draft]').waitFor()
cutoutFixture=`data:image/png;base64,${png}`
await page.getByRole('button',{name:'生成贴纸',exact:true}).click()
await page.getByRole('button',{name:'确认采用贴纸'}).waitFor()
assert(await page.locator('.pub__publish').isDisabled(),'preview must be explicitly adopted')
const stickerSrc=await page.locator('[data-pub-draft]').getAttribute('src')
assert(stickerSrc.startsWith('data:image/png'))
await page.getByRole('button',{name:'确认采用贴纸'}).click()
assert(await page.locator('.pub__publish').isEnabled())
await page.getByLabel('白色描边').uncheck()
await page.waitForFunction(src=>document.querySelector('[data-pub-draft]')?.getAttribute('src')!==src,stickerSrc)
assert.equal(cutouts,2,'outline does not call provider again')
await page.getByRole('button',{name:'更换',exact:true}).click()
const cancelChooser=page.waitForEvent('filechooser')
await page.getByRole('button',{name:'从相册选择',exact:true}).click()
await (await cancelChooser).setFiles([])
assert(await page.getByRole('button',{name:'已采用贴纸'}).isVisible(),'cancelled replacement preserves sticker')
const cleanSource=await page.locator('[data-pub-draft]').getAttribute('src')
await page.getByRole('button',{name:'添加文字',exact:true}).click()
await page.locator('#pub-image-text').fill('😀'.repeat(51))
assert(await page.locator('.pub__publish').isDisabled())
await page.locator('#pub-image-text').fill('TimeMap\n校园记忆')
await page.waitForFunction(src=>document.querySelector('[data-pub-draft]')?.getAttribute('src')!==src,cleanSource)
await page.waitForFunction(()=>!document.querySelector('.pub__publish').disabled)
await page.getByLabel('图片文字颜色').selectOption('#ff8a32')
await page.getByLabel('图片文字字号').selectOption('large')
await page.getByRole('button',{name:'拖动图片文字'}).press('ArrowUp')
await page.waitForFunction(()=>!document.querySelector('.pub__publish').disabled)
await page.screenshot({path:'docs/test/publish-image-text.png',fullPage:true})
await page.locator('.pub__publish').click()
await page.waitForURL('**/map?*')
const captionPayload=submissions.at(-1)
assert.equal(captionPayload.mediaIds.length,1)
assert(captionPayload.mapMediaId && captionPayload.mapMediaId!==captionPayload.mediaIds[0])
console.log('PASS: caption composition, color, size, movement, Unicode limit, separate map image')
await page.screenshot({path:'docs/test/publish-flow-mobile.png',fullPage:true})
console.log('PASS: content rules, Unicode count, persistent drafts, new draft isolation, route guard, image selection, cutout failure, upload reuse, idempotent retry, map feedback, sticker adoption, outline, cancelled replacement')
} finally { await browser?.close(); dev.kill() }
