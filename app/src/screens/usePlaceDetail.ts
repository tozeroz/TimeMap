import { useCallback, useEffect, useRef, useState } from 'react'
import { getPlace, type ApiPlaceDetail } from '../api/client'

export type PlaceSort = 'latest' | 'hot'
export type PlaceFilter = 'all' | 'image'

interface Loaded {
  forId: string | null
  place: ApiPlaceDetail | null
  phase: 'loading' | 'ready' | 'error' | 'not_found'
  error: string | null
  feedPhase: 'ready' | 'loading' | 'error'
  allEmpty: boolean | null
}

/**
 * 地点详情数据（抽屉与 #/poidetail 共用）。
 *
 * - id 变化：渲染期间就派生出「loading / 初始排序」，不靠 effect 清空，避免闪出上一个地点。
 * - 选择状态 { forId, sort, filter } 原子保存：切换地点时 sort 由派生值回到 initialSort，
 *   只有一个请求 effect，不会因为「重置 sort」多发一次请求（design-review F4）。
 * - 同一地点切换排序：保留 place，只刷新帖子区（feedPhase）。
 * - generation 计数丢弃过期响应。
 */
export function usePlaceDetail(id: string, initialSort: PlaceSort) {
  const [sel, setSel] = useState<{ forId: string; sort: PlaceSort; filter: PlaceFilter }>({ forId: id, sort: initialSort, filter: 'all' })
  const [state, setState] = useState<Loaded>({ forId: null, place: null, phase: 'loading', error: null, feedPhase: 'ready', allEmpty: null })
  const [retryToken, setRetryToken] = useState(0)
  const generation = useRef(0)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const selFresh = sel.forId === id
  const sort = selFresh ? sel.sort : initialSort
  const filter = selFresh ? sel.filter : 'all'

  useEffect(() => {
    const v = ++generation.current
    if (!id) return // 渲染期间派生为「未指定地点」
    const cur = stateRef.current
    const feedRefresh = cur.forId === id && cur.place !== null && cur.phase === 'ready'
    if (feedRefresh) setState(s => ({ ...s, feedPhase: 'loading' }))
    else if (cur.forId === id) setState(s => ({ ...s, phase: 'loading' }))
    void (async () => {
      const r = await getPlace(id, sort)
      if (v !== generation.current) return
      if (!r.ok) {
        if (feedRefresh) setState(s => ({ ...s, feedPhase: 'error' }))
        else setState({ forId: id, place: null, phase: r.status === 404 ? 'not_found' : 'error', error: r.human ?? r.reason, feedPhase: 'ready', allEmpty: null })
        return
      }
      const empty = r.value.posts.length === 0
      setState({ forId: id, place: r.value, phase: 'ready', error: null, feedPhase: 'ready', allEmpty: sort === 'hot' && empty ? null : empty })
      // 热门窗口为空时探测一次最新，判断是不是「从未有人发过」；探测失败不下结论
      if (sort === 'hot' && empty) {
        const latest = await getPlace(id, 'latest')
        if (v === generation.current && latest.ok) setState(s => ({ ...s, allEmpty: latest.value.posts.length === 0 }))
      }
    })()
  }, [id, sort, retryToken])

  useEffect(() => () => { generation.current++ }, [])

  const stale = state.forId !== id
  const setSort = useCallback((s: PlaceSort) => setSel(p => ({ forId: id, sort: s, filter: p.forId === id ? p.filter : 'all' })), [id])
  const setFilter = useCallback((f: PlaceFilter | ((f: PlaceFilter) => PlaceFilter)) => setSel(p => {
    const prev = p.forId === id ? p.filter : 'all'
    return { forId: id, sort: p.forId === id ? p.sort : initialSort, filter: typeof f === 'function' ? f(prev) : f }
  }), [id, initialSort])
  const retry = useCallback(() => setRetryToken(n => n + 1), [])

  return {
    place: stale ? null : state.place,
    phase: !id ? ('error' as const) : stale ? ('loading' as const) : state.phase,
    error: !id ? '未指定地点' : stale ? null : state.error,
    feedPhase: stale ? ('ready' as const) : state.feedPhase,
    allEmpty: stale ? null : state.allEmpty,
    sort,
    filter,
    setSort,
    setFilter,
    retry,
    retryFeed: retry,
  }
}
