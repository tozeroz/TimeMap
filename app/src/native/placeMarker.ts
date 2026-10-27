import type { MapMarker } from './mapApi'
import buildingIcon from '../assets/map-markers/building.png'
import canteenIcon from '../assets/map-markers/canteen.png'
import parkIcon from '../assets/map-markers/park.png'
import otherIcon from '../assets/map-markers/other.png'

/** Existing places still use the broad “地标” category. Explicit display overrides
 * bridge that data until the maintained place categories are updated. */
const legacyKinds: Record<string, string> = {
  明湖: '公园',
  逸夫教学楼: '教学楼',
}

export function placeIcon(marker: MapMarker): string {
  const category = marker.category && marker.category !== '地标'
    ? marker.category
    : legacyKinds[marker.place]
  switch (category) {
    case '食堂': return canteenIcon
    case '教学楼':
    case '宿舍': return buildingIcon
    case '公园':
    case '公园／景观': return parkIcon
    default: return otherIcon
  }
}

/** Shared by all online map providers: the place is an independent control;
 * the representative post is a separate, offset control without a place label. */
export function buildMarkerElement(m: MapMarker): HTMLDivElement {
  const root = document.createElement('div')
  root.className = `rm ${m.imageMode === 'sticker' ? 'rm--sticker' : ''} ${m.highlight ? 'rm--highlight' : ''} ${!m.coverUrl && m.postId ? 'rm--text' : ''}`
  root.dataset.markerId = m.id

  const place = document.createElement('button')
  place.type = 'button'
  place.className = 'rm__place'
  place.setAttribute('aria-label', `查看地点：${m.place}`)
  place.title = m.place
  const name = document.createElement('span')
  name.className = 'rm__name'
  name.textContent = m.place
  const icon = document.createElement('img')
  icon.className = 'rm__placeIcon'
  icon.src = placeIcon(m)
  icon.alt = ''
  icon.draggable = false
  place.append(name, icon)
  root.append(place)

  if (m.postId) {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'rm__card'
    card.setAttribute('aria-label', `查看${m.place}的帖子${m.excerpt ? `：${m.excerpt}` : ''}`)
    card.title = '查看帖子'
    if (m.coverUrl) {
      const image = document.createElement('img')
      image.className = 'rm__img'
      image.src = m.coverUrl
      image.alt = ''
      image.draggable = false
      card.append(image)
      if (m.imageMode !== 'sticker') {
        const likes = document.createElement('span')
        likes.className = 'rm__likes'
        likes.textContent = `♥ ${m.likeCount ?? 0}`
        card.append(likes)
      }
    } else {
      const text = document.createElement('span')
      text.className = 'rm__img rm__img--text'
      text.textContent = m.excerpt?.slice(0, 10) || '查看帖子'
      card.append(text)
    }
    root.append(card)
  }
  return root
}
