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

const dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5182','--strictPort'], { cwd:'app', windowsHide:true, stdio:'ignore' })
let browser
try {
await new Promise(r=>setTimeout(r,1500))
browser = await chromium.launch({headless:true, executablePath})
for (const width of [390, 320, 1024]) {
 const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true })
 page.setDefaultTimeout(10000)
 const errors=[];page.on('pageerror', error=>errors.push(error.message))
 let calls=[], uploads=0, fixture='', fail=false
 await page.route('**/api/**', async route=>{
  const path=new URL(route.request().url()).pathname
  if (!path.startsWith('/api/')) return route.continue()
  let data={items:[]}
  if(path==='/api/places') data={items:[{id:'11111111-1111-4111-8111-111111111111',name:'图书馆',enabled:true,category:'地标'}]}
  if(path==='/api/media') {uploads++;data={id:'33333333-3333-4333-8333-333333333333'}}
  if(path==='/api/media/cutout') {
   const body=route.request().postDataJSON();calls.push(body)
   if(fail) {fail=false;return route.abort('failed')}
   data={dataUrl:fixture,method:body.method??'auto'}
  }
  await route.fulfill({json:data})
 })
 await page.goto('http://127.0.0.1:5182/#/publish')
 await page.locator('.pub__overlay').waitFor({state:'hidden'})
 fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(100,100,500,400);return c.toDataURL('image/png')})
 await page.locator('[data-pub-add-image]').click()
 const chooser=page.waitForEvent('filechooser')
 await page.getByRole('button',{name:'从相册选择',exact:true}).click()
 await (await chooser).setFiles({name:'subject.png',mimeType:'image/png',buffer:Buffer.from(fixture.split(',')[1],'base64')})
 await page.getByRole('button',{name:'手动框选主体',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'框选抠图主体'})
 await dialog.waitFor()
 await dialog.getByRole('button',{name:'按选区生成贴纸'}).waitFor()
 const image=dialog.getByRole('img')
 await image.evaluate(img=>img.decode())
 const rect=await image.boundingBox()
 assert(rect.width>0 && rect.x>=0 && rect.x+rect.width<=width, 'Image fits viewport')
 assert.equal(calls.length,0,'Opening selection does not call the provider')
 await page.mouse.move(rect.x+rect.width*.8,rect.y+rect.height*.8)
 await page.mouse.down()
 await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.2,{steps:8})
 await page.mouse.up()
 await dialog.locator('summary').click()
 const coords=await dialog.locator('input').evaluateAll(inputs=>inputs.map(input=>Number(input.value)))
 assert.deepEqual(coords,[160,120,640,480], 'Reverse drag maps preview to original pixels')
 await dialog.getByLabel('左边',{exact:true}).fill('0')
 assert(await dialog.getByRole('button',{name:'按选区生成贴纸'}).isDisabled())
 await dialog.getByLabel('左边',{exact:true}).fill('200')
 if(width===390) await page.screenshot({path:'.local/manual-cutout-preview.png'})
 fail=true
 await dialog.getByRole('button',{name:'按选区生成贴纸'}).click()
 await page.locator('[data-publish-err]').filter({hasText:'网络中断'}).waitFor()
 assert.equal(calls[0].method,'control')
 assert.deepEqual(calls[0].position,[[[200,120],[640,480]]])
 await page.getByRole('button',{name:'手动框选主体',exact:true}).click()
 await dialog.locator('img').evaluate(img=>img.decode())
 await dialog.getByRole('button',{name:'按选区生成贴纸'}).click()
 await page.getByRole('button',{name:'确认采用贴纸',exact:true}).waitFor()
 assert.equal(calls[0].requestId,calls[1].requestId,'Unknown-result retry uses same request ID')
 assert.equal(uploads,1,'Selection changes reuse uploaded original')
 await page.getByRole('button',{name:'手动框选主体',exact:true}).click()
 await dialog.locator('img').evaluate(img=>img.decode())
 await dialog.locator('summary').click()
 await dialog.getByLabel('左边',{exact:true}).fill('250')
 await dialog.getByRole('button',{name:'按选区生成贴纸'}).click()
 await page.getByRole('button',{name:'确认采用贴纸',exact:true}).waitFor()
 assert.notEqual(calls[1].requestId,calls[2].requestId)
 await page.getByRole('button',{name:'生成贴纸',exact:true}).click()
 await page.getByRole('button',{name:'确认采用贴纸',exact:true}).waitFor()
 assert.equal(calls.at(-1).method,undefined,'Existing automatic button remains compatible')
 assert.equal(calls.at(-1).position,undefined)
 await page.getByRole('button',{name:'手动框选主体',exact:true}).click()
 await dialog.waitFor()
 await page.keyboard.press('Escape')
 await dialog.waitFor({state:'hidden'})
 // Tall photos must have the same image/selection coordinate frame.
 await page.getByRole('button',{name:'更换',exact:true}).click()
 const portraitChooser=page.waitForEvent('filechooser')
 await page.getByRole('button',{name:'从相册选择',exact:true}).click()
 const portrait=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=1200;return c.toDataURL('image/png').split(',')[1]})
 await (await portraitChooser).setFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(portrait,'base64')})
 await page.getByRole('button',{name:'手动框选主体',exact:true}).click()
 await dialog.locator('img').evaluate(img=>img.decode())
 const portraitRect=await dialog.locator('img').boundingBox()
 const stageRect=await dialog.locator('.subject-select__stage').boundingBox()
 assert(Math.abs(portraitRect.width-stageRect.width)<1 && Math.abs(portraitRect.height-stageRect.height)<1, 'Portrait overlay must align with image')
 await dialog.getByRole('button',{name:'取消',exact:true}).click()
 assert.deepEqual(errors,[])
 await page.close()
 console.log(`PASS manual cutout UI at ${width}px: reverse drag, coordinates, validation, retries, cache reuse, automatic mode and Escape`)
}
} finally { await browser?.close(); dev.kill() }
