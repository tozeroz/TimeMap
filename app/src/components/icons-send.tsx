/**
 * 发送按钮图标（WO#7）—— **按原版矢量资源的精确路径复刻**。
 *
 * 为什么单独放一个文件（不并入 icons.tsx）：
 *   `icons.tsx` 的图标统一走 `base(size)` 辅助，其 viewBox 固定为方形 `0 0 24 24`；
 *   而原版发送按钮的 viewBox 是 **56×36（非方形）**，套不进那套辅助。
 *   与其为它把 `base()` 改成支持非方形（会牵动 27 个既有图标），不如单独放。
 *
 * 证据来源（可复现、可采信）：
 *   `drawable/ic_send_msg_btn` → 混淆路径 `res/JA.xml`（**矢量 XML，不是位图**）
 *   命令：`aapt2 dump xmltree --file res/JA.xml <apk>`
 *
 * 原版声明（逐字抄录）：
 *   vector width=56dp height=36dp viewportWidth=56 viewportHeight=36
 *     path fillColor=#ff000000  pathData="M18,0L38,0A18,18 0,0 1,56 18 …z"   ← 黑色胶囊底
 *     path fillColor=#ffffffff  pathData="M25.062,19.405 …"                  ← 白色纸飞机
 *
 * 为什么这里可以"照抄路径"而不算"猜字形"：
 *   矢量 XML 的 pathData **就是绘制指令本身** —— 它属于"形状"这一层的直接证据，
 *   比"布局里声明了一个 56dp 的 ImageView"强得多（后者只证明存在一个控件）。
 *   ⚠️ 但**不要**读成"原版渲染出来的像素就是这样"：主题着色/抗锯齿/缩放的最终像素
 *      仍属 runtime 渲染层，本单不声称。
 *
 * ⚠️ 可见性规则不在本文件：原版 `sendBtn` 默认为 GONE，
 *   但"什么条件切换 VISIBLE"**未取证**（`COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED`）——
 *   本组件的显示时机由调用方决定，属**我方设计选择**，不得对外声称与原版一致。
 */
import type { SVGProps } from 'react'

interface IconSendProps extends SVGProps<SVGSVGElement> {
  /** 高度（CSS px）。原版 height=36dp；宽度按 viewBox 比例自动推导（56:36） */
  size?: number
}

export function IconSend({ size = 36, ...rest }: IconSendProps) {
  // 原版 viewBox 14:9（56×36）→ 按高度缩放、宽度按比例推导
  const height = size
  const width = Math.round((56 / 36) * height)
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 56 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      {/* 黑色胶囊底（原版 path1，fillColor=#ff000000）。用 currentColor 以便主题化 */}
      <path
        d="M18,0L38,0A18,18 0,0 1,56 18L56,18A18,18 0,0 1,38 36L18,36A18,18 0,0 1,0 18L0,18A18,18 0,0 1,18 0z"
        fill="currentColor"
      />
      {/* 白色纸飞机 / 发送字形（原版 path2，fillColor=#ffffffff） */}
      <path
        d="M25.062,19.405L31.027,14.422L23.141,17.937L18.805,14.622C18.709,14.549 18.637,14.45 18.596,14.337C18.556,14.225 18.548,14.103 18.575,13.986C18.601,13.869 18.661,13.762 18.747,13.678C18.832,13.595 18.94,13.537 19.058,13.513L36.632,9.89C36.735,9.869 36.841,9.874 36.942,9.905C37.042,9.936 37.133,9.992 37.206,10.068C37.279,10.143 37.332,10.236 37.36,10.337C37.388,10.438 37.39,10.545 37.365,10.647L33.922,25.072C33.897,25.174 33.848,25.267 33.779,25.345C33.709,25.422 33.621,25.481 33.523,25.516C33.425,25.551 33.32,25.561 33.217,25.545C33.114,25.529 33.017,25.487 32.934,25.424L25.062,19.405ZM23.425,24.387L24.284,20.364L27.653,22.965L24.37,25.045C24.266,25.111 24.145,25.144 24.021,25.142C23.899,25.139 23.779,25.1 23.678,25.03C23.577,24.959 23.499,24.861 23.454,24.746C23.409,24.632 23.399,24.507 23.425,24.387Z"
        fill="var(--c-primary-fg, #fff)"
      />
    </svg>
  )
}
