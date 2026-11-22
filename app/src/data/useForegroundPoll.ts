import { useEffect, useRef } from 'react'
import { getSession } from '../api/session'

/** Visible-page polling, one in flight, capped backoff, scoped to the starting account. */
export function useForegroundPoll(task: () => Promise<boolean>, interval: number, enabled = true) {
  const current = useRef(task)
  current.current = task
  useEffect(() => {
    if (!enabled) return
    const token = getSession()?.token
    let active = true, running = false, delay = interval
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => { clearTimeout(timer); if (active && document.visibilityState === 'visible') timer = setTimeout(run, delay) }
    const run = async () => {
      if (!active || running || document.visibilityState !== 'visible' || getSession()?.token !== token) return
      running = true
      try { delay = await current.current() ? interval : Math.min(delay * 2, 30000) }
      catch { delay = Math.min(delay * 2, 30000) }
      finally { running = false; schedule() }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState === 'visible') void run() }
    schedule()
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible)
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [interval, enabled])
}
