import type { ReactNode } from 'react'
import './shell.css'

/**
 * 手机外壳：状态栏 + 内容区。
 * 在浏览器里预览时限制最大宽度模拟手机；打包进 APK 后自适应全屏。
 * dark=true 时状态栏跟随深色页面（扫码/图片预览），避免白底突兀。
 */
export function Shell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className="shell">
      <div className={`shell__viewport ${dark ? 'shell__viewport--dark' : ''}`}>
        <div className="statusbar">
          <span className="statusbar__time">9:41</span>
          <span className="statusbar__icons">
            <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden>
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="4.5" y="5" width="3" height="6" rx="1" />
              <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="13.5" y="0" width="3" height="11" rx="1" />
            </svg>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden>
              <path d="M8 10.2 5.6 7.9a3.4 3.4 0 0 1 4.8 0L8 10.2ZM8 5.4a6.6 6.6 0 0 0-4.6 1.9L1.8 5.6A9.2 9.2 0 0 1 8 3a9.2 9.2 0 0 1 6.2 2.6l-1.6 1.7A6.6 6.6 0 0 0 8 5.4Z" />
            </svg>
            <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden>
              <rect x="0.5" y="1" width="21" height="10" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.5" />
              <rect x="2" y="2.5" width="17" height="7" rx="1.8" fill="currentColor" />
              <rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" fillOpacity="0.6" />
            </svg>
          </span>
        </div>
        <div className="shell__body">{children}</div>
      </div>
    </div>
  )
}

/** 通用页面骨架：可选头部 + 可滚动主体 */
export function Screen({
  header,
  children,
  className = '',
  scroll = true,
  footer,
}: {
  header?: ReactNode
  children: ReactNode
  className?: string
  scroll?: boolean
  footer?: ReactNode
}) {
  return (
    <div className={`screen ${className}`}>
      {header}
      <div
        className={`screen__body no-scrollbar ${scroll ? 'screen__body--scroll' : 'screen__body--fill'}`}
      >
        {children}
      </div>
      {footer}
    </div>
  )
}

/** 顶栏：左侧动作 + 中间标题 + 右侧动作 */
export function TopBar({
  left,
  center,
  right,
  variant = 'default',
}: {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
  variant?: 'default' | 'plain'
}) {
  return (
    <div className={`topbar topbar--${variant}`}>
      <div className="topbar__side topbar__side--left">{left}</div>
      <div className="topbar__center">{center}</div>
      <div className="topbar__side topbar__side--right">{right}</div>
    </div>
  )
}

/** 头部主标题：大号 Campus + 副标题下拉 */
export function BigTitle({
  title,
  sub,
  onSubClick,
}: {
  title: string
  sub: string
  onSubClick?: () => void
}) {
  return (
    <div className="bigtitle">
      <h1 className="bigtitle__main">{title}</h1>
      <button className="bigtitle__sub" onClick={onSubClick}>
        <span>{sub}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 15.5 5.5 9h13L12 15.5Z" />
        </svg>
      </button>
    </div>
  )
}
