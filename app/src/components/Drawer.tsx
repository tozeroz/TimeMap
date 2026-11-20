import { useEffect, useRef, type ReactNode } from 'react'
import { navigate } from '../router'
import './drawer.css'

const ITEMS: Array<{ label: string; to: string }> = [
  { label: '账号与安全', to: 'account' },
  { label: '版本信息', to: 'about' },
]

/** 个人菜单只保留账号和维护入口；个人内容从「我的」页访问。 */
export function Drawer({ open, onClose, actions = [] }: { open: boolean; onClose: () => void; actions?: Array<{ label: string; action: () => void }> }) {
  const panel = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector('button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return }
      if (event.key !== 'Tab') return
      const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!buttons?.length) return
      const first = buttons[0]!, last = buttons[buttons.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [open])
  if (!open) return null
  return (
    <div className="drawer">
      <div className="drawer__mask" onClick={onClose} />
      <nav className="drawer__panel" ref={panel} role="dialog" aria-modal="true" aria-label="个人菜单">
        <header className="drawer__head">
          <span className="drawer__brand">TimeMap</span>
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
          {actions.map(item => <li key={item.label}><button className="drawer__item" onClick={() => { onClose(); item.action() }}>{item.label}</button></li>)}
        </ul>
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
