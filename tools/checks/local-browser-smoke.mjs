import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url)
const {chromium}=require(join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const browser=await chromium.launch({headless:true,executablePath:join(homedir(),'AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe')})
try {
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const session=JSON.parse(fs.readFileSync('.local/test-session.json','utf8'))
 await page.addInitScript(session=>localStorage.setItem('campus.demo.session.v1',JSON.stringify(session)),session)
 const apiRequests=[]
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiRequests.push(r.url())})
 await page.goto('http://127.0.0.1:5180/#/publish')
 await page.locator('.pub__overlay').waitFor({state:'hidden'})
 await page.locator('#pub-place').selectOption('aaaaaaaa-1111-4111-8111-000000000004')
 await page.locator('#pub-text').fill('本机环境验证：数据库、登录与地图发布流程。')
 await page.locator('.pub__publish').click()
 await page.waitForURL('**/map?*')
 await page.getByRole('button',{name:'查看帖子',exact:true}).waitFor()
 assert(apiRequests.length>0)
 assert(apiRequests.every(url=>url.startsWith('http://127.0.0.1:3002/')))
 console.log('PASS: real browser loaded landmarks, published text, returned to map; all API requests use local backend:3002.')
} finally {await browser.close()}
