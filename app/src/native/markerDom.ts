import type { MapMarker } from './mapApi'

/**
 * 地图标记的**唯一** DOM 构造器。
 *
 * ## 为什么抽出来
 *   改前三套底图各写一份（腾讯一份、高德一份、Leaflet 一份模板字符串），
 *   结构早就靠人工保持"同构"。这次要给"没有帖子的地点"换一种呈现，
 *   三处分别改必然漂移 —— 所以收敛到一处。
 *
 * ## 两种形态
 *   · **有帖子**：照片卡片（或文字气泡）+ 地点名 + 图钉。
 *   · **没有帖子**：只有地点名标签 + 图钉，**不画白卡片**。
 *
 *   ⚠️ 为什么不再画空卡片：本地 37 个地点里只有 1 个有帖子，空卡片会渲染成
 *      一个 66×66 的白色空框（截图里的"空白地标"）。项目纪律是"没有合适图片
 *      不生成占位照片"（地图地标显示层级方案 §9），所以这里退化成名称标签，
 *      地点仍然可见、可点、可进详情。
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * 该标记是否有**可展示**的帖子内容（决定用卡片还是名称标签）。
 *
 * ⚠️ 不能只看 `postId`：代表帖可能存在，但里面没有任何可展示的东西
 *    （比如只有一张 1×1 的占位图、正文又是空的）—— 那时卡片就会变成一片白框。
 *    本项目的纪律是「没有合适图片不生成占位照片」，所以这种情况退化成名称标签。
 */
export function markerHasPost(m: MapMarker): boolean {
  if (!m.postId) return false
  return Boolean(m.coverUrl) || Boolean(m.excerpt && m.excerpt.trim())
}

const PIN_SVG =
  '<svg width="18" height="24" viewBox="0 0 20 26"><path d="M10 25.5S19 15.6 19 9.6A9 9 0 0 0 1 9.6c0 6 9 15.9 9 15.9Z" fill="currentColor"/><circle cx="10" cy="9.6" r="3.4" fill="#fff"/></svg>'

/**
 * 标记的 HTML。
 *
 * ⚠️ `data-place-id` 必须保留：三套底图与 MapScreen 的显隐/避让逻辑都靠它定位元素。
 */
export function markerHtml(m: MapMarker): string {
  const hasPost = markerHasPost(m)
  const cover = m.coverUrl
  const classes = [
    'rm',
    m.imageMode === 'sticker' ? 'rm--sticker' : '',
    m.highlight ? 'rm--highlight' : '',
    // 有帖但没封面 ⇒ 文字气泡；没帖子 ⇒ 名称标签。两者互斥。
    !hasPost ? 'rm--bare' : !cover ? 'rm--text' : '',
  ]
    .filter(Boolean)
    .join(' ')

  let body: string
  if (!hasPost) {
    body = `<span class="rm__label">${escapeHtml(m.place)}</span>`
  } else {
    const media = cover
      ? `<img class="rm__img" src="${escapeHtml(cover)}" alt="" />${
          m.imageMode !== 'sticker' ? `<span class="rm__likes">♥ ${m.likeCount ?? 0}</span>` : ''
        }`
      : `<span class="rm__img rm__img--text">${escapeHtml((m.excerpt ?? '').slice(0, 10))}</span>`
    body = `<div class="rm__card">${media}<span class="rm__name">${escapeHtml(m.place)}</span></div>`
  }

  return `<div data-marker-id="${escapeHtml(m.id)}" data-place-id="${escapeHtml(m.placeId)}" class="${classes}">${body}<span class="rm__pin" style="color:${m.color}">${PIN_SVG}</span></div>`
}

/** 腾讯 / 高德用：返回真实 DOM 节点 */
export function buildMarkerElement(m: MapMarker): HTMLDivElement {
  const host = document.createElement('div')
  host.innerHTML = markerHtml(m).trim()
  return host.firstElementChild as HTMLDivElement
}

/**
 * Leaflet 用：`divIcon` 的尺寸与锚点。
 *
 * ⚠️ Leaflet 是**固定盒 + iconAnchor**（腾讯/高德是 bottom-center 或 translate(-50%,-100%)，
 *    会自动适应内容高度）。名称标签比卡片矮很多，必须给它自己的盒子和锚点，
 *    否则图钉尖端会偏离真实坐标几十像素。
 *
 * 高度取值与 realmaps.css 里的 `.rm--bare` 固定高度保持一致。
 */
export const BARE_MARKER_BOX = { width: 124, height: 46 } as const
export const CARD_MARKER_BOX = { width: 76, height: 100 } as const

export function markerIconBox(m: MapMarker): { size: [number, number]; anchor: [number, number] } {
  if (!markerHasPost(m)) {
    return { size: [BARE_MARKER_BOX.width, BARE_MARKER_BOX.height], anchor: [BARE_MARKER_BOX.width / 2, BARE_MARKER_BOX.height] }
  }
  return { size: [CARD_MARKER_BOX.width, CARD_MARKER_BOX.height], anchor: [CARD_MARKER_BOX.width / 2, CARD_MARKER_BOX.height] }
}
