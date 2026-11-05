import { useEffect, useRef, useState } from 'react'
import { getMyProfile, patchMyProfile, uploadMedia, mediaUrl, failText, type ApiProfile, type ProfileUpdate } from '../api/client'
import { updateSessionUser } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconCamera, IconChevronRight, IconEdit } from '../components/icons'
import { goBack, navigate, registerNavigationGuard } from '../router'
import './profileedit.css'

function InfoIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></svg>
}
function LockIcon() {
  return <svg width="16" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3" /></svg>
}
const fields = (profile: ApiProfile): ProfileUpdate => ({displayName:profile.displayName,bio:profile.bio,avatarMediaId:profile.avatarMediaId,campusId:profile.campusId,collegeId:profile.collegeId,enrollmentYear:profile.enrollmentYear})
type Editor = 'displayName' | 'bio' | 'campusId' | 'collegeId' | 'enrollmentYear'
const titles: Record<Editor,string> = {displayName:'修改昵称',bio:'个人简介',campusId:'选择校区',collegeId:'选择学院',enrollmentYear:'选择年级'}

/** Full private profile editor; drafts are committed only after an authoritative PATCH. */
export function ProfileEditScreen() {
  const [profile,setProfile] = useState<ApiProfile|null>(null)
  const [draft,setDraft] = useState<ProfileUpdate|null>(null)
  const [phase,setPhase] = useState<'loading'|'ready'|'error'|'unauth'>('loading')
  const [revision,setRevision] = useState(0)
  const [loadError,setLoadError] = useState('')
  const [editor,setEditor] = useState<Editor|null>(null)
  const [value,setValue] = useState('')
  const [inputError,setInputError] = useState('')
  const [saving,setSaving] = useState(false)
  const [uploading,setUploading] = useState(false)
  const [error,setError] = useState('')
  const [saved,setSaved] = useState(false)
  const [avatarBroken,setAvatarBroken] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement|null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  const dirty = Boolean(profile&&draft&&JSON.stringify(fields(profile))!==JSON.stringify(draft))
  const initial = Array.from(draft?.displayName.trim()||'?')[0]

  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    let current=true
    void getMyProfile().then(result=>{
      if(!current)return
      if(!result.ok){setPhase(result.status===401?'unauth':'error');setLoadError(result.status===404?'资料服务尚未更新，请更新后端后重试。':'请检查网络后重试。');return}
      setProfile(result.value);setDraft(fields(result.value));setPhase('ready')
    })
    return()=>{current=false}
  },[revision])
  useEffect(()=>{
    const original=window.location.hash
    const remove=registerNavigationGuard(target=>{
      if(target===original)return true
      if(busy.current){window.history.replaceState(null,'',original);return false}
      if(!dirty||window.confirm('资料修改尚未保存，确定离开吗？'))return true
      window.history.replaceState(null,'',original);return false
    })
    const unload=(event:BeforeUnloadEvent)=>{if(dirty||busy.current){event.preventDefault();event.returnValue=''}}
    window.addEventListener('beforeunload',unload)
    return()=>{remove();window.removeEventListener('beforeunload',unload)}
  },[dirty])
  useEffect(()=>{
    if(editor){dialog.current?.showModal();input.current?.focus()}
  },[editor])

  function change(patch:Partial<ProfileUpdate>){setDraft(previous=>previous?{...previous,...patch}:previous);setSaved(false);setError('')}
  function open(field:Editor){if(!draft)return;opener.current=document.activeElement as HTMLElement;setValue(String(draft[field]??''));setInputError('');setEditor(field)}
  function finish(){
    if(!editor)return
    const next=value.trim()
    if(editor==='displayName'&&(!next||next.length>40)){setInputError('昵称不能为空且最多 40 个字符');return}
    if(editor==='bio'&&Array.from(next).length>160){setInputError('简介最多 160 个字');return}
    if(editor==='enrollmentYear'&&next&&(!/^\d{4}$/.test(next)||Number(next)<1900||Number(next)>2100)){setInputError('请输入 1900–2100 之间的入学年份');return}
    change({[editor]:editor==='enrollmentYear'?(next?Number(next):null):editor==='campusId'||editor==='collegeId'?(next||null):next})
    dialog.current?.close()
  }
  async function upload(file:File|undefined){
    if(!file||busy.current)return
    if(file.size>5*1024*1024){setError('头像图片过大，请压缩到 5MB 以内后重试。');return}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('头像仅支持 JPG、PNG 或 WebP 图片，请更换格式后重试。');return}
    busy.current=true;setUploading(true);setError('');setSaved(false)
    try{
      const result=await uploadMedia(file,'avatar')
      if(!alive.current)return
      if(!result.ok){setError(result.status===413?'头像图片超过服务器上传大小限制，请压缩图片或选择更小的图片后重试；原头像未改变。':`${failText(result)}；原头像未改变。`);return}
      change({avatarMediaId:result.value.id});setAvatarBroken(false)
    }catch{if(alive.current)setError('头像上传失败，请重试。')}
    finally{busy.current=false;if(alive.current)setUploading(false)}
  }
  async function save(){
    if(!draft||!dirty||busy.current)return
    busy.current=true;setSaving(true);setError('');setSaved(false)
    try{
      const result=await patchMyProfile(draft)
      if(!alive.current)return
      if(!result.ok){setError(result.status===401?'登录已过期，请重新登录。你的修改已保留。':result.status===400?'资料校验未通过，请重新检查校区、学院、年级及简介。你的修改已保留。':'保存失败，请稍后重试。你的修改已保留。');return}
      setProfile(result.value);setDraft(fields(result.value));updateSessionUser({displayName:result.value.displayName,bio:result.value.bio,avatarMediaId:result.value.avatarMediaId});setSaved(true)
    }catch{if(alive.current)setError('保存失败，请稍后重试。你的修改已保留。')}
    finally{busy.current=false;if(alive.current)setSaving(false)}
  }
  const options=editor==='campusId'?profile?.options.campuses:profile?.options.colleges
  return <Screen className="profile-reference" header={<TopBar left={<button className="iconbtn" aria-label="返回" disabled={saving||uploading} onClick={()=>goBack('me')}><IconBack size={24}/></button>} center="个人资料"/>} scroll>
    {phase==='loading'&&<div className="pe__state" data-pe-state="loading" role="status">正在读取个人资料…</div>}
    {(phase==='error'||phase==='unauth')&&<div className="pe__state" data-pe-state="unavailable"><InfoIcon/><h2>{phase==='unauth'?'登录后编辑个人资料':'个人资料暂时无法读取'}</h2><p>{phase==='unauth'?'登录后即可查看和修改自己的资料。':loadError}</p><button onClick={()=>{if(phase==='unauth')navigate('loginselect');else{setPhase('loading');setRevision(n=>n+1)}}}>{phase==='unauth'?'去登录':'重新加载'}</button></div>}
    {phase==='ready'&&profile&&draft&&<div className="pe__content" data-pe-state="ready">
      <section className="pe__hero" aria-label="头像">
        <div className="pe__avatarWrap">
          <svg className="pe__sprig" viewBox="0 0 46 78" fill="none" aria-hidden="true"><path d="M39 74C14 49 15 30 19 5" stroke="currentColor" strokeWidth="1.2"/><g fill="currentColor"><ellipse cx="17" cy="12" rx="4" ry="10" transform="rotate(-8 17 12)"/><ellipse cx="10" cy="29" rx="4" ry="9" transform="rotate(-45 10 29)"/><ellipse cx="23" cy="34" rx="3" ry="9" transform="rotate(15 23 34)"/><ellipse cx="15" cy="47" rx="4" ry="10" transform="rotate(-50 15 47)"/><ellipse cx="29" cy="53" rx="3" ry="9" transform="rotate(10 29 53)"/></g></svg>
          <button className="pe__avatarButton" aria-label="更换头像" disabled={saving||uploading} onClick={()=>fileInput.current?.click()}><span className="pe__avatar">{draft.avatarMediaId&&!avatarBroken?<img src={mediaUrl(draft.avatarMediaId)} alt="当前头像" onError={()=>setAvatarBroken(true)}/>:initial}</span><span className="pe__camera" aria-hidden="true"><IconCamera size={20}/></span></button>
        </div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="上传头像图片" onChange={event=>{void upload(event.target.files?.[0]);event.target.value=''}}/>
        <p className="pe__avatarTitle" role={uploading?'status':undefined}>{uploading?'正在上传头像…':'点击更换头像'}</p><p className="pe__avatarHint">支持 JPG、PNG、WebP，图片不超过 5MB。</p>
        {draft.avatarMediaId&&<button className="pe__removeAvatar" disabled={saving||uploading} onClick={()=>{change({avatarMediaId:null});setAvatarBroken(false)}}>移除头像</button>}
      </section>
      <section className="pe__section" aria-labelledby="pe-personal-title"><h2 id="pe-personal-title">个人信息</h2>
        <button className="pe__row" disabled={saving||uploading} data-pe-row="nickname" onClick={()=>open('displayName')}><span className="pe__label">昵称</span><span className="pe__value" data-pe-name>{draft.displayName||'未设置'}</span><IconChevronRight size={19}/></button>
        <button className="pe__bio" disabled={saving||uploading} data-pe-row="bio" onClick={()=>open('bio')}><span><span className="pe__label">个人简介</span><span className={`pe__bioText ${draft.bio?'is-filled':''}`}>{draft.bio||'写一句话介绍自己'}</span></span><IconEdit size={19}/></button>
      </section>
      <section className="pe__section pe__section--campus" aria-labelledby="pe-campus-title"><h2 id="pe-campus-title">校园信息 <span>选填</span></h2>
        <div className="pe__row pe__row--school"><span className="pe__label">学校</span><div className="pe__schoolValue"><span>{profile.school.name}<LockIcon/></span><small>当前服务学校不可修改</small></div></div>
        {([{field:'campusId',label:'校区',placeholder:'请选择'},{field:'collegeId',label:'学院',placeholder:'未填写'},{field:'enrollmentYear',label:'年级',placeholder:'请选择'}] as const).map(item=><button className="pe__row" key={item.field} data-pe-row={item.field} disabled={saving||uploading} onClick={()=>open(item.field)}><span className="pe__label">{item.label}</span><span className="pe__value">{item.field==='enrollmentYear'?(draft.enrollmentYear?`${draft.enrollmentYear} 级`:item.placeholder):(profile.options[item.field==='campusId'?'campuses':'colleges'].find(option=>option.id===draft[item.field])?.name||item.placeholder)}</span><IconChevronRight size={19}/></button>)}
      </section>
      <footer className="pe__footer"><p className="pe__privacy"><InfoIcon/>仅填写你愿意展示的资料。</p>{error&&<p className="pe__error" data-pe-error role="alert">{error}</p>}{saved&&<p className="pe__success" role="status">修改已保存</p>}{dirty&&!saving&&!error&&<p className="pe__unsaved" role="status">有未保存的修改</p>}<button className="pe__save" data-pe-save disabled={!dirty||saving||uploading} onClick={()=>void save()}>{saving?'保存中…':'保存修改'}</button></footer>
    </div>}
    <dialog className="pe__dialog" ref={dialog} aria-labelledby="pe-dialog-title" onClose={()=>{setEditor(null);opener.current?.focus()}}><form onSubmit={event=>{event.preventDefault();finish()}}><h2 id="pe-dialog-title">{editor?titles[editor]:''}</h2>
      <label className="pe__inputLabel" htmlFor="pe-edit-value">{editor?titles[editor]:''}</label>
      {editor==='bio'?<textarea ref={element=>{input.current=element}} id="pe-edit-value" data-pe-input className="pe__input pe__textarea" value={value} onChange={event=>{setValue(event.target.value);setInputError('')}} aria-describedby="pe-editor-hint"/>:editor==='campusId'||editor==='collegeId'?<select ref={element=>{input.current=element}} id="pe-edit-value" data-pe-input className="pe__input" value={value} onChange={event=>setValue(event.target.value)}><option value="">不填写</option>{options?.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select>:<input ref={element=>{input.current=element}} id="pe-edit-value" data-pe-input className="pe__input" value={value} maxLength={editor==='displayName'?40:4} inputMode={editor==='enrollmentYear'?'numeric':'text'} autoComplete={editor==='displayName'?'nickname':'off'} onChange={event=>{setValue(event.target.value);setInputError('')}} aria-invalid={Boolean(inputError)} aria-describedby="pe-editor-hint"/>}
      <p id="pe-editor-hint" className="pe__dialogHint">{editor==='bio'?`${Array.from(value.trim()).length} / 160 字。`:editor==='enrollmentYear'?'填写四位入学年份，如 2026；留空可清除。':editor==='collegeId'&&!profile?.collegeListComplete?'当前学院列表为已有资料，可选择不填写。':''}完成后点击页面底部保存。</p>
      {inputError&&<p className="pe__error" role="alert">{inputError}</p>}<div className="pe__dialogActions"><button type="button" onClick={()=>dialog.current?.close()}>取消</button><button className="pe__done" type="submit">完成</button></div>
    </form></dialog>
  </Screen>
}
