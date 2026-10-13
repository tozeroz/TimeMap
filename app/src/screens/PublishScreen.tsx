import { useCallback, useEffect, useRef, useState } from 'react'
import { createPost, generateCutout, listPlaces, uploadMedia, type ApiPlaceListItem } from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { pickPhoto, takePhoto } from '../native/camera'
import { renderSticker } from '../native/sticker'
import { defaultImageText, renderImageText, type ImageText } from '../native/imageText'
import { ImageTextControls, ImageTextPreview } from '../components/ImageTextControls'
import { deleteDraft, listDrafts, saveDraft, type PublishDraft } from '../data/publishDrafts'
import { navigate, registerNavigationGuard, useRoute } from '../router'
import './publish.css'

export function PublishScreen() {
  const route = useRoute()
  const [owner] = useState(() => getSession()?.user.id ?? 'guest')
  const [placeId, setPlaceId] = useState(route.query.placeId ?? '')
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [rawSticker, setRawSticker] = useState('')
  const [stickerResult, setStickerResult] = useState<{ source: string; outline: boolean; dataUrl: string } | null>(null)
  const [outline, setOutline] = useState(true)
  const [adopted, setAdopted] = useState(false)
  const [imageText, setImageText] = useState<ImageText>(defaultImageText)
  const [textEditorOpen, setTextEditorOpen] = useState(false)
  const [textImage, setTextImage] = useState<{ source: string; key: string; dataUrl: string } | null>(null)
  const [processing, setProcessing] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pendingSubmission, setPendingSubmission] = useState<PublishDraft['pendingSubmission']>()
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [sheet, setSheet] = useState<'image' | 'exit' | 'drafts' | null>('drafts')
  const [drafts, setDrafts] = useState<PublishDraft[]>([])
  const [draftReady, setDraftReady] = useState(false)
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])
  const [placesPhase, setPlacesPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const draftId = useRef(`${owner}:${crypto.randomUUID()}`)
  const imageVersion = useRef(0)
  const requestId = useRef(crypto.randomUUID())
  const cutoutRequest = useRef(crypto.randomUUID())
  const submitting = useRef(false)
  const uploaded = useRef(new Map<string, string>())
  const uploadKeys = useRef(new Map<string, string>())
  const cutoutBusy = useRef(false)
  const stickerRequested = useRef(false)
  const dirty = useRef(false)
  const lastHash = useRef(window.location.hash)
  const pendingRoute = useRef<string | null>(null)
  const locked = publishing || Boolean(pendingSubmission) || sheet === 'drafts'
  const count = Array.from(text.trim()).length
  // A previous render cannot be adopted while the current source/style is pending or failed.
  const sticker = stickerResult?.source === rawSticker && stickerResult.outline === outline ? stickerResult.dataUrl : ''
  const baseDisplay = adopted || rawSticker ? sticker || original : original
  const imageTextKey = JSON.stringify(imageText)
  const imageTextCount = Array.from(imageText.text).length
  const hasImageText = Boolean(imageText.text.trim())
  const readyTextImage = textImage?.source === baseDisplay && textImage.key === imageTextKey ? textImage.dataUrl : ''
  const display = hasImageText ? readyTextImage || baseDisplay : baseDisplay
  const canPublish = Boolean(text.trim() || original) && count <= 500 && places.some(p => p.id === placeId)
    && !publishing && !processing && !rendering && !busy && !sheet && (!rawSticker || (adopted && Boolean(sticker)))
    && imageTextCount <= 50 && (!hasImageText || Boolean(readyTextImage))

  useEffect(() => {
    let alive = true
    setTextImage(null)
    if (!baseDisplay || !hasImageText || imageTextCount > 50) return
    void renderImageText(baseDisplay, imageText).then(dataUrl => {
      if (alive) setTextImage({ source: baseDisplay, key: imageTextKey, dataUrl })
    }).catch(e => { if (alive) setErr(`图片文字预览失败：${(e as Error).message}`) })
    return () => { alive = false }
  }, [baseDisplay, hasImageText, imageTextCount, imageText, imageTextKey])

  const loadPlaces = useCallback(async () => {
    setPlacesPhase('loading')
    const r = await listPlaces()
    if (r.ok) { setPlaces(r.value); setPlacesPhase('ready') }
    else setPlacesPhase('error')
  }, [])
  useEffect(() => { void loadPlaces() }, [loadPlaces])
  useEffect(() => {
    void listDrafts().then(items => {
      const mine = items.filter(d => d.id.startsWith(`${owner}:`)).sort((a, b) => b.updatedAt - a.updatedAt)
      setDrafts(mine); if (!mine.length) setSheet(null)
    }).catch(() => { setErr('无法读取本地草稿，请检查浏览器存储权限'); setSheet(null) })
      .finally(() => setDraftReady(true))
  }, [owner])
  useEffect(() => {
    let alive = true
    setStickerResult(null)
    if (!rawSticker) { setRendering(false); return }
    setRendering(true)
    void renderSticker(rawSticker, outline).then(value => {
      if (alive) setStickerResult({ source: rawSticker, outline, dataUrl: value })
    }).catch(e => {
      if (alive) { setStickerResult(null); setAdopted(false); setErr((e as Error).message) }
    })
      .finally(() => { if (alive) setRendering(false) })
    return () => { alive = false }
  }, [rawSticker, outline])
  useEffect(() => {
    dirty.current = Boolean(text.trim() || original)
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    const removeGuard = registerNavigationGuard((target) => {
      if (target === lastHash.current || !dirty.current) return true
      window.history.replaceState(null, '', lastHash.current)
      if (submitting.current) {
        setNotice('正在发布，请等待结果后再离开。')
        return false
      }
      pendingRoute.current = target
      setSheet('exit')
      return false
    })
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload); removeGuard() }
  }, [text, original])
  useEffect(() => () => { imageVersion.current++ }, [])

  function clearEffect() {
    imageVersion.current++; cutoutBusy.current = false; setRawSticker(''); setStickerResult(null); setAdopted(false); setProcessing(false)
    setOutline(true); cutoutRequest.current = crypto.randomUUID()
  }
  async function chooseImage(camera: boolean) {
    setBusy(true); setErr(''); setSheet(null)
    try {
      const photo = await (camera ? takePhoto() : pickPhoto())
      if (photo) { clearEffect(); dirty.current = true; setOriginal(photo.dataUrl); stickerRequested.current = false; setImageText(defaultImageText()); setTextEditorOpen(false) }
    } catch (e) { setErr(`${(e as Error).message}；仍可从相册选择`) }
    finally { setBusy(false) }
  }
  async function mediaId(source: string) {
    const cached = uploaded.current.get(source)
    if (cached) return cached
    const blob = await (await fetch(source)).blob()
    if (!uploadKeys.current.has(source)) uploadKeys.current.set(source, crypto.randomUUID())
    const r = await uploadMedia(blob, 'post', undefined, uploadKeys.current.get(source))
    if (!r.ok) throw new Error(`图片上传失败：${r.reason}`)
    uploaded.current.set(source, r.value.id)
    return r.value.id
  }
  async function cutout() {
    if (cutoutBusy.current) return
    cutoutBusy.current = true
    const version = imageVersion.current
    setProcessing(true); setErr(''); stickerRequested.current = true
    try {
      const id = await mediaId(original)
      if (version !== imageVersion.current) return
      const r = await generateCutout(id, cutoutRequest.current)
      if (version !== imageVersion.current) return
      if (!r.ok) {
        // A timed-out request may still finish. Keep its key when its result is unknown.
        if (r.status && r.status !== 409) cutoutRequest.current = crypto.randomUUID()
        throw new Error(r.reason)
      }
      setOutline(true); setRawSticker(r.value.dataUrl); setAdopted(false)
    } catch (e) { if (version === imageVersion.current) setErr(`生成贴纸失败：${(e as Error).message}。可重试、换图或使用原图。`) }
    finally { if (version === imageVersion.current) { cutoutBusy.current = false; setProcessing(false) } }
  }
  function restore(d: PublishDraft) {
    dirty.current = Boolean(d.text.trim() || d.original)
    draftId.current = d.id; setText(d.text); setOriginal(d.original); setPlaceId(d.placeId)
    setPendingSubmission(d.pendingSubmission)
    setImageText(d.imageText ?? defaultImageText()); setTextEditorOpen(Boolean(d.imageText?.text))
    stickerRequested.current = d.stickerRequested; setSheet(null)
    if (d.pendingSubmission) setNotice('上次发布结果尚未确认。请点击发布查询结果，确认前暂不能修改内容。')
    else if (d.stickerRequested) setNotice('草稿已恢复，贴纸需点击“生成贴纸”重新生成。')
  }
  function leave() {
    dirty.current = false; imageVersion.current++
    const target = pendingRoute.current
    pendingRoute.current = null
    if (target) window.location.hash = target
    else navigate('map')
  }
  async function exit(save: boolean) {
    setErr('')
    try {
      if (save) await saveDraft({ id: draftId.current, text, original, placeId, stickerRequested: stickerRequested.current, updatedAt: Date.now(), pendingSubmission, imageText })
      else await deleteDraft(draftId.current)
      leave()
    } catch { setErr('草稿保存失败，编辑内容仍保留。请检查存储空间后重试。') }
  }
  async function publish() {
    if (!canPublish || submitting.current) return
    submitting.current = true; setPublishing(true); setErr('')
    try {
      const source = adopted ? sticker : original
      const id = !pendingSubmission && source ? await mediaId(hasImageText ? readyTextImage : source) : undefined
      const mapMediaId = !pendingSubmission && source && hasImageText ? await mediaId(source) : undefined
      const submission = pendingSubmission ?? { body: text.trim(), placeId, mediaIds: id ? [id] : [], ...(mapMediaId ? { mapMediaId } : {}), imageMode: adopted ? 'sticker' as const : 'photo' as const, clientRequestId: requestId.current }
      setPendingSubmission(submission)
      const r = await createPost(submission)
      if (!r.ok) {
        if (r.status && r.status >= 400 && r.status < 500 && r.status !== 409) {
          setPendingSubmission(undefined); requestId.current = crypto.randomUUID()
        } else setNotice('发布结果尚未确认。请直接重试查询同一次提交，确认前暂不能修改内容。')
        throw new Error(r.status === 401 ? '请登录后再次确认发布，编辑内容已保留' : r.reason)
      }
      dirty.current = false
      await deleteDraft(draftId.current).catch(() => undefined)
      navigate('map', { placeId, newPostId: r.value.id })
    } catch (e) { setErr(`发布失败：${(e as Error).message}。内容已保留，可重试。`) }
    finally { submitting.current = false; setPublishing(false) }
  }

  return <Screen className="pub" header={<TopBar variant="plain"
    left={<button className="iconbtn pub__close" disabled={publishing} aria-label="关闭" onClick={() => dirty.current ? setSheet('exit') : leave()}><IconClose size={22} /></button>}
    center={<span className="pub__topTitle">记录校园这一刻</span>}
    right={<button className={`pub__publish ${canPublish ? 'is-on' : ''}`} disabled={!canPublish} data-publishing={publishing ? '1' : '0'} onClick={() => void publish()}>{publishing ? '发布中…' : '发布'}</button>} />}>
    <div className="pub__body">
      <section className="pub__field" data-pub-place-field>
        <label className="pub__label" htmlFor="pub-place">关联地标 · 必选</label>
        {placesPhase === 'loading' && <p className="pub__hint">地标加载中…</p>}
        {placesPhase === 'error' && <button onClick={() => void loadPlaces()}>地标加载失败，点击重试</button>}
        {placesPhase === 'ready' && <select id="pub-place" className="pub__select" disabled={locked} value={placeId} data-pub-place={placeId} onChange={e => setPlaceId(e.target.value)}><option value="">选择一个校园地标</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </section>
      <section className="pub__field">
        <label className="pub__label" htmlFor="pub-text">正文</label>
        <textarea id="pub-text" className="pub__textarea" data-pub-text disabled={locked} value={text} onChange={e => { dirty.current = Boolean(e.target.value.trim() || original); setText(e.target.value) }} placeholder="记录这里发生的事，也可以只发一张照片…" />
        <p className={`pub__hint ${count > 500 ? 'pub__hint--err' : ''}`}>{count} / 500 字</p>
      </section>
      <section className="pub__field">
        <span className="pub__label">一张照片，一个故事</span>
        {original ? <>
          <ImageTextPreview source={display} caption={imageText} disabled={locked} sticker={Boolean(rawSticker)} onChange={setImageText} />
          <div className="pub__actions">
            <button disabled={locked || busy} onClick={() => setSheet('image')}>更换</button>
            <button disabled={locked} onClick={() => { clearEffect(); setOriginal(''); stickerRequested.current = false; setImageText(defaultImageText()); setTextEditorOpen(false) }}>删除</button>
            <button disabled={locked} onClick={() => setTextEditorOpen(true)}>{hasImageText ? '编辑图片文字' : '添加文字'}</button>
            <button disabled={locked || processing || busy} onClick={() => void cutout()}>{processing ? '生成中…' : rawSticker ? '重新生成' : '生成贴纸'}</button>
            {(processing || rawSticker || stickerRequested.current) && <button disabled={locked} onClick={clearEffect}>恢复原图 / 取消处理</button>}
          </div>
          {textEditorOpen && <ImageTextControls value={imageText} disabled={locked} onChange={setImageText} onDelete={() => { setImageText(defaultImageText()); setTextEditorOpen(false) }} />}
          {processing && <p className="pub__hint" role="status">正在识别主体，你可以继续编辑正文和地标。</p>}
          {rawSticker && <div className="pub__actions"><label><input type="checkbox" checked={outline} disabled={locked || rendering} onChange={e => setOutline(e.target.checked)} />白色描边</label><button disabled={locked || processing || rendering || !sticker} onClick={() => setAdopted(true)}>{rendering ? '预览处理中…' : adopted ? '已采用贴纸' : '确认采用贴纸'}</button></div>}
          {rawSticker && !adopted && <p className="pub__hint">预览满意后确认采用，或恢复原图后发布。</p>}
        </> : <button className="pub__add" data-pub-add-image disabled={locked || busy} onClick={() => setSheet('image')}>{busy ? '读取图片中…' : '＋ 添加图片'}</button>}
        <p className="pub__hint">可发纯文字、单图或图文。照片默认保留原图。</p>
      </section>
      {notice && <p className="pub__hint" role="status">{notice}</p>}
      {err && <p className="pub__err" data-publish-err role="alert">{err}</p>}
      {!placeId && <p className="pub__blocked" data-pub-blocked="no-place">请选择一个校园地标。</p>}
      {!text.trim() && !original && <p className="pub__blocked" data-pub-blocked="empty">写一点正文或添加一张图片即可发布。</p>}
    </div>
    {sheet && <div className="pub__overlay"><div className="pub__sheet" role="dialog" aria-modal="true" aria-label={sheet === 'image' ? '添加图片' : sheet === 'exit' ? '退出编辑' : '本地草稿'}>
      {sheet === 'image' && <><h2>添加图片</h2><button onClick={() => void chooseImage(true)}>拍照</button><button onClick={() => void chooseImage(false)}>从相册选择</button><button onClick={() => setSheet(null)}>取消</button></>}
      {sheet === 'exit' && <><h2>保存这次记录？</h2><p>草稿保存在当前设备，贴纸恢复时需重新生成。</p><button onClick={() => void exit(true)}>保存草稿并退出</button><button onClick={() => void exit(false)}>放弃编辑</button><button onClick={() => { pendingRoute.current = null; setSheet(null) }}>继续编辑</button></>}
      {sheet === 'drafts' && <><h2>继续上次的记录</h2>{!draftReady && <p>读取草稿中…</p>}{drafts.map(d => <button key={d.id} onClick={() => restore(d)}>{d.text.slice(0, 30) || '图片草稿'} · {new Date(d.updatedAt).toLocaleDateString()}</button>)}<button disabled={!draftReady} onClick={() => setSheet(null)}>新建帖子（保留已有草稿）</button></>}
      {err && <p className="pub__err" role="alert">{err}</p>}
    </div></div>}
  </Screen>
}
