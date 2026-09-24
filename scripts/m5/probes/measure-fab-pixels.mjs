/**
 * 定向测量原版截图**右下角发布按钮**的可见几何（只在右下小区域内找黑色连通块）。
 *
 * ## 为什么重做（记录上一次的无效方法，避免复用）
 *
 * 我先前写过一个"逐行统计白色/黑色占比"的扫描，结论是
 *   "连续白条高 199 设备 px、黑色区域 x=[136,1043] 宽 908px"
 * —— 这是**无效测量**：底部区是**照片卡片 + 栏**的混合内容，
 * "整行颜色占比"这种启发式在混合内容上不成立，黑色占比被暗色照片内容污染。
 * 按本项目纪律：**该结果标记 INVALID，不得用于一致性断言**（已写入证据文件）。
 *
 * ## 本脚本的改法：限定区域 + 连通性
 *   只在 **x ∈ [820,1080]、y ∈ [1600,1920]** 这个右下小窗口内，
 *   先找出"明显是深色"的像素，再求这些像素的**外接矩形**，
 *   并用"该矩形内深色像素占比是否接近 π/4 ≈ 78.5%"来判断它是否**接近圆**。
 *   这样照片内容即使也是深色，也不会形成"高填充率 + 近正方外接框"的形状。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const SRC = 'G:\\demo map\\docs\\original-baseline\\screens\\trident-campus\\normal.png'
const OUT = 'G:\\demo map\\docs\\m5\\EVIDENCE-original-fab-pixels.txt'

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('只支持 8-bit 非隔行')
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (!ch) throw new Error('只支持 RGB/RGBA')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0
      let v = cur[i]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { w, h, ch, data: out }
}

const img = decodePng(readFileSync(SRC))
const X0 = 820, X1 = 1080, Y0 = 1600, Y1 = Math.min(1920, img.h)
console.log(`PNG ${img.w}×${img.h}；扫描窗口 x=[${X0},${X1}] y=[${Y0},${Y1}]`)

const isDark = (x, y) => {
  const i = (y * img.w + x) * img.ch
  return img.data[i] <= 60 && img.data[i + 1] <= 60 && img.data[i + 2] <= 60
}

// 外接矩形 + 覆盖率
let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, dark = 0
for (let y = Y0; y < Y1; y++) {
  for (let x = X0; x < X1; x++) {
    if (isDark(x, y)) {
      dark++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}
const lines = []
const push = (s) => { console.log(s); lines.push(s) }

push('')
push('# 原版截图右下发布按钮（FAB）的定向像素测量')
push(`# 文件: ${SRC}（尺寸 ${img.w}x${img.h}）`)
push(`# 扫描窗口: x=[${X0},${X1}] y=[${Y0},${Y1}]`)
push(`# 深色判据: R,G,B 均 <= 60`)
push('')
if (maxX < 0) {
  push('  窗口内没有深色像素 → 无法测量')
} else {
  const bw = maxX - minX + 1, bh = maxY - minY + 1
  const fill = dark / (bw * bh)
  push(`  深色像素外接矩形: x=[${minX},${maxX}] y=[${minY},${maxY}]`)
  push(`  → 宽 ${bw} 设备 px，高 ${bh} 设备 px`)
  push(`  → 矩形内深色填充率 ${(fill * 100).toFixed(1)}%（正圆应 ≈ 78.5%；圆角方形更高；散乱内容会更低）`)
  push(`  → 宽高比 ${(bw / bh).toFixed(3)}（正圆应 ≈ 1.000）`)
  push('')
  const nearSquare = Math.abs(bw / bh - 1) < 0.08
  const nearCircle = fill > 0.7 && fill < 0.86
  push(`  判定: ${nearSquare && nearCircle ? '**符合"近正圆深色块"**（与视觉"黑色圆形 + 加号"一致）' : nearSquare ? '近正方但填充率偏离正圆 → 需人工看图确认' : '不像正圆 → 需人工看图确认'}`)
  push('')
  push(`  与原版 dump 的对照: dump 里该区域可点节点 = 187? 不 —— FAB 节点 bounds=[881,1052][1721,1892] → 171x171 设备 px`)
  push(`  与像素测得的可见深色块（${bw}x${bh}）比较：${bw <= 171 && bh <= 171 ? '可见块 **不大于** 节点外接框（合理：节点含 padding）' : '⚠ 可见块**大于**节点外接框 —— 说明我的深色判据把别的东西也算进来了，结论不可用'}`)
}
push('')
push('## ⚠️ 方法有效性声明')
push('本测量只在**右下固定小窗口**内做"深色像素外接矩形"，比先前"整行颜色占比"稳健；')
push('但**仍然只是启发式**：若窗口内恰好还有其它深色内容（照片暗部/阴影），会产生偏差。')
push('因此本结果用于**支持性证据**，不单独作为一致性判定的唯一依据。')
writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log('\n报告已写:', OUT)
