// Additional audit scenarios. Reuse the isolated browser fixture, never a paid service.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const source = readFileSync(new URL('./publish-v1-browser.mjs', import.meta.url), 'utf8').replace(/const cleanSource=await[\s\S]*?(?=await page.screenshot\(\{path:'docs\/test\/publish-flow-mobile.png')/, '')
const extra = `
const verifyFixes=${process.argv.includes('--regression')}
const findings=[]
// A new processing response has a valid PNG container but no visible subject.
const oldPreview=await page.locator('[data-pub-draft]').getAttribute('src')
cutoutFixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=256;c.height=256;return c.toDataURL('image/png')})
await page.getByRole('button',{name:'重新生成',exact:true}).click()
await page.locator('[data-publish-err]').filter({hasText:'未识别到主体'}).waitFor()
const adopt=page.getByRole('button',{name:'确认采用贴纸'})
const adoptEnabled=await adopt.isEnabled()
if(adoptEnabled){
 await adopt.click()
 findings.push({id:'F01',problem:'重新生成返回空透明图片，预览失败后仍允许采用旧贴纸',confirmed:await page.locator('.pub__publish').isEnabled() && await page.locator('[data-pub-draft]').getAttribute('src')===oldPreview})
} else findings.push({id:'F01',confirmed:false})
if(verifyFixes){
 assert(await adopt.isDisabled(),'failed sticker render cannot be adopted')
 assert(await page.locator('.pub__publish').isDisabled(),'failed sticker render cannot be published')
 assert.notEqual(await page.locator('[data-pub-draft]').getAttribute('src'),oldPreview,'failed render does not retain old preview')
 // A successful retry must still require adoption and must recover normal publishing.
 cutoutFixture='data:image/png;base64,'+png
 await page.getByRole('button',{name:'重新生成',exact:true}).click()
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pub__actions button')).some(button=>button.textContent==='确认采用贴纸' && !button.disabled))
 assert(await page.locator('.pub__publish').isDisabled(),'retry success requires explicit adoption')
 await adopt.click()
 assert(await page.locator('.pub__publish').isEnabled(),'valid retry can be adopted')
}
// Clear the sticker and retain a basic draft so it can be tested across reloads.
await page.getByRole('button',{name:'恢复原图 / 取消处理'}).click()
await page.locator('#pub-text').fill('补充审核图片草稿')
await page.getByRole('button',{name:'关闭',exact:true}).click()
await page.getByRole('button',{name:'保存草稿并退出'}).click()
await page.waitForURL('**/#/map')
await page.evaluate(()=>{location.hash='#/publish'})
await page.getByRole('button',{name:/补充审核图片草稿/}).click()
await page.locator('[data-pub-draft]').waitFor()
assert.equal(await page.locator('#pub-place').inputValue(),placeId)
assert.equal(await page.locator('#pub-text').inputValue(),'补充审核图片草稿')
assert.equal(cutouts,verifyFixes?4:3,'restored draft does not automatically call cutout')
// Replacing an image must invalidate a delayed response for the old image.
let releaseCutout, sawCutout
const cutoutGate=new Promise(r=>releaseCutout=r), cutoutReceived=new Promise(r=>sawCutout=r)
await page.route('**/api/media/cutout',async route=>{
 sawCutout();await cutoutGate
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({dataUrl:'data:image/png;base64,'+png})})
})
await page.getByRole('button',{name:'生成贴纸',exact:true}).click()
await cutoutReceived
assert(await page.locator('#pub-text').isEnabled())
assert(await page.locator('#pub-place').isEnabled())
await page.locator('#pub-text').fill('处理中仍可编辑')
await page.getByRole('button',{name:'更换',exact:true}).click()
const replacementChooser=page.waitForEvent('filechooser')
await page.getByRole('button',{name:'从相册选择',exact:true}).click()
const blue=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');x.fillStyle='blue';x.fillRect(0,0,256,256);return c.toDataURL('image/png').split(',')[1]})
await (await replacementChooser).setFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(blue,'base64')})
await page.getByRole('button',{name:'生成贴纸',exact:true}).waitFor()
const replacementPreview=await page.locator('[data-pub-draft]').getAttribute('src')
releaseCutout()
await page.waitForTimeout(250)
assert.equal(await page.locator('[data-pub-draft]').getAttribute('src'),replacementPreview)
assert.equal(await page.getByRole('button',{name:'确认采用贴纸'}).count(),0)
assert.equal(await page.locator('#pub-text').inputValue(),'处理中仍可编辑')
assert.equal(await page.locator('#pub-place').inputValue(),placeId)
// An in-flight request must not silently discard the current editor on navigation.
let releasePost, sawPost, inFlightSubmission
const gate=new Promise(r=>releasePost=r), received=new Promise(r=>sawPost=r)
await page.route('**/api/posts',async route=>{
 if(route.request().method()!=='POST')return route.fallback()
 inFlightSubmission=route.request().postDataJSON()
 sawPost();await gate
 await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporary_failure'})})
})
await page.locator('.pub__publish').click()
await received
await page.evaluate(()=>{location.hash='#/campus'})
await page.waitForTimeout(250)
findings.push({id:'F02',problem:'发布中跳转离开导致失败反馈与提交标识丢失',confirmed:!page.url().includes('/publish') && await page.locator('#pub-text').count()===0})
if(verifyFixes){
 assert(page.url().endsWith('#/publish'),'in-flight hash navigation remains in editor')
 assert.equal(await page.locator('#pub-text').inputValue(),'处理中仍可编辑')
 assert.equal(await page.getByRole('button',{name:'保存草稿并退出'}).count(),0,'in-flight navigation cannot expose exit actions')
 await page.getByText('正在发布，请等待结果后再离开。',{exact:true}).waitFor()
 // Exercise app navigation and an actual browser history back event as well.
 await page.evaluate(async()=>{const {navigate}=await import('/src/router.ts');navigate('campus')})
 assert(page.url().endsWith('#/publish'),'app navigation stays in editor')
 await page.evaluate(()=>{history.replaceState(null,'','#/campus');history.pushState(null,'','#/publish');history.back()})
 await page.waitForTimeout(250)
 assert(page.url().endsWith('#/publish'),'browser back stays in editor')
 assert.equal(await page.locator('#pub-text').inputValue(),'处理中仍可编辑')
}
releasePost()
if(verifyFixes){
 await page.locator('[data-publish-err]').filter({hasText:'发布失败'}).waitFor()
 assert(await page.locator('#pub-text').isDisabled(),'unknown result freezes the same submission')
 assert.equal(await page.locator('#pub-text').inputValue(),inFlightSubmission.body)
 await page.unroute('**/api/posts')
 // Persist the pending request, leave, and restore it before retrying.
 await page.getByRole('button',{name:'关闭',exact:true}).click()
 await page.getByRole('button',{name:'保存草稿并退出'}).click()
 await page.waitForURL('**/#/map')
 await page.evaluate(()=>{location.hash='#/publish'})
 await page.getByRole('button',{name:/处理中仍可编辑/}).click()
 assert(await page.locator('#pub-text').isDisabled(),'restored uncertain submission stays frozen')
 await page.locator('.pub__publish').click()
 await page.waitForURL('**/map?*')
 assert.deepEqual(submissions.at(-1),inFlightSubmission,'restored retry retains payload and request identifier')
 await page.getByRole('button',{name:'查看帖子',exact:true}).waitFor()
 assert(findings.every(f=>!f.confirmed),'both findings remain fixed')
} else await page.waitForTimeout(200)
mkdirSync('docs/test',{recursive:true})
writeFileSync(verifyFixes?'docs/test/publish-v02-regression-results.json':'docs/test/publish-v02-audit-results.json',JSON.stringify({date:'2026-10-13',environment:'Chromium 390x844, mocked API, no provider calls',regression:verifyFixes,additionalPasses:['图片草稿恢复正文、地标和原图','恢复草稿不自动调用抠图','处理中可编辑正文与地标','成功换图保留正文与地标并清除旧效果','旧抠图响应不覆盖新图',...(verifyFixes?['失败贴纸禁止采用和发布','重新生成成功后可确认采用','发布中哈希跳转、页面导航与浏览器返回均留页','发布失败反馈与内容保留','待确认提交保存恢复后沿用原标识重试','成功发布仍返回地图']:[])],findings},null,2))
console.log(verifyFixes?'REGRESSION PASS':'AUDIT FINDINGS',JSON.stringify(findings))
`
const temp = new URL('./.publish-v02-audit-run.mjs', import.meta.url)
writeFileSync(temp, "import { mkdirSync, writeFileSync } from 'node:fs'\n" + source.replace("await page.screenshot({path:'docs/test/publish-flow-mobile.png',fullPage:true})", extra))
try {
 const result=spawnSync(process.execPath,[fileURLToPath(temp)],{stdio:'inherit',windowsHide:true})
 process.exitCode=result.status??1
} finally { unlinkSync(temp) }
