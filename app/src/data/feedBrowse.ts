import { useEffect } from 'react'
import { buildHash, navigate } from '../router'

/** A frozen source order, scoped to the currently opened browsing session. */
export const feedBrowse: { ids: string[]; drafts: Record<string, string>; images: Record<string, number>; source: string; switched: boolean; token: string; scroll: number; campus?: { sort: 'hot' | 'latest'; placeIds: string[] } } = {
  ids: [], drafts: {}, images: {}, source: '', switched: false, token: '', scroll: 0,
}
export function openFeed(id: string, ids: string[]) {
  feedBrowse.ids = [...new Set(ids)]
  feedBrowse.drafts = {}
  feedBrowse.images = {}
  feedBrowse.switched = false
  feedBrowse.token = crypto.randomUUID()
  feedBrowse.scroll = document.querySelector('.screen__body--scroll')?.scrollTop ?? 0
  feedBrowse.source = window.location.hash
  navigate('feed', { id, browse: feedBrowse.token })
}
export function stepFeed(current: string, direction: number): string | undefined {
  const index = feedBrowse.ids.indexOf(current)
  const next = index >= 0 ? feedBrowse.ids[index + direction] : undefined
  if (next) window.history.replaceState(null, '', buildHash('feed', { id: next, browse: feedBrowse.token }))
  return next
}

/** Restore after asynchronous lists and images settle; stop once the user interacts. */
export function useFeedSourceRestore() {
  useEffect(() => {
    if (feedBrowse.source !== window.location.hash) return
    const body = document.querySelector<HTMLElement>('.screen__body--scroll')
    if (!body) return
    const restore = () => { body.scrollTop = feedBrowse.scroll }
    const observer = new ResizeObserver(restore)
    const watch = () => { Array.from(body.children).forEach(child => observer.observe(child)); restore() }
    const mutations = new MutationObserver(watch)
    mutations.observe(body, { childList: true, subtree: true })
    watch()
    const stop = () => { observer.disconnect(); mutations.disconnect() }
    body.addEventListener('pointerdown', stop, { once: true })
    body.addEventListener('wheel', stop, { once: true })
    return () => { stop(); body.removeEventListener('pointerdown', stop); body.removeEventListener('wheel', stop) }
  }, [])
}
