import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconChevronDown } from './icons'
import { navigate, useRoute } from '../router'

export function ActivityModeTitle({ onSelect }: { onSelect?: () => void }) {
  const route = useRoute(), projects = route.query.mode === 'projects'
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
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
  return <div className="acts__mode" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }} onKeyDown={e => {
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault()
      if (!open) { setOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus()) }
      else {
        const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
  }}>
    <h1 className="acts__title"><button ref={trigger} className="acts__modeTrigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{projects ? '实训项目' : '校园活动'}<IconChevronDown size={23} /></button></h1>
    {open && <div className="acts__modeMenu" role="menu" aria-label="选择内容模式">{[false, true].map(p => <button key={String(p)} role="menuitemradio" aria-checked={p === projects} onClick={() => choose(p)}>{p ? '实训项目' : '校园活动'}{p === projects && <IconCheck size={19} />}</button>)}</div>}
  </div>
}
