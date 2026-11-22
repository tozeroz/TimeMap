import { useState, useRef } from 'react'
import type { ApiPost } from '../api/client'
import { mediaUrl, relativeTime } from '../api/client'
import type { DiscoveryPlace } from '../api/mapDiscovery'
import { IconLocation } from '../components/icons'
import { PostTextCover } from '../components/PostTextCover'
import { distanceMeters, formatDistance, type GeoFix } from '../native/geo'
import './mapplacecards.css'

export function MapPlaceCards({ posts, places, fix, onPlace, onPost, curated=false }: {
  curated?: boolean
  posts: ApiPost[]; places: DiscoveryPlace[]; fix: GeoFix | null
  onPlace: (id: string) => void; onPost: (post: ApiPost) => void
}) {
  const groups = new Map<string, ApiPost[]>()
  for (const post of posts) {
    const key = post.placeId || `post:${post.id}`
    const group = groups.get(key) || []
    group.push(post); groups.set(key, group)
  }
  return <>{[...groups].map(([key, records]) => <PlaceCard key={key} posts={records}
    curated={curated} place={places.find(place => place.id === records[0].placeId)} fix={fix} onPlace={onPlace} onPost={onPost} />)}</>
}

function PlaceCard({ posts, place, fix, onPlace, onPost, curated }: {
  curated: boolean
  posts: ApiPost[]; place?: DiscoveryPlace; fix: GeoFix | null
  onPlace: (id: string) => void; onPost: (post: ApiPost) => void
}) {
  // Every image remains associated with its source post; text-only posts keep their paper cover.
  const slides = posts.flatMap<{ post: ApiPost; imageId: string | null; key: string }>(post => post.images?.length
    ? post.images.map(image => ({ post, imageId: image.id, key: `${post.id}:${image.id}` }))
    : [{ post, imageId: null, key: post.id }])
  const [index, setIndex] = useState(0)
  const activeIndex = Math.min(index, slides.length - 1)
  const current = slides[activeIndex]
  const track = useRef<HTMLDivElement>(null)
  const name = place?.name || posts[0].place || '校园地点'
  const lat = place?.latitude ?? posts[0].placeLat, lng = place?.longitude ?? posts[0].placeLng
  const distance = fix && lat != null && lng != null ? `距你 ${formatDistance(distanceMeters(fix.lat, fix.lng, lat, lng))}` : ''
  const placeId = place?.id || posts[0].placeId
  function move(next: number) {
    const item = track.current?.children[next] as HTMLElement | undefined
    if (item && track.current) track.current.scrollTo({ left: item.offsetLeft - (track.current.children[0] as HTMLElement).offsetLeft,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return <article className="md-locationCard" data-discovery-place={placeId || undefined}>
    <header><h3>{name}</h3><span className="md-locationKind">{curated?'拍照打卡地':'校园地点'}</span></header>
    {(distance || place?.address) && <p className="md-locationAddress"><IconLocation size={15}/>{[distance, place?.address].filter(Boolean).join(' · ')}</p>}
    <div className="md-locationTrack" ref={track} aria-label={`${name}的校园记录`} tabIndex={0}
      onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()}
      onScroll={event => {
        const el = event.currentTarget, first = el.children[0] as HTMLElement
        let nearest = 0, delta = Infinity
        Array.from(el.children).forEach((child, i) => {
          const value = Math.abs((child as HTMLElement).offsetLeft - first.offsetLeft - el.scrollLeft)
          if (value < delta) { delta = value; nearest = i }
        })
        setIndex(nearest)
      }}>
      {slides.map(slide => <div className="md-locationSlide" key={slide.key} data-discovery-post={slide.post.id}>
        <button className="md-locationPhoto" aria-label={`查看${slide.post.author}在${name}的原帖`} onClick={() => onPost(slide.post)}>
          {slide.imageId ? <Photo key={slide.imageId} id={slide.imageId}/> : <PostTextCover id={slide.post.id} text={slide.post.body} compact/>}
        </button>
        <p className="md-locationCredit">{slide.imageId ? '用户照片' : '文字记录'} · {slide.post.author} · {relativeTime(slide.post.createdAt)}</p>
      </div>)}
    </div>
    {slides.length > 1 && <div className="md-locationPaging"><button aria-label={`${name}上一项`} disabled={activeIndex === 0} onClick={() => move(activeIndex - 1)}>‹</button><span aria-live="polite">{activeIndex + 1} / {slides.length}</span><button aria-label={`${name}下一项`} disabled={activeIndex >= slides.length - 1} onClick={() => move(activeIndex + 1)}>›</button></div>}
    {(curated?place?.description:current.post.body)&&<p className="md-locationSummary">{curated?place?.description:current.post.body.split('\n').find(line => line.trim())}</p>}
    <footer><button disabled={!placeId} onClick={() => placeId && onPlace(placeId)}>查看地点 →</button><button disabled={!placeId} onClick={() => placeId && onPlace(placeId)}>相关帖子 →</button></footer>
  </article>
}

function Photo({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? <span className="md-locationMissing">图片暂时无法显示，点击查看原帖</span>
    : <img src={mediaUrl(id)} alt="" loading="lazy" onError={() => setFailed(true)}/>
}
