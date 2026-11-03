import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconEdit, IconLocation } from '../components/icons'
import { goBack, navigate } from '../router'
import { PlaceActivitiesSection, PlaceFeedSection } from './PlaceSections'
import { isPlaceId } from './placeSheetModel'
import { TimeMachine } from './TimeMachine'
import { usePlaceDetail } from './usePlaceDetail'
import './poidetail.css'

/** Concrete place detail; school-level map aggregation remains in the map domain. */
export function PoiDetailScreen({ id }: { id: string }) {
  // PLACE-002 retains the existing default: recent popular posts（地图抽屉默认「最新」，见 PlaceDetailSheet）.
  const d = usePlaceDetail(id, 'hot')
  const { place, phase, error } = d
  const back = () => goBack('map', isPlaceId(id) ? { placeId: id, sheet: 'preview' } : undefined)
  const header = <TopBar variant="plain" left={<button className="iconbtn" onClick={back} aria-label="返回地图"><IconBack size={24} /></button>} center={<span className="pd__topTitle">地点详情</span>} />
  if (phase !== 'ready' || !place) return <Screen className="pd-page" header={header}><div className="pd__state" role="status" data-pd-phase={phase}>
    <p>{phase === 'loading' ? '正在寻找这处校园记忆…' : phase === 'not_found' ? '地点不存在' : '地点加载失败'}</p>
    {phase === 'error' && <p className="pd__stateSub">{error}</p>}
    {phase === 'error' && <button className="pd__retry" onClick={d.retry}>重试</button>}
    {phase === 'not_found' && <button className="pd__retry" onClick={() => navigate('map')}>返回地图</button>}
  </div></Screen>
  return <Screen className="pd-page" header={header} footer={<div className="pd__actions">{place.enabled ? <button className="pd__publishBtn" data-pd-publish={place.id} onClick={() => navigate('publish', { placeId: place.id })}><IconEdit size={25} />在这里发布</button> : <p className="pd__publishHint" data-pd-publish-disabled>该地点已停用，暂时无法在这里发布。</p>}</div>}>
    <article className="pd" data-place-id={place.id} data-place-category={place.category} data-pd-phase="ready">
      <section className="pd__intro">
        <GateArtwork />
        <div className="pd__category" data-place-category-chip><IconLocation size={19} />{place.category}{!place.enabled && <span className="pd__disabledTag">已停用</span>}</div>
        <h1 className="pd__name" data-place-name>{place.name}</h1>
        {place.address && <p className="pd__addr"><IconLocation size={18} />{place.address}</p>}
        {place.description && <p className="pd__desc" data-place-desc>{place.description}</p>}
        <button className="pd__mapLink" onClick={() => navigate('map', { placeId: place.id })}>在地图中查看 <span aria-hidden="true">→</span></button>
      </section>
      <TimeMachine photos={place.photos} history={place.history} />
      <PlaceActivitiesSection place={place} onOpenActivity={aid => navigate('activity', { id: aid, placeId: place.id })} onOpenAll={() => navigate('activities', { placeId: place.id })} />
      <PlaceFeedSection place={place} sort={d.sort} setSort={d.setSort} filter={d.filter} setFilter={d.setFilter} allEmpty={d.allEmpty} feedPhase={d.feedPhase} onRetryFeed={d.retryFeed} showFilter layout="columns" onOpenPost={pid => navigate('feed', { id: pid })} onOpenAll={() => navigate('campus', { placeId: place.id })} />
    </article>
  </Screen>
}

function GateArtwork() {
  return <svg className="pd__gate" viewBox="0 0 200 160" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="2.2"><path d="M7 145h186M40 144V65h18v79M142 144V65h18v79M36 65h26v-7H36zM138 65h26v-7h-26zM58 78h84v12H58zM60 143v-39q40-28 80 0v39M88 78V41h24v37M84 41h32v-6H84zM96 35V22h8v13M47 58V46m105 12V46"/><path d="M19 145v-23m-7 6q-12-24 6-29 17 10 10 29zM180 145v-29m-8 9q-12-26 7-39 19 14 9 39z" fill="currentColor" fillOpacity=".18"/></g></svg>
}
