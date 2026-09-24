/**
 * ❌❌ 本方法已被判定 **INVALID —— 请勿使用其结论**（文件名带 INVALID 即为此意）❌❌
 *
 * 保留本脚本的唯一目的：**记录一次无效测量**，以免后人（或未来的我）重复这条路。
 *
 * 无效原因（详见 docs/m5/WO6-PLAN-tabbar-vertical-layout.md §五）：
 *   原版该页底部区是**照片卡片 + 栏**的混合内容，
 *   "逐行统计白/黑颜色占比"这种启发式在混合内容上**不成立** ——
 *   黑色占比会被暗色照片内容污染，得出"黑色区域宽 908 设备 px"这种明显荒谬的结果。
 *
 * → 它产出的 docs/m5/EVIDENCE-original-tabbar-pixels.txt
 *   **不得用于任何一致性断言**（该文件已按此标注）。
 *
 * 教训（与既有纪律同源）：**测量方法本身必须先被验证**，
 *   "我测了" ≠ "我测得对"；无效测量的数字比没有数字更危险。
 *
 * ---------------------------------------------------------------------------
 * 用**像素扫描**精确测量原版截图里底部栏的可见几何。
 *
 * 为什么不用视觉模型估算：视觉给的是"约 1/19~1/20"这种量级估计，
 * 不足以判定"可见白条高 vs 可点区高"这类差 1.7 倍的量。
 * 本项目纪律：**几何类结论必须给出可复核的数值证据**。
 *
 * 本脚本自己解码 PNG（Node 自带 zlib，无需第三方依赖），只支持非隔行的 8-bit RGB/RGBA/灰度。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const SRC = 'G:\\demo map\\docs\\original-baseline\\screens\\trident-campus\\normal.png'
const OUT = 'G:\\demo map\\docs\\m5\\EVIDENCE-original-tabbar-pixels.txt'

/** 极简 PNG 解码 → {w,h,channels,data} */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error('只支持 8-bit（实际 ' + bitDepth + '）')
  if (interlace !== 0) throw new Error('不支持隔行 PNG')
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0
  if (!ch) throw new Error('不支持的颜色类型 ' + colorType)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.from(line)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = cur[i]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
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
console.log(`PNG ${img.w}×${img.h} ch=${img.ch}`)

const px = (x, y) => {
  const i = (y * img.w + x) * img.ch
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}
/** 该行的“白”占比（R,G,B 都 >=245） */
function whiteRatio(y) {
  let n = 0
  for (let x = 0; x < img.w; x += 2) {
    const [r, g, b] = px(x, y)
    if (r >= 245 && g >= 245 && b >= 245) n++
  }
  return n / Math.ceil(img.w / 2)
}
/** 该行黑色占比（都 <=40） */
function blackRatio(y) {
  let n = 0
  for (let x = 0; x < img.w; x += 2) {
    const [r, g, b] = px(x, y)
    if (r <= 40 && g <= 40 && b <= 40) n++
  }
  return n / Math.ceil(img.w / 2)
}

console.log('\n=== 从底部往上扫描 ===')
const lines = []
lines.push(`# 原版截图底部栏像素扫描`)
lines.push(`# 文件: ${SRC}`)
lines.push(`# 尺寸: ${img.w}x${img.h}`)
lines.push('')
for (let y = img.h - 1; y >= img.h - 260; y -= 5) {
  const wr = whiteRatio(y), br = blackRatio(y)
  const s = `  y=${String(y).padStart(4)}  白占比=${(wr * 100).toFixed(1)}%  黑占比=${(br * 100).toFixed(1)}%`
  console.log(s)
  lines.push(s)
}

// 找“连续白条”的区间：从底部往上，白占比 >=90% 的连续段
let topOfWhite = null
for (let y = img.h - 1; y >= 0; y--) {
  if (whiteRatio(y) >= 0.9) {
    topOfWhite = y
  } else if (topOfWhite !== null) {
    break
  }
}
console.log('\n=== 结论 ===')
lines.push('')
lines.push('=== 结论 ===')
if (topOfWhite !== null) {
  const visH = img.h - topOfWhite
  const msg = `  连续白条（白占比>=90%）的顶边 y=${topOfWhite} → 可见白条高度 = ${visH} 设备 px（屏高 ${img.h}）`
  console.log(msg); lines.push(msg)
  const msg2 = `  → 占屏高 1/${(img.h / visH).toFixed(1)}`
  console.log(msg2); lines.push(msg2)
  const msg3 = `  → 换算 CSS px（dpr≈1.75）: ${(visH / 1.75).toFixed(1)} px`
  console.log(msg3); lines.push(msg3)
} else {
  console.log('  未找到连续白条'); lines.push('  未找到连续白条')
}

// 黑圆的竖直范围：找黑占比 > 1% 的行（圆在右侧，占比不大）
let blackTop = null, blackBottom = null
for (let y = img.h - 1; y >= img.h - 300; y--) {
  const br = blackRatio(y)
  if (br > 0.01) {
    if (blackBottom === null) blackBottom = y
    blackTop = y
  }
}
if (blackTop !== null) {
  const m1 = `  黑色区域（右下发按钮）纵向范围 y=[${blackTop},${blackBottom}] → 高 ${blackBottom - blackTop + 1} 设备 px`
  console.log(m1); lines.push(m1)
  // 水平范围（在圆的纵向中点扫描）
  const ymid = Math.round((blackTop + blackBottom) / 2)
  let x0 = null, x1 = null
  for (let x = 0; x < img.w; x++) {
    const [r, g, b] = px(x, ymid)
    if (r <= 40 && g <= 40 && b <= 40) {
      if (x0 === null) x0 = x
      x1 = x
    }
  }
  const m2 = `  在 y=${ymid} 处黑色水平范围 x=[${x0},${x1}] → 宽 ${x1 - x0 + 1} 设备 px`
  console.log(m2); lines.push(m2)
}

writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log('\n报告已写:', OUT)
