import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconClose } from './icons'
import { navigate, useRoute } from '../router'

const HINT_KEY = 'timemap.activity-mode-hint.dismissed.v1'
// Keep dismissal for this session even when WebView/browser storage is unavailable.
let hintDismissed = false
function shouldShowHint() {
  if (hintDismissed) return false
  try { return localStorage.getItem(HINT_KEY) !== '1' } catch { return true }
}

export function ActivityModeTitle({ onSelect }: { onSelect?: () => void }) {
  const route = useRoute(), projects = route.query.mode === 'projects'
  const [open, setOpen] = useState(false)
  const [hintPending, setHintPending] = useState(shouldShowHint)
  const showHint = hintPending && !projects && !open
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  function dismissHint() {
    hintDismissed = true
    setHintPending(false)
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* Session fallback above. */ }
  }
  function openMenu() {
    dismissHint()
    setOpen(true)
  }
  useEffect(() => {
    if (!showHint) return
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const hintHadFocus = root.current?.querySelector('.acts__modeHint')?.contains(document.activeElement)
      dismissHint()
      if (hintHadFocus) trigger.current?.focus()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [showHint])
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  function choose(projectMode: boolean) {
    setOpen(false); onSelect?.()
    const query = { ...route.query }
    if (projectMode) { query.mode = 'projects'; query.view = 'all' }
    else { delete query.mode; delete query.view }
    navigate('activities', query)
    trigger.current?.focus()
  }
  return <div className={`acts__mode${showHint ? ' acts__mode--hint' : ''}`} ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }} onKeyDown={e => {
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault()
      if (!open) { openMenu(); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus()) }
      else {
        const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
  }}>
    <h1 className="acts__title"><button ref={trigger} className="acts__modeTrigger" aria-haspopup="menu" aria-expanded={open} aria-describedby={showHint ? 'activity-mode-hint-text' : undefined} onClick={() => { if (open) setOpen(false); else openMenu() }}>{projects ? '实训项目' : '校园活动'}<IconChevronDown size={23} /></button></h1>
    {showHint && <div className="acts__modeHint">
      <span id="activity-mode-hint-text">点击这里，切换实训项目</span>
      <button type="button" className="acts__modeHintClose" aria-label="关闭实训项目提示" onClick={() => { dismissHint(); trigger.current?.focus() }}><IconClose size={18} /></button>
    </div>}
    {open && <div className="acts__modeMenu" role="menu" aria-label="选择内容模式">{[false, true].map(p => <button key={String(p)} role="menuitemradio" aria-checked={p === projects} onClick={() => choose(p)}>{p ? '实训项目' : '校园活动'}{p === projects && <IconCheck size={19} />}</button>)}</div>}
  </div>
}
