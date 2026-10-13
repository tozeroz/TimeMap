const fs = require('fs')
const puppeteer = require('puppeteer-core')

const [, , MD_PATH, IDX, OUT_PNG, MERMAID_JS] = process.argv
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

function extract(md) {
  const blocks = []
  const re = /```mermaid\s*\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(md))) blocks.push(m[1].trim())
  return blocks
}

function shell(js) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff;} body{padding:28px;}
  #d{background:#fff;display:inline-block;} #d svg{max-width:none !important;}
  </style></head><body><div id="d" class="mermaid"></div>
  <script>${js}<\/script>
  <script>window.mermaid.initialize({startOnLoad:false,theme:'default',securityLevel:'loose',useMaxWidth:false});</script>
  </body></html>`
}

;(async () => {
  const md = fs.readFileSync(MD_PATH, 'utf8')
  const blocks = extract(md)
  const idx = parseInt(IDX, 10)
  if (!blocks[idx]) throw new Error('block index ' + idx + ' 不存在，共 ' + blocks.length + ' 块')
  const js = fs.readFileSync(MERMAID_JS, 'utf8')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 })
    await page.setContent(shell(js))
    await page.evaluate(async (src) => {
      const d = document.getElementById('d')
      d.textContent = src
      await window.mermaid.run({ nodes: [d] })
    }, blocks[idx])
    await page.waitForSelector('#d svg', { timeout: 40000 })
    await new Promise((r) => setTimeout(r, 200))
    // 展开为 viewBox 自然尺寸，避免 width="100%" 塌缩
    await page.evaluate(() => {
      const svg = document.querySelector('#d svg')
      const vb = svg.viewBox.baseVal
      if (vb && vb.width && vb.height) {
        svg.setAttribute('width', vb.width)
        svg.setAttribute('height', vb.height)
        svg.style.maxWidth = 'none'
      }
    })
    await new Promise((r) => setTimeout(r, 100))
    const size = await page.evaluate(() => {
      const r = document.querySelector('#d svg').getBoundingClientRect()
      return { w: Math.ceil(r.width), h: Math.ceil(r.height) }
    })
    await page.setViewport({ width: size.w + 120, height: size.h + 120, deviceScaleFactor: 2 })
    await new Promise((r) => setTimeout(r, 100))
    await page.screenshot({ path: OUT_PNG, fullPage: true })
    await page.close()
    console.log('OK  ' + OUT_PNG + '  svg=' + size.w + 'x' + size.h)
  } finally {
    await browser.close()
  }
})().catch((e) => { console.error('FAILED', e && e.message ? e.message : e); process.exit(1) })
