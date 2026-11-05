import { useEffect, useRef, type ReactNode } from 'react'

export function AdminIcon({ name }: { name: 'shield' | 'plus' | 'search' | 'filter' | 'refresh' | 'clock' | 'pin' | 'link' | 'eye' | 'edit' | 'more' }) {
  const paths = {
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
    plus: 'M12 4v16M4 12h16', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    filter: 'M3 4h18l-7 8v8l-4-2v-6L3 4Z', refresh: 'M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-5M4 14a8 8 0 0 0 14 5',
    clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    edit: 'm15 4 5 5M4 15 16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1 1-6ZM3 23h18',
    more: 'M4 12h.01M12 12h.01M20 12h.01',
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 4 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

/** Native modal supplies focus trapping, Escape and focus restoration. */
export function AdminDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); queueMicrotask(() => { if (opener?.isConnected) opener.focus() }) }
  }, [])
  return <dialog ref={ref} className="adm__dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="adm__dialogHead"><h3>{title}</h3><button type="button" aria-label="关闭" onClick={onClose}>×</button></div>
    {children}
  </dialog>
}
