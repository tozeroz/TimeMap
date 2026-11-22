import { useEffect, useRef, useState } from 'react'
import { curationPosts,curationPlaces,setCampusStory,getCheckin,saveCheckin,type CuratedPost,type CuratedPlace,type CurationPage,type CheckinEdit } from '../api/curation'
import { adminListPlaces,adminTakedownPost,failText,mediaUrl,relativeTime,type ApiAdminPlace,type ApiResult } from '../api/client'
import { AdminDialog } from '../components/AdminPrimitives'
import { navigate } from '../router'

function usePaged<T>(fetchPage:(q:Record<string,string>)=>Promise<ApiResult<CurationPage<T>>>,query:Record<string,string>) {
  const [data,setData]=useState<T[]>([]),[cursor,setCursor]=useState<string|null>(null),[phase,setPhase]=useState('loading'),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const generation=useRef(0),busy=useRef(false),key=JSON.stringify(query),queryRef=useRef(query);queryRef.current=query
  async function load(more=false) {
    if(more&&busy.current)return
    const token=++generation.current;busy.current=true;setPhase(more?'more':'loading');setError('')
    const result=await fetchPage({...queryRef.current,...(more&&cursor?{cursor}:{})})
    if(token!==generation.current)return
    busy.current=false
    if(!result.ok){setError(failText(result));setPhase(more?'more-error':'error');return}
    setData(old=>more?[...old,...result.value.items]:result.value.items);setCursor(result.value.nextCursor);setPhase('ready')
  }
  useEffect(()=>{generation.current++;busy.current=false;setData([]);setCursor(null);setPhase('loading');const timer=setTimeout(()=>void load(),200);return()=>{clearTimeout(timer);generation.current++}},[key,revision])
  return {data,cursor,phase,error,more:()=>void load(true),reload:()=>setRevision(n=>n+1)}
}
function PageState({state}:{state:{phase:string;error:string;cursor:string|null;data:unknown[];more:()=>void;reload:()=>void}}) {
  return <>{state.phase==='loading'&&<p role="status">加载中…</p>}{state.error&&<p role="alert">{state.error} <button className="adm__btn" onClick={state.phase==='more-error'?state.more:state.reload}>重试</button></p>}
    {state.phase==='ready'&&!state.data.length&&<p className="adm__state">暂无符合条件的内容</p>}
    {state.cursor&&state.phase!=='error'&&state.phase!=='loading'&&<button className="adm__btn" onClick={state.more} disabled={state.phase==='more'}>{state.phase==='more'?'加载中…':'加载更多'}</button>}</>
}
export function AdminStoriesPanel() {
  const [q,setQ]=useState(''),[placeId,setPlaceId]=useState(''),[story,setStory]=useState('all'),[status,setStatus]=useState('published')
  const [places,setPlaces]=useState<ApiAdminPlace[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const [takedown,setTakedown]=useState<CuratedPost|null>(null),[reason,setReason]=useState('')
  const state=usePaged(curationPosts,{q,placeId,story,status})
  useEffect(()=>{let live=true;void adminListPlaces().then(r=>{if(live&&r.ok)setPlaces(r.value)});return()=>{live=false}},[])
  async function label(post:CuratedPost) {
    setBusy(true);setNotice('');const r=await setCampusStory(post.id,!post.campusStory);setBusy(false)
    if(r.ok){setNotice(post.campusStory?'已取消校园故事':'已设为校园故事');state.reload()}else setNotice(`操作失败：${failText(r)}`)
  }
  async function remove() {
    if(!takedown||!reason.trim())return
    setBusy(true);const r=await adminTakedownPost(takedown.id,reason.trim());setBusy(false)
    if(r.ok){setTakedown(null);state.reload();setNotice('帖子已下架')}else setNotice(failText(r))
  }
  return <section className="adm__pane">
    <div className="adm__card"><h2>内容管理</h2><p className="adm__cardMeta">从用户原帖中挑选校园故事，保留原作者与互动。下架后退出公开分类，重新公开时仍有效的标记会恢复展示。</p>
      <label>搜索正文或作者<input className="adm__input" value={q} maxLength={100} onChange={e=>setQ(e.target.value)}/></label>
      <label>地点<select className="adm__input" value={placeId} onChange={e=>setPlaceId(e.target.value)}><option value="">全部地点</option>{places.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>故事分类<select className="adm__input" value={story} onChange={e=>setStory(e.target.value)}><option value="all">全部分类</option><option value="yes">校园故事</option><option value="no">未标记故事</option></select></label>
      <label>帖子状态<select className="adm__input" value={status} onChange={e=>setStatus(e.target.value)}><option value="published">公开</option><option value="removed">已下架</option><option value="all">全部</option></select></label>
      <button className="adm__btn" onClick={()=>{setQ('');setPlaceId('');setStory('all');setStatus('published')}}>重置筛选</button><button className="adm__btn" onClick={state.reload}>刷新</button>
    </div>
    {notice&&<p className="adm__state" role="status">{notice}</p>}
    <ul className="adm__list" data-admin-posts={state.data.length}>{state.data.map(p=><li className="adm__card" key={p.id} data-admin-post={p.id} data-post-status={p.status}>
      <div className="adm__cardHead"><span>{p.author}</span>{p.anonymous&&<span className="adm__tag">匿名发布</span>}<span className="adm__tag">{p.status==='published'?'公开':'已下架'}</span>{p.campusStory&&<span className="adm__tag">校园故事</span>}<time>{relativeTime(p.createdAt)}</time></div>
      {p.images[0]&&<img src={mediaUrl(p.images[0].id)} alt="原帖封面" loading="lazy" style={{width:88,height:72,objectFit:'cover',borderRadius:8}}/>}<p className="adm__cardBody">{p.body}</p><p className="adm__cardMeta">地点：{p.place||'无'}</p>
      {p.removedReason&&<p>下架原因：{p.removedReason}</p>}
      <div className="adm__actions"><button className="adm__btn" disabled={p.status!=='published'} onClick={()=>navigate('feed',{id:p.id})}>预览原帖</button>
        <button className="adm__btn" disabled={busy||p.status!=='published'&&!p.campusStory} onClick={()=>void label(p)}>{p.campusStory?'取消校园故事':'设为校园故事'}</button>
        {p.status==='published'&&<button className="adm__btn adm__btn--danger" data-admin-takedown={p.id} disabled={busy} onClick={()=>{setReason('');setTakedown(p);setNotice('')}}>下架</button>}</div>
    </li>)}</ul><PageState state={state}/>
    {takedown&&<AdminDialog title="下架帖子" onClose={()=>{if(!busy)setTakedown(null)}}><p>下架后退出所有公开列表、故事和打卡展示。原因将写入操作记录。</p><label>下架原因<textarea className="adm__textarea" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="adm__btn" disabled={busy} onClick={()=>setTakedown(null)}>取消</button><button className="adm__btn adm__btn--danger" disabled={busy||!reason.trim()} onClick={()=>void remove()}>{busy?'提交中…':'确认下架'}</button></AdminDialog>}
  </section>
}
export function AdminCheckinsPanel() {
  const [q,setQ]=useState(''),[checkin,setCheckin]=useState('all'),[status,setStatus]=useState('enabled')
  const [editing,setEditing]=useState<CheckinEdit|null>(null),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false)
  const state=usePaged<CuratedPlace>(curationPlaces,{q,checkin,status})
  async function edit(id:string) {setLoading(true);setNotice('');const r=await getCheckin(id);setLoading(false);if(r.ok)setEditing(r.value);else setNotice(failText(r))}
  return <section className="adm__pane"><div className="adm__card"><h2>拍照打卡维护</h2><label>地点名称<input className="adm__input" maxLength={100} value={q} onChange={e=>setQ(e.target.value)}/></label>
    <label>打卡状态<select className="adm__input" value={checkin} onChange={e=>setCheckin(e.target.value)}><option value="all">全部</option><option value="active">推荐中</option><option value="paused">已暂停</option><option value="unset">未设置</option></select></label>
    <label>地点状态<select className="adm__input" value={status} onChange={e=>setStatus(e.target.value)}><option value="enabled">启用</option><option value="disabled">停用</option><option value="all">全部</option></select></label><button className="adm__btn" onClick={()=>{setQ('');setCheckin('all');setStatus('enabled')}}>重置筛选</button></div>
    {notice&&<p role="alert">{notice}</p>}{loading&&<p role="status">读取设置中…</p>}
    {state.data.map(p=><article className="adm__card" key={p.id}><h3>{p.name}</h3><p>{p.version===0?'未设置':p.active?'推荐中':'已暂停'} · {p.enabled?'地点启用':'地点停用'} · {p.validPhotos} 张有效展示照片</p>{p.active&&!p.validPhotos&&<p role="status">需补充展示图片，当前不对外展示</p>}<button className="adm__btn" disabled={loading} onClick={()=>void edit(p.id)}>{p.version?'编辑打卡设置':'设置拍照打卡'}</button></article>)}
    <PageState state={state}/>{editing&&<CheckinEditor key={editing.id} initial={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setNotice('打卡设置已保存');state.reload()}}/>}
  </section>
}
function CheckinEditor({initial,onClose,onSaved}:{initial:CheckinEdit;onClose:()=>void;onSaved:()=>void}) {
  const [form,setForm]=useState(initial),[q,setQ]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const posts=usePaged(curationPosts,{q,placeId:initial.id,status:'published',photos:'1'})
  async function save(){setBusy(true);setError('');const r=await saveCheckin(form);setBusy(false);if(r.ok)onSaved();else setError(r.ok?'':r.status===409?'设置有冲突或照片已失效，请关闭并重新读取后再保存。':failText(r))}
  function move(index:number,delta:number){const photos=[...form.photos];[photos[index],photos[index+delta]]=[photos[index+delta],photos[index]];setForm({...form,photos})}
  return <AdminDialog title={`${initial.name} · 打卡设置`} onClose={()=>{if(!busy)onClose()}}>
    <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}><label>推荐说明（选填）<textarea className="adm__textarea" maxLength={300} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label>推荐状态<select className="adm__input" value={form.active?'active':'paused'} onChange={e=>setForm({...form,active:e.target.value==='active'})}><option value="active">推荐中</option><option value="paused">暂停</option></select></label>
    <h3>展示照片（最多9篇帖子，每篇选一张）</h3>
    {form.photos.map((photo,i)=><div className="adm__card" key={photo.postId}>
      {photo.valid!==false?<img src={mediaUrl(photo.mediaId)} alt={`展示照片${i+1}`} style={{width:88,height:72,objectFit:'cover'}}/>:<p>照片已失效，请移除后重新选择</p>}
      <p>{i===0?'封面':`第${i+1}张`}</p><div className="adm__actions"><button className="adm__btn" disabled={i===0} onClick={()=>move(i,-1)}>上移</button><button className="adm__btn" disabled={i===form.photos.length-1} onClick={()=>move(i,1)}>下移</button><button className="adm__btn" onClick={()=>setForm({...form,photos:form.photos.filter((_,n)=>n!==i)})}>移除</button></div>
    </div>)}
    <h3>选择该地点的公开带图帖子</h3><label>搜索帖子正文或作者<input className="adm__input" maxLength={100} value={q} onChange={e=>setQ(e.target.value)}/></label>
    {posts.data.map(p=><article className="adm__card" key={p.id}><p>{p.author}{p.anonymous?'（用户侧匿名）':''} · {relativeTime(p.createdAt)}</p><p>{p.body}</p><button className="adm__btn" onClick={()=>navigate('feed',{id:p.id})}>预览原帖</button><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{p.images.map(image=><button key={image.id} className="adm__btn" aria-label={`选择${p.author}的照片`} disabled={form.photos.some(photo=>photo.postId===p.id)||form.photos.length>=9} onClick={()=>setForm({...form,photos:[...form.photos,{postId:p.id,mediaId:image.id,valid:true}]})}><img src={mediaUrl(image.id)} alt="候选照片" loading="lazy" style={{width:72,height:64,objectFit:'cover'}}/></button>)}</div></article>)}
    <PageState state={posts}/></fieldset>
    {error&&<p role="alert">{error}</p>}<div className="adm__actions"><button className="adm__btn" disabled={busy} onClick={onClose}>取消</button><button className="adm__btn adm__btn--primary" disabled={busy||form.active&&!form.photos.length||form.photos.some(p=>p.valid===false)} onClick={()=>void save()}>{busy?'保存中…':'保存打卡设置'}</button></div>
  </AdminDialog>
}
