/** Mocked admin API only. Does not upload images to production or create documents. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const require=createRequire(import.meta.url)
const {chromium}=require(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const browserRoot=join(homedir(),'AppData/Local/ms-playwright')
const installed=readdirSync(browserRoot).filter(name=>/^chromium-/.test(name)).sort().reverse()[0]
const origin='http://127.0.0.1:5196'
const preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5196','--strictPort'],{cwd:'app',windowsHide:true,stdio:'ignore'})
const item={id:'11111111-1111-4111-8111-111111111111',name:'测试项目',summary:'简介',coverImageId:null,showcaseImageIds:[],features:[],position:1,published:true,likeCount:0}
let browser,uploads=0,failUpload=false,saved
try {
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
  browser=await chromium.launch({headless:true,executablePath:join(browserRoot,installed,'chrome-win64/chrome.exe')})
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(()=>localStorage.setItem('campus.demo.session.v1',JSON.stringify({token:'admin-upload-fixture-token',user:{id:'fixture-admin',displayName:'管理员',role:'admin'}})))
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(path==='/api/admin/projects')return route.fulfill({json:{items:[item]}})
    if(path===`/api/admin/projects/${item.id}`){saved=request.postDataJSON();return route.fulfill({json:{id:item.id}})}
    if(path==='/api/media'&&request.method()==='POST'){
      uploads++
      assert(request.headers()['content-type'].includes('multipart/form-data; boundary='))
      assert(request.postDataBuffer().includes(Buffer.from('image/jpeg')))
      return route.fulfill(failUpload?{status:400,json:{error:'not_an_image',reason:'JPEG 缺少 EOI 结束标记'}}:{status:201,json:{id:`upload-${uploads}`,mime:'image/jpeg'}})
    }
    if(path.startsWith('/api/media/'))return route.fulfill({contentType:'image/jpeg',body:readFileSync('assets/training-projects/foodtime-neo/logo.jpg')})
    return route.fulfill({json:{items:[]}})
  })
  await page.goto(origin+'/#/admin?panel=projects')
  await page.getByRole('button',{name:'编辑项目',exact:true}).click()
  const input=page.getByLabel('列表封面',{exact:true})
  const buffer=readFileSync('assets/training-projects/foodtime-neo/logo.jpg')
  await input.setInputFiles({name:'cover.jpg',mimeType:'image/jpeg',buffer})
  await page.locator('.admin-projects__preview[src*="upload-1"]').waitFor()
  failUpload=true
  await input.setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not a JPEG')})
  await page.getByRole('alert').filter({hasText:'图片格式无法识别或文件已损坏'}).waitFor()
  assert.equal(await page.locator('.admin-projects__preview[src*="upload-1"]').count(),1)
  const before=uploads
  await input.setInputFiles({name:'large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(5*1024*1024+1)})
  await page.getByRole('alert').filter({hasText:'图片不能超过 5 MB'}).waitFor();assert.equal(uploads,before)
  failUpload=false
  await page.getByLabel('详情展示图',{exact:true}).setInputFiles({name:'showcase.jpg',mimeType:'image/jpeg',buffer})
  await page.locator('.admin-projects__gallery img[src*="upload-3"]').waitFor()
  await page.getByRole('button',{name:'保存项目',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.equal(saved.coverImageId,'upload-1');assert.deepEqual(saved.showcaseImageIds,['upload-3']);assert.deepEqual(errors,[])
  console.log('PASS admin project upload: JPEG cover/gallery, preview/save, failed replacement preservation, specific error and local 5 MB limit')
} finally {await browser?.close();preview.kill()}
