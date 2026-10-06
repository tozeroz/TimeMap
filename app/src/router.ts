/**
 * 极简 hash 路由 —— 不引第三方依赖。
 * 为什么用 hash：Capacitor 打包后页面通过 file:// / WebView 加载，
 * history 模式在子路径下会 404，hash 最省心。
 */
import { useCallback, useEffect, useState } from 'react'

export interface Route {
  /** 路径，例如 'campus' / 'feed/p1' / 'chat/t1' */
  path: string
  /** query 参数 */
  query: Record<string, string>
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = raw.split('?')
  const query: Record<string, string> = {}
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [k, v] = pair.split('=')
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
    }
  }
  return { path: pathPart || 'campus', query }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash())

  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    if (!window.location.hash) window.location.hash = '#/campus'
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

export function navigate(path: string, query?: Record<string, string>) {
  const qs = query
    ? '?' +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : ''
  window.location.hash = `#/${path}${qs}`
}

/** 返回上一页；如果没有历史则回到主 tab */
export function goBack(fallback = 'campus') {
  if (window.history.length > 1) {
    window.history.back()
  } else {
    navigate(fallback)
  }
}

export function useNavigate() {
  return useCallback((path: string, query?: Record<string, string>) => navigate(path, query), [])
}
