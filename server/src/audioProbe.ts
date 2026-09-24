/**
 * WebM / EBML 容器探测（**内容判定，不信任 Content-Type 与扩展名**）。
 *
 * 为什么需要它：`/api/media` 原本只接受图片（`probeImage`），语音消息要放开 `audio/webm`。
 * 若不看内容只看 multipart 的 `Content-Type`，攻击者可以把任意二进制声明成音频塞进来。
 * 本项目的既有原则是"**按内容判类型**"（见 imageProbe.ts 的文件头），这里沿用同一原则。
 *
 * ⚠️ **声明强度（审核记录 35 明确要求，必须逐字遵守）**：
 *   本函数证明的是"**这是一个结构有效的 WebM/EBML 容器**"，
 *   **不是**"里面一定只有音频轨"，也**不是**"它一定能播放"。
 *   → 代码注释、文档与 Gate 一律**不得**把它写成"服务端已证明 audio track"。
 *   原因：完整判定轨道构成需要解析 Matroska 的 Tracks/Segment 元素树，
 *   而 Phase 1 不需要那个强度（真正的把关在客户端录音链路 + 时长一致性约束）。
 *
 * 实现思路（只做必要的三项，不做完整 EBML 解析器）：
 *   ① EBML 魔数 `1A 45 DF A3`（EBML Header 的 ID）
 *   ② 在头部窗口内找到 DocType 元素（ID `0x4282`）且其值为 `webm`
 *   ③ 长度上限校验（矩阵/畸形输入不至于让我们在头部无限找）
 */

/** EBML Header 的 4 字节魔数 */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const

/** DocType 元素 ID（EBML 头部内的字符串元素，值应为 "webm" / "matroska"） */
const DOCTYPE_ID = [0x42, 0x82] as const

/** 只在前 N 字节内找 DocType：EBML 头本身很小，正常文件必然在此范围内 */
const HEADER_WINDOW = 512

export interface AudioProbe {
  ok: true
  mime: 'audio/webm'
  /** 探测方式，便于审计与 Gate 断言（当前只有 'ebml-header'） */
  via: 'ebml-header'
  /** DocType 的实际取值（'webm' / 'matroska'），用于诊断 */
  docType: string
  /** 找到 DocType 的偏移，便于诊断 */
  docTypeAt: number
}

export interface AudioProbeError {
  ok: false
  reason: string
}

const err = (reason: string): AudioProbeError => ({ ok: false, reason })

function matchesAt(b: Uint8Array, sig: readonly number[], at: number): boolean {
  if (at + sig.length > b.length) return false
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false
  return true
}

/**
 * 探测是否为 WebM（或 Matroska）容器。
 *
 * 返回 `ok: true` 时的 **准确含义**：头部结构上是有效的 EBML，且 DocType 声明为 webm/matroska。
 * 见本文件头部"声明强度"一节。
 */
export function probeAudioWebm(buf: Uint8Array): AudioProbe | AudioProbeError {
  if (buf.length < 8) return err('too_short')

  // ① EBML 魔数：必须出现在**文件开头**（EBML 头是文件的第一个元素）
  if (!matchesAt(buf, EBML_MAGIC, 0)) return err('not_ebml')

  // ② 在头部窗口内找 DocType（0x4282）并读其值
  const limit = Math.min(buf.length, HEADER_WINDOW)
  for (let i = 4; i < limit - 2; i++) {
    if (!matchesAt(buf, DOCTYPE_ID, i)) continue

    // DocType 是 EBML 字符串元素：ID(2) + 长度(vint) + 值
    const lenByte = buf[i + 2]
    // vint：首字节前导 1 的位置决定长度字段字节数
    let vintLen = 0
    for (let k = 0; k < 8; k++) {
      if (lenByte & (0x80 >> k)) {
        vintLen = k + 1
        break
      }
    }
    if (vintLen === 0) continue // 畸形长度

    // 值长度为 vint 去掉标记位后的数值（DocType 一定很短，单字节 vint 就够）
    let valueLen = lenByte & (0xff >> vintLen)
    const valueStart = i + 2 + vintLen
    if (valueLen <= 0 || valueLen > 16) continue
    if (valueStart + valueLen > buf.length) continue

    let s = ''
    for (let k = 0; k < valueLen; k++) s += String.fromCharCode(buf[valueStart + k])
    const docType = s.toLowerCase()

    // 只接受 webm（本单的范围）；matroska 也认，但不额外承诺它是音频
    if (docType === 'webm' || docType === 'matroska') {
      return { ok: true, mime: 'audio/webm', via: 'ebml-header', docType, docTypeAt: i }
    }
    return err(`doctype_not_webm:${docType.slice(0, 16)}`)
  }

  return err('doctype_not_found')
}
