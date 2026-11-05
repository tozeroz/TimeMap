/**
 * 曝光上报（2026-11-06，迁移 036 / 037）
 *
 * 为什么必须"真的在视口里"才算曝光：
 *   卡片被渲染 ≠ 被看到。列表一次返回 50 条、用户只看了前 3 张，如果把渲染当曝光，
 *   点击率 = 点击/渲染 会随列表长度稀释，"点开率高但没人看到"的内容反而排不上去。
 *   所以用 IntersectionObserver，只有露出 60% 以上才记一次。
 *
 * 为什么在卸载时也要 flush：
 *   用户看到卡片后立刻点开详情（<900ms），此时页面还没触发定时 flush —— 不 flush 的话
 *   这次曝光就丢了，而它恰好是最值钱的一次（看到了 → 点开了）。
 *
 * 为什么要记位次（迁移 037）：
 *   同一条帖子放第 1 槽和第 18 槽，点击率能差好几倍。不记位次，"这条帖点击率高"
 *   可能只是"它一直被放在第一屏"。位次按**视觉顺序**算（先上后下、同一行先左后右），
 *   而不是 DOM 顺序 —— 双列瀑布流里两者不一致。
 */
import { useEffect, useRef, type RefObject } from 'react'
import { reportImpressions, type ImpressionItem } from '../api/client'

/** 本机遗留帖的 id（`mine-…`）不是服务端的 UUID，不能上报 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ImpressionSurface = 'campus' | 'place' | 'favorites' | 'myposts' | 'user' | 'map' | 'other'

/** 按视觉位置给卡片排位次：先比 top（容差 8px，同一行的卡视为同高），再比 left */
function visualSlots(nodes: HTMLElement[]): Map<HTMLElement, number> {
  const measured = nodes.map((node) => ({ node, rect: node.getBoundingClientRect() }))
  measured.sort((a, b) => {
    if (Math.abs(a.rect.top - b.rect.top) > 8) return a.rect.top - b.rect.top
    return a.rect.left - b.rect.left
  })
  const out = new Map<HTMLElement, number>()
  measured.forEach((m, i) => out.set(m.node, i + 1))
  return out
}

/**
 * 观察容器内所有 `[data-feed-id]` 卡片，把"真正进入视口"的帖子批量上报。
 *
 * @param containerRef 卡片所在的滚动容器（通常就是一屏内容的外层）
 * @param signature    内容签名（一般传 id 列表拼起来的字符串）。变化时重新观察，
 *                     这样切换排序/筛选后新出现的卡片也会被统计。
 * @param surface      曝光发生在哪个界面；不同界面的点击率不能混着比，所以必须分开记。
 */
export function useFeedImpressions(
  containerRef: RefObject<HTMLElement | null>,
  signature: string,
  surface: ImpressionSurface = 'campus',
): void {
  const seen = useRef(new Set<string>())

  useEffect(() => {
    const root = containerRef.current
    if (!root) return undefined

    const observed = Array.from(root.querySelectorAll<HTMLElement>('[data-feed-id]')).filter((n) => {
      const id = n.dataset.feedId
      return Boolean(id && UUID_RE.test(id))
    })
    if (!observed.length) return undefined

    const slots = visualSlots(observed)
    const pending = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      if (!pending.size) return
      const items: ImpressionItem[] = Array.from(pending, ([postId, slot]) => ({ postId, slot }))
      pending.clear()
      reportImpressions(items, surface)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const node = entry.target as HTMLElement
          const id = node.dataset.feedId
          if (!id || seen.current.has(id)) continue
          seen.current.add(id)
          pending.set(id, slots.get(node) ?? 0)
        }
        if (!pending.size) return
        if (timer) clearTimeout(timer)
        // 900ms 合并窗口：滑动时会连续经过多张卡，攒一批再发，少打接口
        timer = setTimeout(flush, 900)
      },
      // 露出 60% 才算"看到"：只露一条边不算，避免滑动经过也计入曝光
      { threshold: 0.6 },
    )

    for (const node of observed) observer.observe(node)

    return () => {
      if (timer) clearTimeout(timer)
      // 卸载前把攒着没发的曝光补发掉（见文件头"为什么卸载时也要 flush"）
      flush()
      observer.disconnect()
    }
  }, [containerRef, signature, surface])
}
