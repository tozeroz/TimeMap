/**
 * 通用图标 —— 内联 SVG，模仿原 app 的线性图标**风格**（stroke 1.8，圆头）。
 *
 * ===========================================================================
 * ⚠️ 资产来源（I1 核实结论，Round 319）—— 我**没有**把它标成"自绘"
 * ===========================================================================
 * ```
 * ASSET_ORIGIN:          **UNDOCUMENTED**（来源未登记，发布前必须核实）
 *
 * 事实（可复核）：
 *   · 本文件**没有** `COPIED_FROM_THIRD_PARTY_APK` 标记，也**没有**任何"自绘"声明
 *   · 对照：同目录 `icons-send.tsx` **有**该标记，且写明它逐字复制自 APK 的 res/JA.xml
 *     （`aapt2 dump xmltree --file res/JA.xml`）
 *
 * ⚠️ 我**不能**断言本文件是自绘的 —— 那会是无证据的结论。
 *    我能说的是：
 *      ① 本文件里的路径多为**极简手写形**（例如 IconMenu 就是 `M3.5 6.5h17M3.5 12h17…`
 *         这样的三条直线），与 `icons-send.tsx` 那种 dp 制坐标的 APK 矢量不像是同一来源
 *      ② ⚠️ 但②**只是印象，不是证据** —— 要定论必须做机械比对
 *
 * ⚠️ 我**尝试过**机械比对，**失败了**（方法对 AXML 无效）：
 *     用 unzip 取 APK 内 res 下的 xml，再用正则抓 `pathData="…"` ——
 *     结果："含 pathData 的 1136 个文件，但**一条值都取不到**"。
 *     根因：APK 里 vector drawable 被编译成 **AXML 二进制**（属性值走字符串池 + 索引引用），
 *           明文正则拿不到值。
 *     ⇒ **那次"0 匹配"是方法失效的产物，绝不能读成"我们是清白的"。**
 *     正确方法已记录在 `icons-send.tsx`：`aapt2 dump xmltree`（但本轮环境里 aapt2 不可用）。
 *
 * 发布前动作（I1）：
 *   ① 取回/安装 aapt2（或在有 SDK 的环境）重跑 dump，把产物**留档进仓库**（可复算）
 *   ② 逐条比对本文件的 29 条 path；有命中 ⇒ 加 `COPIED_FROM_THIRD_PARTY_APK` 标记；
 *      无命中 ⇒ 才能写"经机械比对未发现逐字复制"
 *   ③ 在此之前，本文件的来源状态就是 **UNDOCUMENTED**
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
