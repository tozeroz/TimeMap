import { useEffect, useRef, type RefObject } from 'react'

const THRESHOLD_PX = 100
const IDLE_MS = 320
const SWITCH_LOCK_MS = 750

/** Kept on the browsing session so image/detail loading cannot reset a wheel gesture. */
export function usePostWheel(root: RefObject<HTMLDivElement | null>, onStep: (direction: number) => void) {
  const latest = useRef(onStep)
  useEffect(() => { latest.current = onStep }, [onStep])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const viewport = element.closest('.shell__viewport') ?? element
    let total = 0
    let lastEvent = -Infinity
    let lastSwitch = -Infinity
    let locked = false
    const wheel = (event: WheelEvent) => {
      // Preserve browser zoom / trackpad pinch and horizontal image gestures.
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const now = performance.now()
      const idle = now - lastEvent > IDLE_MS
      lastEvent = now
      if (idle) {
        total = 0
        if (now - lastSwitch >= SWITCH_LOCK_MS) locked = false
      }
      if (viewport.querySelector('[role="dialog"]') || (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) {
        // Let the foreground scroll naturally, and consume any inertia after it closes.
        total = 0
        locked = true
        return
      }
      if (!element.querySelector('.reader')) return
      event.preventDefault()
      if (locked) return
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1
      const delta = event.deltaY * unit
      if (Math.sign(delta) !== Math.sign(total)) total = 0
      total += delta
      if (Math.abs(total) < THRESHOLD_PX) return
      locked = true
      lastSwitch = now
      const direction = Math.sign(total)
      total = 0
      latest.current(direction)
    }
    viewport.addEventListener('wheel', wheel as EventListener, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel as EventListener)
  }, [root])
}
