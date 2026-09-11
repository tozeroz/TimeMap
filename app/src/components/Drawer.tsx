import type { ReactNode } from 'react'
import { navigate } from '../router'
import './drawer.css'

const ITEMS: Array<{ label: string; to: string; demoOnly?: boolean }> = [
  { label: '账号与安全', to: 'account' },
  { label: '编辑资料', to: 'edit-profile' },
  { label: '校园认证', to: 'verify' },
  { label: '隐私设置', to: 'privacy' },
  { label: '黑名单', to: 'blacklist' },
  { label: '版本信息', to: 'about' },
  { label: '联系我们', to: 'contact' },
  { label: '扫一扫', to: 'scanner' },
]

/**
 * 侧边抽屉菜单（原版：个人页左上角三横线打开）。
 * 菜单项按原版实测：账号与安全 / 编辑资料 / 校园认证 / 隐私设置 / 黑名单 / 版本信息 / 联系我们 / 扫一扫。
 * 末尾额外保留一个「更多功能」入口，用于访问 demo 的其余页面（非原版内容，单独标注）。
 */
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="drawer">
      <div className="drawer__mask" onClick={onClose} />
      <nav className="drawer__panel">
        <header className="drawer__head">
          <span className="drawer__brand">Campus</span>
        </header>
        <ul className="drawer__list">
          {ITEMS.map((item) => (
            <li key={item.to}>
              <button
                className="drawer__item"
                onClick={() => {
                  onClose()
                  navigate(item.to)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="drawer__divider" />
        <button
          className="drawer__item drawer__item--demo"
          onClick={() => {
            onClose()
            navigate('more')
          }}
        >
          更多功能
          <span className="drawer__badge">demo</span>
        </button>
      </nav>
    </div>
  )
}

/** 抽屉里的二级页统一用这个壳 */
export function DrawerPage({
  title,
  children,
  onBack,
}: {
  title: string
  children?: ReactNode
  onBack: () => void
}) {
  return (
    <div className="dp">
      <div className="dp__bar">
        <button className="dp__back" onClick={onBack} aria-label="返回">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="dp__title">{title}</span>
      </div>
      <div className="dp__body no-scrollbar">{children}</div>
    </div>
  )
}
