/**
 * 图片探测：从**字节内容**判断格式与尺寸，并做结构校验。
 *
 * 为什么必须自己解析（PLAN §6 / 审核记录 13 第 3 条）：
 *   "不只信 Content-Type，至少要根据实际文件内容确认允许的图片类型"
 *
 * 为什么不用 sharp / jimp 之类：
 *   服务器是 396 MB 内存 + 单文件 esbuild 打包 + 服务器上**没有 node_modules**。
 *   sharp 是 native 模块（要预编译产物），jimp 是纯 JS 但体积与内存都不划算。
 *   我们只需要"格式 + 尺寸 + 结构是否像真图"，三种格式的头部解析就几十行，
 *   比引入依赖更可控，也更好在 Gate 里机械验证。
 *
 * 注意：这里做的是**结构校验**（不是完整解码）。
 * 它足以拒绝"改了扩展名的文本/可执行文件"和"截断的图片"，
 * 但**不保证**图片一定能被渲染器正常显示（那需要真解码）。
 * 这个强度边界在报告里如实写明，不夸大成"完全解码验证"。
 */

export type ImageKind = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ImageProbe {
  ok: true
  mime: ImageKind
  width: number
  height: number
}

export interface ImageProbeError {
  ok: false
  reason: string
}

const err = (reason: string): ImageProbeError => ({ ok: false, reason })

/** PNG 签名 89 50 4E 47 0D 0A 1A 0A */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(buf: Uint8Array, sig: number[], at = 0): boolean {
  if (buf.length < at + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (buf[at + i] !== sig[i]) return false
  return true
}

const be16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!
const be32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0

/** PNG：必须能走完 IHDR（在第一个 chunk），且 IHDR 长度=13 */
function probePng(b: Uint8Array): ImageProbe | ImageProbeError {
  if (b.length < 33) return err('PNG 太短，连头部都不完整')
  if (!startsWith(b, PNG_SIG)) return err('PNG 签名不匹配')
  // 第一个 chunk 必须是 IHDR，长度 13
  const len = be32(b, 8)
  const type = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
  if (type !== 'IHDR') return err(`PNG 第一个 chunk 不是 IHDR（是 ${type}）`)
  if (len !== 13) return err(`PNG IHDR 长度异常（${len}）`)
  const width = be32(b, 16)
  const height = be32(b, 20)
  if (width <= 0 || height <= 0) return err(`PNG 尺寸非法（${width}x${height}）`)
  if (width > 20000 || height > 20000) return err(`PNG 尺寸过大（${width}x${height}）`)
  return { ok: true, mime: 'image/png', width, height }
}

/** JPEG：必须以 SOI(FFD8) 开头、以 EOI(FFD9) 附近结束，并能找到 SOF 帧拿到尺寸 */
function probeJpeg(b: Uint8Array): ImageProbe | ImageProbeError {
  if (b.length < 4) return err('JPEG 太短')
  if (!(b[0] === 0xff && b[1] === 0xd8)) return err('JPEG SOI 标记不匹配')
  // 结尾必须是 FFD9（允许末尾有少量填充/垃圾？—— 严格些：必须在最后 2 字节）
  if (!(b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9)) {
    return err('JPEG 缺少 EOI 结束标记（可能被截断）')
  }
  let o = 2
  while (o + 3 < b.length) {
    if (b[o] !== 0xff) return err(`JPEG 段标记错位 @${o}`)
    const marker = b[o + 1]!
    // 填充字节 FF 允许重复出现
    if (marker === 0xff) {
      o += 1
      continue
    }
    // 无长度字段的标记
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2
      continue
    }
    const segLen = be16(b, o + 2)
    if (segLen < 2) return err(`JPEG 段长度非法 @${o}`)
    // SOF0..SOF15 里除了 DHT(C4)/JPG(C8)/DAC(CC) 都带尺寸
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (o + 9 >= b.length) return err('JPEG SOF 段不完整')
      const height = be16(b, o + 5)
      const width = be16(b, o + 7)
      if (width <= 0 || height <= 0) return err(`JPEG 尺寸非法（${width}x${height}）`)
      if (width > 20000 || height > 20000) return err(`JPEG 尺寸过大（${width}x${height}）`)
      return { ok: true, mime: 'image/jpeg', width, height }
    }
    o += 2 + segLen
  }
  return err('JPEG 没有找到 SOF 帧（可能不是真图）')
}

/** WebP：RIFF....WEBP，再按 VP8 / VP8L / VP8X 三种分支取尺寸 */
function probeWebp(b: Uint8Array): ImageProbe | ImageProbeError {
  if (b.length < 30) return err('WebP 太短')
  if (!startsWith(b, [0x52, 0x49, 0x46, 0x46])) return err('WebP 缺少 RIFF 头')
  if (String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) !== 'WEBP') return err('WebP 缺少 WEBP 标识')
  const riffSize = b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)
  if (riffSize + 8 > b.length) return err('WebP 声明长度超过实际字节数（被截断）')
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!)
  if (fourcc === 'VP8 ') {
    // 关键帧头：找到 0x9d 0x01 0x2a 后的宽高（14 位各）
    const i = 26
    if (b.length < i + 4) return err('WebP VP8 头不完整')
    if (!(b[i + 3] === 0x9d && b[i + 4] === 0x01 && b[i + 5] === 0x2a)) {
      return err('WebP VP8 关键帧起始码不匹配')
    }
    const w = ((b[i + 6]! | (b[i + 7]! << 8)) & 0x3fff) >>> 0
    const h = ((b[i + 8]! | (b[i + 9]! << 8)) & 0x3fff) >>> 0
    if (w <= 0 || h <= 0) return err(`WebP 尺寸非法（${w}x${h}）`)
    return { ok: true, mime: 'image/webp', width: w, height: h }
  }
  if (fourcc === 'VP8L') {
    if (b.length < 25) return err('WebP VP8L 头不完整')
    if (b[20] !== 0x2f) return err('WebP VP8L 签名不匹配')
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
    const w = (bits & 0x3fff) + 1
    const h = ((bits >> 14) & 0x3fff) + 1
    if (w <= 0 || h <= 0) return err(`WebP 尺寸非法（${w}x${h}）`)
    return { ok: true, mime: 'image/webp', width: w, height: h }
  }
  if (fourcc === 'VP8X') {
    if (b.length < 30) return err('WebP VP8X 头不完整')
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1
    if (w <= 0 || h <= 0) return err(`WebP 尺寸非法（${w}x${h}）`)
    return { ok: true, mime: 'image/webp', width: w, height: h }
  }
  return err(`WebP 子格式不支持（${fourcc}）`)
}

/**
 * 按**内容**探测：不识别的格式一律拒绝。
 * 明确被拒绝的包括：SVG（文本）、GIF、BMP、TIFF、任意 binary、改名的文本/可执行文件。
 */
export function probeImage(buf: Uint8Array): ImageProbe | ImageProbeError {
  if (buf.length < 12) return err('内容太短，不可能是有效图片')
  if (startsWith(buf, PNG_SIG)) return probePng(buf)
  if (buf[0] === 0xff && buf[1] === 0xd8) return probeJpeg(buf)
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46])) return probeWebp(buf)
  // 明确点名 SVG：它是文本，最容易伪装成图片
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 200))).toString('utf8').trimStart()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return err('SVG/XML 不允许上传（可能是脚本载体）')
  return err('不认识的文件类型（只接受 jpeg/png/webp）')
}
