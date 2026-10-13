/**
 * 通用图标 —— 内联 SVG，模仿原 app 的线性图标**风格**（stroke 1.8，圆头）。
 *
 * ===========================================================================
 * 资产来源（I1 核实结论，Round 319）—— **经机械比对未发现逐字复制**
 * ===========================================================================
 * ```
 * ASSET_ORIGIN:          ORIGINAL_WORK（依据：用 aapt2 对原版 APK 做了**全量**矢量 path 比对）
 * VERIFICATION:          机械比对，**自检通过**（详见 docs/pending/m5/I1-ICON-PROVENANCE-FINDING.md）
 *
 * 做法与结果（可复算；脚本 scripts/m5/i1-icon-provenance-aapt2.mjs）：
 *   ① `aapt2 dump resources target.apk` 取全部 xml 资源路径（2626 个）
 *   ② 逐个 `aapt2 dump xmltree --file <res> target.apk` 解出 pathData
 *      ⇒ 1136 个资源含 pathData；**去重后 1831 条**原版矢量 path
 *   ③ 与本文件提取出的 30 条候选 path 逐字比对 ⇒ **命中 0 条**
 *
 * ⭐ 为什么这个"0"可信（而前两次的"0"不可信）：
 *   我在脚本里加了**自检**——同目录 `icons-send.tsx` **已知**逐字复制自 `res/JA.xml`，
 *   所以它**必须**至少命中 1 条，否则说明"仪器没工作"。
 *   ```
 *   第一次：unzip + 明文正则 ⇒ "1136 文件含 pathData 但 0 条值可取"
 *           根因：APK 里是 **AXML 二进制** ⇒ 自检 FAIL（没启用时我差点误读成"干净"）
 *   第二次：改用 aapt2，但我的资源表正则写错（以为是 `->`，实际是 `(file)`）
 *           ⇒ 0 个资源可解 ⇒ 0 命中 ⇒ **自检再次 FAIL**（抓出来了）
 *   第三次：修正正则 + 全量 ⇒ 自检 **PASS**（icons-send 命中 2 条，正是那两条）
 *   ```
 *   ⇒ 只有自检 PASS 的那一次，"0 命中"才是证据。
 *
 * ⚠️ 本结论的**边界**（必须随结论一起引用）：
 *   · 规范化比对会忽略空白/逗号差异 ⇒ "命中"= 几何写法一致，不保证字节一致；
 *     反向同理：未命中 ⇒ 不存在**逐字**（规范化后）相同的 path
 *   · 只覆盖 `<path pathData=...>`；**位图资源（PNG/WebP）不在内**
 *   · 我们若用非 SVG 画法（canvas 等）也不在覆盖内
 *   · ⇒ 它证明的是"**未发现逐字复制的矢量 path**"，**不是**"绝无任何派生关系"。
 *     形状相似但改了坐标（例如按截图临摹后微调）**不会**被本法发现。
 *
 * I3（若确定公开）：若 Owner 决定公开发布，仍建议按"视觉等价但非直接复制"重绘一遍
 *   以彻底规避争议；本文件的 30 条 path 目前**没有**已知的侵权来源。
 * ```
 */

interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export function IconMenu({ size = 22, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
    </svg>
  )
}

export function IconShare({ size = 22, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M12 16V4M8 7.5 12 3.5l4 4" />
      <path d="M5 14v5.5h14V14" />
    </svg>
  )
}

export function IconChatBubble({ size = 22, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2-1 0-2-.15-2.9-.4L4.2 20.5l1.3-3.6C4.1 15.6 3.5 14 3.5 12.2c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z" />
    </svg>
  )
}

export function IconChevronDown({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="m6 9.5 6 5.5 6-5.5" />
    </svg>
  )
}

export function IconChevronRight({ size = 16, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="m9.5 6 5.5 6-5.5 6" />
    </svg>
  )
}

export function IconBack({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  )
}

export function IconClose({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function IconPlus({ size = 24, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconHeart({ size = 20, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.2s-7.3-4.5-7.3-9.5A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.3 2.7c0 5-7.3 9.5-7.3 9.5Z" />
    </svg>
  )
}

export function IconComment({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.8}>
      <path d="M20.5 11.8c0 3.9-3.8 7-8.5 7-.9 0-1.8-.12-2.6-.34L5 20l1.4-3.2A6.7 6.7 0 0 1 3.5 11.8c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" />
    </svg>
  )
}

export function IconStar({ size = 20, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.6-.8Z" />
    </svg>
  )
}

export function IconLocation({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" />
      <circle cx="12" cy="10.6" r="2.3" />
    </svg>
  )
}

export function IconCompass({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m14.8 9.2-1.6 4.2-4.2 1.6 1.6-4.2Z" />
    </svg>
  )
}

export function IconMapTab({ size = 22, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M9 4.5 4 6.5v13l5-2 6 2 5-2v-13l-5 2-6-2Z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </svg>
  )
}

export function IconAt({ size = 22, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 8.4v4.9a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" />
    </svg>
  )
}

export function IconPaw({ size = 22, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <ellipse cx="7.2" cy="9.5" rx="1.9" ry="2.3" />
      <ellipse cx="16.8" cy="9.5" rx="1.9" ry="2.3" />
      <ellipse cx="4.6" cy="14" rx="1.7" ry="2.1" />
      <ellipse cx="19.4" cy="14" rx="1.7" ry="2.1" />
      <path d="M12 12.6c2.6 0 4.6 2 4.6 4.1 0 1.7-1.5 2.7-3.3 2.4-.9-.2-1.7-.2-2.6 0-1.8.3-3.3-.7-3.3-2.4 0-2.1 2-4.1 4.6-4.1Z" />
    </svg>
  )
}

export function IconSearch({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

export function IconEdit({ size = 18, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m14.5 5.5 4 4" />
    </svg>
  )
}

export function IconCamera({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M4 8.5h3l1.5-2h7L17 8.5h3v10H4Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  )
}

export function IconImage({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m5 17 4.5-4.5 3 3L16 12l3 3" />
    </svg>
  )
}

/** 前后置摄像头切换（相机 + 回旋箭头） */
export function IconFlip({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M4 8.5h3l1.5-2h7L17 8.5h3v10H4Z" />
      <circle cx="12" cy="13" r="2.6" />
      <path d="M20 5.5a8 8 0 0 0-6.5-2.2" />
      <path d="M20 3v3h-3" />
    </svg>
  )
}

/** 麦克风 */
export function IconMic({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  )
}

export function IconEmoji({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 14.2c.9.9 1.9 1.4 3 1.4s2.1-.5 3-1.4" />
      <path d="M9.2 9.6h.01M14.8 9.6h.01" strokeWidth={2.4} />
    </svg>
  )
}

export function IconMore({ size = 20, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M6.5 12h.01M12 12h.01M17.5 12h.01" strokeWidth={2.6} />
    </svg>
  )
}

export function IconRefresh({ size = 20, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M20 12a8 8 0 1 1-2.7-6" />
      <path d="M20 5v5h-5" />
    </svg>
  )
}

export function IconCheck({ size = 18, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="m5 12.5 5 5 9-10" />
    </svg>
  )
}
