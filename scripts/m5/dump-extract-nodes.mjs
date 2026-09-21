/**
 * 从**已入册的只读 dump** 提取原版群聊页的可见文本与控件结构。
 *
 * ⚠️ 为什么不用 PowerShell 一行流（我第一版就栽在这）：
 *   PowerShell 的 `$matches` 会被**每一次** `-match` 覆盖 ——
 *   先 `if ($tag -match 'text="([^"]+)"')` 再 `if ($tag -match 'bounds=...')`，
 *   第二个匹配就把 $matches 换掉了，于是"文本"印出来的是坐标数字（'513' / '63'…）。
 *   用 Node 一次把属性全抽出来，不依赖任何会被覆盖的全局状态。
 */
import { readFileSync } from 'node:fs'

const DUMP = process.argv[2] || 'G:\\demo map\\docs\\original-baseline\\screens\\original-chat\\20260921-205407-04-chat-open.xml'
const xml = readFileSync(DUMP, 'utf8')

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? m[1] : ''
}
const nodes = [...xml.matchAll(/<node\b[^>]*?\/?>/g)].map((m) => m[0])

const rows = []
for (const tag of nodes) {
  const b = attr(tag, 'bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  if (!b) continue
  const [, x1, y1, x2, y2] = b
  rows.push({
    cls: (attr(tag, 'class') || '').split('.').pop(),
    rid: attr(tag, 'resource-id').replace(/^com\.kairuotu\.campus:id\//, ''),
    text: attr(tag, 'text'),
    desc: attr(tag, 'content-desc'),
    clickable: attr(tag, 'clickable'),
    x1: +x1, y1: +y1, x2: +x2, y2: +y2,
  })
}

console.log(`=== 原版群聊页 dump：${rows.length} 个带 bounds 的节点 ===\n`)

const withText = rows.filter((r) => r.text !== '' || r.desc !== '')
console.log(`--- 有 text/content-desc 的节点（按 y 排序）：共 ${withText.length} ---`)
for (const r of withText.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)) {
  const t = r.text || `[desc]${r.desc}`
  console.log(`  y=${String(r.y1).padStart(4)} x=[${String(r.x1).padStart(4)},${String(r.x2).padStart(4)}] ${r.cls.padEnd(18)} ${r.rid.padEnd(22)} '${t}'`)
}

console.log('\n--- 顶部区（y<300）的完整控件链（含无文本节点）---')
for (const r of rows.filter((x) => x.y1 < 300).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)) {
  console.log(`  y=[${r.y1},${r.y2}] x=[${r.x1},${r.x2}] clk=${r.clickable.padEnd(5)} ${r.cls.padEnd(18)} ${r.rid.padEnd(22)} ${r.text ? `'${r.text}'` : ''}`)
}

console.log('\n--- 可点击控件（用户可达的入口）---')
for (const r of rows.filter((x) => x.clickable === 'true').sort((a, b) => a.y1 - b.y1)) {
  console.log(`  y=[${r.y1},${r.y2}] x=[${r.x1},${r.x2}] ${r.cls.padEnd(18)} ${r.rid.padEnd(22)} ${r.text ? `'${r.text}'` : ''}`)
}
