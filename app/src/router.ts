/**
 * 极简 hash 路由 —— 不引第三方依赖。
 * 为什么用 hash：Capacitor 打包后页面通过 file:// / WebView 加载，
 * history 模式在子路径下会 404，hash 最省心。
 */
import { useCallback, useEffect, useState } from 'react'

let navigationGuard: ((hash: string) => boolean) | null = null
export function registerNavigationGuard(guard: (hash: string) => boolean) {
  navigationGuard = guard
  return () => { if (navigationGuard === guard) navigationGuard = null }
}

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
  /*
    ⭐ TimeMap P0：默认路由从 'campus' 改为 'map'。
    为什么：需求 4.1 把地图定为首页（"从地图进入校园内容"），
    底部 tab 也以地图为第一项。改前默认落在复刻的「校园广场」信息流上，
    那是另一个产品的首页 —— 冷启动进错页会让整条"地图→地点→内容"链路看不见。
  */
  return { path: pathPart || 'map', query }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash())

  useEffect(() => {
    const onChange = () => {
      if (navigationGuard && !navigationGuard(window.location.hash)) return
      setRoute(parseHash())
    }
    window.addEventListener('hashchange', onChange)
    if (!window.location.hash) window.location.hash = '#/map'
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

/** 生成 hash 地址；navigate 与 replaceState 共用，保证编码一致 */
export function buildHash(path: string, query?: Record<string, string>): string {
  const entries = query ? Object.entries(query) : []
  const qs = entries.length
    ? '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : ''
  return `#/${path}${qs}`
}

export function navigate(path: string, query?: Record<string, string>) {
  const hash = buildHash(path, query)
  if (navigationGuard && !navigationGuard(hash)) return
  window.location.hash = hash
}

/** 返回上一页；如果没有历史则回到 fallback（可带 query，例如地图上的地点抽屉） */
export function goBack(fallback = 'map', query?: Record<string, string>) {
  if (window.history.length > 1) {
    window.history.back()
  } else {
    navigate(fallback, query)
  }
}

export function useNavigate() {
  return useCallback((path: string, query?: Record<string, string>) => navigate(path, query), [])
}
