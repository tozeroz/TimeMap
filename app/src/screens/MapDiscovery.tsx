import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { getMapDiscovery, type DiscoveryFilter, type DiscoveryPlace, type DiscoveryQuery, type DiscoveryResult } from '../api/mapDiscovery'
import { listPlaces, mediaUrl, postAvatar, relativeTime, type ApiPlaceListItem, type ApiPost } from '../api/client'
import { IconChevronDown, IconClose, IconLocation, IconSearch } from '../components/icons'
import { distanceMeters, formatDistance, type GeoFix } from '../native/geo'
import type { MapHandle } from '../native/mapApi'
import { CAMPUS_CENTER } from '../native/mapTiles'
import { focusInVisibleArea } from '../native/mapFocus'
import { openFeed } from '../data/feedBrowse'
import './mapdiscovery.css'
import {PostTextCover} from '../components/PostTextCover'

type Scope = { bounds?:string; near?:string; label:string }
type Detent = 'closed'|'collapsed'|'half'|'expanded'
export type MapDiscoveryFilter = DiscoveryFilter|'checkins'|'stories'
interface Snapshot { filter:MapDiscoveryFilter;sort:'latest'|'hot';scope:Scope;selected:DiscoveryPlace|null;detent:Detent;scroll:number;loadedCount?:number;schoolId?:string }
const KEY='timemap.map-discovery.v1'
function readSnapshot(key=KEY):Partial<Snapshot> {
  try { const value=JSON.parse(sessionStorage.getItem(key)||'null'); return value && ['all','photos','recent','checkins','stories'].includes(value.filter) && ['latest','hot'].includes(value.sort) && ['closed','collapsed','half','expanded'].includes(value.detent) && typeof value.scope?.label==='string' ? value : {} } catch { return {} }
}
const FILTERS: {key:DiscoveryFilter;label:string}[]=[{key:'all',label:'全部'},{key:'photos',label:'有图记录'},{key:'recent',label:'最近更新'}]
export function useMapDiscovery(options:{fix:GeoFix|null;stage:RefObject<HTMLDivElement|null>;map:RefObject<MapHandle|null>;onData:(data:DiscoveryResult)=>void;onError:()=>void;persist:()=>void;schoolId?:string;category?:string;reloadKey?:number;passiveMap?:boolean;storageKey?:string;onPlace?:(id:string)=>void}) {
  const storageKey=options.storageKey||KEY
  const [saved]=useState(()=>readSnapshot(storageKey))
  const [filter,setFilter]=useState<MapDiscoveryFilter>(saved.filter||'all')
  const [sort,setSort]=useState<'latest'|'hot'>(saved.sort||'latest')
  const [scope,setScope]=useState<Scope>(saved.scope||{bounds:`${CAMPUS_CENTER[0]-.015},${CAMPUS_CENTER[1]-.02},${CAMPUS_CENTER[0]+.015},${CAMPUS_CENTER[1]+.02}`,label:'当前地图范围'})
  const [selected,setSelected]=useState<DiscoveryPlace|null>(saved.selected||null)
  const [detent,setDetent]=useState<Detent>(saved.detent||'half')
  const [data,setData]=useState<DiscoveryResult|null>(null)
  const [phase,setPhase]=useState<'loading'|'ready'|'error'>('loading')
  const [settledKey,setSettledKey]=useState('')
  const [reload,setReload]=useState(0),[morePhase,setMorePhase]=useState<'idle'|'loading'|'error'>('idle')
  const [moved,setMoved]=useState(false),[height,setHeight]=useState(600)
  const [keyword,setKeyword]=useState(''),[search,setSearch]=useState<{phase:'idle'|'loading'|'ready'|'error';places:ApiPlaceListItem[];posts:ApiPost[]}>({phase:'idle',places:[],posts:[]})
  const list=useRef<HTMLDivElement|null>(null), scroll=useRef(saved.scroll||0), restore=useRef(saved.scroll||0)
  const generation=useRef(0), touched=useRef(Boolean(saved.scope)), alive=useRef(false)
  const restoreCount=useRef(Math.min(1000,saved.loadedCount||0)), loadedCount=useRef(0), mapLoaded=useRef(false)
  const onData=useRef(options.onData)
  const onError=useRef(options.onError)
  useLayoutEffect(()=>{onError.current=options.onError},[options.onError])
  useLayoutEffect(()=>{onData.current=options.onData},[options.onData])
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++}},[])
  const effectiveSchoolId=options.schoolId||saved.schoolId
  const pendingCurated=filter==='checkins'||filter==='stories'
  const apiFilter:DiscoveryFilter=pendingCurated?'all':filter as DiscoveryFilter
  const query=useMemo<DiscoveryQuery>(()=>({filter:apiFilter,sort,bounds:scope.bounds,near:scope.near,placeId:selected?.id,schoolId:effectiveSchoolId,category:options.category}),[apiFilter,sort,scope,selected?.id,effectiveSchoolId,options.category])
  const queryKey=JSON.stringify({...query,view:filter})
  useEffect(()=>{
    const current=++generation.current
    setPhase('loading');setMorePhase('idle')
    if(pendingCurated){setData(null);setSettledKey(queryKey);setPhase('ready');return}
    void getMapDiscovery(query).then(async r=>{
      if(!alive.current||current!==generation.current)return
      if(!r.ok){setSettledKey(queryKey);setPhase('error');onError.current();return}
      let value=r.value
      const wanted=restoreCount.current;restoreCount.current=0
      while(value.nextCursor&&value.items.length<wanted){
        const next=await getMapDiscovery(query,value.nextCursor)
        if(!alive.current||current!==generation.current)return
        if(!next.ok){setMorePhase('error');break}
        value={...next.value,items:[...value.items,...next.value.items.filter(p=>!value.items.some(old=>old.id===p.id))]}
      }
      setData(value);setSettledKey(queryKey);setPhase('ready')
      if(!query.placeId){onData.current(value);mapLoaded.current=true}
      else if(!mapLoaded.current){
        const base=await getMapDiscovery({...query,placeId:undefined})
        if(alive.current&&current===generation.current&&base.ok){onData.current(base.value);mapLoaded.current=true}
      }
    })
  },[query,queryKey,pendingCurated,reload,options.reloadKey])
  useLayoutEffect(()=>{if(phase==='ready'&&list.current){list.current.scrollTop=restore.current;restore.current=0}},[phase])
  useLayoutEffect(()=>{loadedCount.current=data?.items.length||0},[data])
  useEffect(()=>{
    const stage=options.stage.current;if(!stage)return
    const measure=()=>setHeight(stage.clientHeight||600)
    measure();const observer=new ResizeObserver(measure);observer.observe(stage)
    return()=>observer.disconnect()
  },[options.stage])
  const panelHeight=detent==='closed'?0:detent==='collapsed'?88:detent==='expanded'?Math.round(height*.85):Math.max(height<300?88:150,Math.round(height*.45))
  const initialRangeDone=useRef(Boolean(saved.scope))
  useEffect(()=>{
    if(initialRangeDone.current||touched.current)return
    const timer=setInterval(()=>{
      const handle=options.map.current,size=handle?.getSize()
      const a=size&&handle?.unproject(0,0),b=size&&handle?.unproject(size.width,options.passiveMap?size.height:Math.max(50,size.height-panelHeight))
      if(!a||!b||touched.current)return
      initialRangeDone.current=true;clearInterval(timer)
      setScope({bounds:`${Math.min(a.lat,b.lat)},${Math.min(a.lng,b.lng)},${Math.max(a.lat,b.lat)},${Math.max(a.lng,b.lng)}`,label:'当前地图范围'})
    },250)
    return()=>clearInterval(timer)
  },[saved.scope,options.map,panelHeight,options.passiveMap])
  const snapshot=useRef<Snapshot>({filter,sort,scope,selected,detent,scroll:scroll.current})
  useLayoutEffect(()=>{snapshot.current={filter,sort,scope,selected,detent,scroll:scroll.current,schoolId:options.schoolId||saved.schoolId}},[filter,sort,scope,selected,detent,options.schoolId,saved.schoolId])
  const persist=useCallback(()=>{
    try {sessionStorage.setItem(storageKey,JSON.stringify({...snapshot.current,loadedCount:loadedCount.current,scroll:list.current?.scrollTop||scroll.current}))}catch{/* Storage unavailable: browsing remains usable. */}
    options.persist()
  },[options.persist,storageKey])
  useEffect(()=>{window.addEventListener('pagehide',persist);return()=>{persist();window.removeEventListener('pagehide',persist)}},[persist])
  // Initial location is used once. GPS watch updates must not continuously replace the user's range.
  useEffect(()=>{
    if(!options.fix||touched.current)return
    touched.current=true
    setScope({near:`${options.fix.lat},${options.fix.lng},1000`,label:'当前位置附近'})
  },[options.fix])
  useEffect(()=>{
    if(options.passiveMap)return
    const stage=options.stage.current;if(!stage)return
    let down:{x:number;y:number;target:EventTarget|null}|null=null
    const pointerDown=(e:PointerEvent)=>{if((e.target as Element).closest('button,input,.md-sheet,.md-place,.md-results'))return;down={x:e.clientX,y:e.clientY,target:e.target}}
    const pointerUp=(e:PointerEvent)=>{
      if(!down)return
      if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>8){setMoved(true);touched.current=true}
      else if(!(e.target as Element).closest('.rm,.rm__wrap,.leaflet-marker-icon'))setSelected(null)
      down=null
    }
    const wheel=(e:WheelEvent)=>{if(!(e.target as Element).closest('.md-sheet,.md-results')){setMoved(true);touched.current=true}}
    stage.addEventListener('pointerdown',pointerDown);stage.addEventListener('pointerup',pointerUp);stage.addEventListener('wheel',wheel,{passive:true})
    return()=>{stage.removeEventListener('pointerdown',pointerDown);stage.removeEventListener('pointerup',pointerUp);stage.removeEventListener('wheel',wheel)}
  },[options.stage,options.passiveMap])
  const resetScroll=()=>{scroll.current=0;restore.current=0;if(list.current)list.current.scrollTop=0}
  const changeFilter=(value:MapDiscoveryFilter)=>{touched.current=true;setFilter(value);setSelected(null);if(options.passiveMap)setDetent('half');resetScroll()}
  const changeSort=(value:'latest'|'hot')=>{setSort(value);resetScroll()}
  const searchArea=()=>{
    const h=options.map.current,size=h?.getSize()
    const a=size&&h?.unproject(0,0),b=size&&h?.unproject(size.width,Math.max(50,size.height-panelHeight))
    if(!a||!b)return
    setScope({bounds:`${Math.min(a.lat,b.lat)},${Math.min(a.lng,b.lng)},${Math.max(a.lat,b.lat)},${Math.max(a.lng,b.lng)}`,label:'当前地图范围'})
    setSelected(null);setMoved(false);touched.current=true;resetScroll()
  }
  const useNearby=()=>{if(options.fix){setScope({near:`${options.fix.lat},${options.fix.lng},1000`,label:'当前位置附近'});setSelected(null);setMoved(false);resetScroll()}}
  const allSchool=()=>{setScope({label:'当前学校范围',bounds:`${CAMPUS_CENTER[0]-.02},${CAMPUS_CENTER[1]-.025},${CAMPUS_CENTER[0]+.02},${CAMPUS_CENTER[1]+.025}`});setSelected(null);setMoved(false);resetScroll()}
  const selectPlace=useCallback((place:DiscoveryPlace)=>{
    if(options.passiveMap){options.onPlace?.(place.id);return}
    setSelected(place);setKeyword('');setDetent(d=>d==='collapsed'?'half':d);scroll.current=0;restore.current=0
    const h=options.map.current
    h?.setSelected(place.id)
    focusInVisibleArea(h,{lat:place.latitude!,lng:place.longitude!,placeId:place.id},{zoom:Math.max(16,h?.getZoom()||16),visibleTop:130,visibleBottom:Math.max(150,height-panelHeight-20),animate:!matchMedia('(prefers-reduced-motion: reduce)').matches})
  },[options.map,height,panelHeight,options.passiveMap,options.onPlace])
  useEffect(()=>{if(!options.passiveMap)options.map.current?.setSelected(selected?.id||null)},[selected,options.map,data,options.passiveMap])
  const backToRange=()=>{setSelected(null);resetScroll()}
  useEffect(()=>{
    const text=keyword.trim();if(!text){setSearch({phase:'idle',places:[],posts:[]});return}
    let valid=true;setSearch({phase:'loading',places:[],posts:[]})
    const timer=setTimeout(()=>void Promise.all([listPlaces(text),getMapDiscovery({filter:'all',sort:'latest',q:text,schoolId:options.schoolId})]).then(([p,r])=>{
      if(!valid)return
      setSearch({phase:p.ok&&r.ok?'ready':'error',places:p.ok?p.value:[],posts:r.ok?r.value.items:[]})
    }),300)
    return()=>{valid=false;clearTimeout(timer)}
  },[keyword,options.schoolId,reload])
  async function more(){
    if(!data?.nextCursor||phase!=='ready'||morePhase==='loading')return
    const current=generation.current;setMorePhase('loading')
    const r=await getMapDiscovery(query,data.nextCursor)
    if(!alive.current||current!==generation.current)return
    if(!r.ok){setMorePhase('error');return}
    setData(prev=>prev?{...r.value,items:[...prev.items,...r.value.items.filter(p=>!prev.items.some(old=>old.id===p.id))]}:r.value);setMorePhase('idle')
  }
  function openPost(post:ApiPost,posts:ApiPost[]=data?.items||[]){persist();openFeed(post.id,posts.map(p=>p.id))}
  function selectSearchPlace(place:ApiPlaceListItem){selectPlace({...place,description:null,updatedAt:null,coverMediaId:null})}
  return {filter,changeFilter,sort,changeSort,scope,selected,selectPlace,selectSearchPlace,backToRange,detent,setDetent,panelHeight,
    data,pendingCurated,phase:settledKey===queryKey?phase:'loading',retry:()=>setReload(n=>n+1),morePhase,more,keyword,setKeyword,search,list,scroll,moved,searchArea,useNearby,allSchool,openPost,persist,fix:options.fix}
}
export type MapDiscoveryState=ReturnType<typeof useMapDiscovery>

export function DiscoveryToolbar({state:d,advanced}:{state:MapDiscoveryState;advanced:React.ReactNode}) {
  return <div className="map__toolbar md-toolbar">
    <label className="md-search"><IconSearch size={20}/><input aria-label="搜索地点和校园记录" placeholder="搜地点、校园记录" maxLength={100} value={d.keyword} onChange={e=>d.setKeyword(e.target.value)}/>{d.keyword&&<button aria-label="清空搜索" onClick={()=>d.setKeyword('')}><IconClose size={18}/></button>}</label>
    <div className="md-filterbar"><nav aria-label="地图内容筛选">{FILTERS.map(f=><button key={f.key} aria-pressed={d.filter===f.key} className={d.filter===f.key?'is-active':''} onClick={()=>d.changeFilter(f.key)}>{f.label}</button>)}</nav>{advanced}</div>
  </div>
}
function Preview({id,name}:{id?:string|null;name:string}){
  const [failed,setFailed]=useState(false)
  return id&&!failed?<img src={mediaUrl(id)} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<span className="md-placeholder" aria-hidden="true"><IconLocation size={24}/><small>{name}</small></span>
}
function updateText(value:string|null){
  if(!value)return '暂无校园记录'
  const day=(date:Date)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',year:'numeric'}).format(date)
  return day(new Date(value))===day(new Date())?'今天有更新':`${day(new Date(value))}更新`
}
export function DiscoveryOverlay({state:d,onDetail,hidden,closable=false}:{state:MapDiscoveryState;onDetail:(id:string)=>void;hidden:boolean;closable?:boolean}){
  const drag=useRef<{id:number;y:number;start:number;last:number}|null>(null)
  const [dragHeight,setDragHeight]=useState<number|null>(null)
  const listTouch=useRef<number|null>(null)
  const place=d.data?.places.find(p=>p.id===d.selected?.id)||d.selected
  const stop=(e:React.SyntheticEvent)=>e.stopPropagation()
  function finish(){
    const value=drag.current;if(!value)return
    const delta=value.last-value.y
    if(Math.abs(delta)>24)d.setDetent(delta<0?(d.detent==='collapsed'?'half':'expanded'):(closable?'closed':d.detent==='expanded'?'half':'collapsed'))
    drag.current=null;setDragHeight(null)
  }
  if(hidden)return null
  if(d.detent==='closed')return <button className="md-reopen" onPointerDown={stop} onTouchStart={stop} onClick={()=>d.setDetent('half')}>查看附近内容</button>
  return <>
    {d.keyword&&<section className="md-results" aria-label="搜索结果" onPointerDown={stop} onTouchStart={stop} onTouchMove={stop}>
      <div className="md-resultHead"><strong>搜索结果</strong><button onClick={()=>d.setKeyword('')} aria-label="关闭搜索"><IconClose size={18}/></button></div>
      {d.search.phase==='loading'&&<p className="md-state" role="status">搜索中…</p>}
      {d.search.phase==='error'&&<p className="md-state">搜索读取失败 <button onClick={d.retry}>重试</button></p>}
      {d.search.phase==='ready'&&<><h3>地点</h3>{!d.search.places.length&&<p className="md-state">没有匹配的地点</p>}{d.search.places.map(p=><button className="md-result" key={p.id} onClick={()=>d.selectSearchPlace(p)}><strong>{p.name}</strong><small>{p.address}</small></button>)}<h3>校园记录</h3>{!d.search.posts.length&&<p className="md-state">没有匹配的校园记录</p>}{d.search.posts.map(p=><button className="md-result" key={p.id} onClick={()=>d.openPost(p,d.search.posts)}><strong>{p.body.slice(0,60)}</strong><small>{p.place} · {relativeTime(p.createdAt)}</small></button>)}</>}
    </section>}
    {d.moved&&!d.keyword&&<button className="md-searchArea" onClick={d.searchArea}>搜索这片区域</button>}
    {place&&!d.keyword&&<div className="md-place" onPointerDown={stop} onTouchStart={stop}>
      <button className="md-placeOpen" onClick={()=>onDetail(place.id)}><Preview key={place.coverMediaId} id={place.coverMediaId} name={place.name}/><span><strong>{place.name}</strong>{place.description&&<small>{place.description}</small>}<small>{d.phase==='error'?'内容读取失败':`${place.postCount} 条校园记录 · ${updateText(place.updatedAt)}`}</small></span></button>
      <button aria-label="取消选中地点" className="md-placeClose" onClick={d.backToRange}><IconClose size={16}/></button>
    </div>}
    <section className="md-sheet" aria-label="地图内容" data-discovery-phase={d.phase} data-discovery-detent={d.detent} style={{height:dragHeight??d.panelHeight}} onPointerDown={stop} onTouchStart={stop} onTouchMove={stop} onWheel={stop}>
      <div className="md-grip" onPointerDown={e=>{if((e.target as Element).closest('button'))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,y:e.clientY,last:e.clientY,start:d.panelHeight}}} onPointerMove={e=>{if(drag.current?.id===e.pointerId){drag.current.last=e.clientY;setDragHeight(Math.max(76,Math.min(window.innerHeight*.75,drag.current.start+drag.current.y-e.clientY)))}}} onPointerUp={finish} onPointerCancel={()=>{drag.current=null;setDragHeight(null)}}>
        {!closable&&d.detent!=='collapsed'&&<button className="md-minimize" aria-label="最小化内容面板" onClick={()=>d.setDetent('collapsed')}>收起</button>}
        <span/>{closable?<><button className="md-minimize" aria-label={d.detent==='expanded'?'收起内容面板':'展开内容面板'} onClick={()=>d.setDetent(d.detent==='expanded'?'half':'expanded')}><IconChevronDown size={16}/></button><button aria-label="关闭内容面板" onClick={()=>d.setDetent('closed')}><IconClose size={18}/></button></>:<button aria-label={d.detent==='expanded'?'收起内容面板':'展开内容面板'} onClick={()=>d.setDetent(d.detent==='expanded'?'half':d.detent==='half'?'expanded':'half')}><IconChevronDown size={16}/></button>}
      </div>
      <div className="md-sheetHead"><nav aria-label="地图内容排序"><button aria-pressed={d.sort==='latest'} onClick={()=>d.changeSort('latest')}>附近新动态</button><button aria-pressed={d.sort==='hot'} onClick={()=>d.changeSort('hot')}>附近热门</button></nav><span title={d.scope.label}><IconLocation size={13}/>{d.scope.label}</span></div>
      {d.sort==='hot'&&!d.pendingCurated&&<p className="md-sortNote">近 7 天 · 按点赞、评论、收藏热度排序</p>}
      {d.selected&&<div className="md-selection"><strong>{d.selected.name}</strong><button onClick={d.backToRange}>返回当前范围</button></div>}
      <div className="md-list" ref={d.list} onScroll={e=>{d.scroll.current=e.currentTarget.scrollTop}}
        onTouchStart={e=>{listTouch.current=e.currentTarget.scrollTop<=0?e.touches[0]?.clientY??null:null}}
        onTouchMove={e=>{if(listTouch.current!==null&&e.touches[0]&&e.touches[0].clientY-listTouch.current>32&&e.currentTarget.scrollTop<=0&&(closable||d.detent==='expanded')){d.setDetent(closable?'closed':'half');listTouch.current=null}}}
        onTouchEnd={()=>{listTouch.current=null}}>
        {d.phase==='loading'?<div className="md-skeleton" role="status" aria-label="正在加载附近内容"><div/><div/></div>:d.phase==='error'?<div className="md-state"><p>内容加载失败，地图仍可浏览</p><button onClick={d.retry}>重试</button></div>:<>
          {!d.data?.items.length&&<div className="md-state"><p>{d.pendingCurated?(d.filter==='stories'?'校园故事正在整理中':'拍照打卡地正在整理中'):d.selected?'这个地点暂无符合筛选的记录':'当前范围暂无符合筛选的记录'}</p><button onClick={()=>d.changeFilter('all')}>查看附近记录</button>{!d.pendingCurated&&<button onClick={d.allSchool}>查看全校</button>}</div>}
          {d.data?.items.map(p=><article className="md-card" key={p.id} data-discovery-post={p.id}>
            <button className="md-cardOpen" onClick={()=>d.openPost(p)}>{p.images?.length?<Preview key={p.images[0].id} id={p.images[0].id} name="校园记录"/>:<PostTextCover id={p.id} text={p.body} compact/>}<span className="md-cardBody"><strong>{p.body.split('\n').find(s=>s.trim())?.slice(0,50)||'校园记录'}</strong><span className="md-cardTag">{p.images?.length?'图文记录':'校园记录'}</span></span></button>
            <button className="md-cardPlace" onClick={()=>{const place=d.data?.places.find(pl=>pl.id===p.placeId);if(place)d.selectPlace(place)}}><IconLocation size={13}/>{p.place||'校园地点'}{d.fix&&p.placeLat!=null&&p.placeLng!=null?` · 距你 ${formatDistance(distanceMeters(d.fix.lat,d.fix.lng,p.placeLat,p.placeLng))}`:''}</button>
            <div className="md-cardMeta"><img src={postAvatar(p)} alt=""/><span>{p.author}</span><time>{relativeTime(p.createdAt)}</time><span className="md-cardLikes" aria-label={`${p.likeCount||0}个赞`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 21S2 15 2 8a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 7-10 13-10 13Z"/></svg>{p.likeCount||0}</span></div>
          </article>)}
          {d.data?.nextCursor&&<button className="md-more" disabled={d.morePhase==='loading'} onClick={()=>void d.more()}>{d.morePhase==='loading'?'加载中…':d.morePhase==='error'?'加载更多失败，点击重试':'加载更多记录'}</button>}
          {d.data&&d.data.items.length>0&&!d.data.nextCursor&&<p className="md-end">已看完当前范围的 {d.data.total} 条记录</p>}
          {d.data?.placesTruncated&&<p className="md-end">地点较多，请放大地图查看</p>}
        </>}
      </div>
    </section>
  </>
}
