import { useCallback, useEffect, useRef, useState } from 'react'
import { createPost, generateCutout, listPlaces, uploadMedia, type ApiPlaceListItem } from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { Button } from '../components/Button'
import { PublishIcon, CampusTrail } from '../components/PublishArtwork'
import { IconClose } from '../components/icons'
import { pickPhoto, takePhoto } from '../native/camera'
import { renderSticker } from '../native/sticker'
import { defaultImageText, renderImageText, type ImageText } from '../native/imageText'
import { ImageTextControls, ImageTextPreview } from '../components/ImageTextControls'
import { deleteDraft, listDrafts, saveDraft, type PublishDraft } from '../data/publishDrafts'
import { takeRepublish } from '../data/store'
import { navigate, registerNavigationGuard, useRoute } from '../router'
import './publish.css'

export function PublishScreen() {
  const route = useRoute()
  /**
   * 「重新发布」交接（见 `store.ts` 的 `stashRepublish`）：只读一次并立刻消费掉。
   * 放在 useState 初始化里而不是 effect 里 —— effect 里 setState 会多跑一轮渲染，
   * 也会让「预填」这种纯初始化逻辑看起来像副作用。
   */
  const [republish] = useState(() => takeRepublish())
  const [owner] = useState(() => getSession()?.user.id ?? 'guest')
  const [placeId, setPlaceId] = useState(route.query.placeId ?? '')
  const [text, setText] = useState(republish?.text ?? '')
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
  const [sheet, setSheet] = useState<'image' | 'exit' | 'drafts' | 'image-options' | null>('drafts')
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
  const sheetRef = useRef<HTMLDivElement>(null)
  const locked = publishing || Boolean(pendingSubmission) || sheet === 'drafts'
  const count = Array.from(text.trim()).length
  // A previous render cannot be adopted while the current source/style is pending or failed.
  const sticker = stickerResult?.source === rawSticker && stickerResult.outline === outline ? stickerResult.dataUrl : ''
  const baseDisplay = adopted || rawSticker ? sticker || original : original
  const imageTextKey = JSON.stringify(imageText)
  const imageTextCount = Array.from(imageText.text).length
  const hasImageText = Boolean(imageText.text.trim())
  const readyTextImage = textImage?.source === baseDisplay && textImage.key === imageTextKey ? textImage.dataUrl : ''
  const selectedPlace = places.find(p => p.id === placeId)
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
    if (r.ok) {
      setPlaces(r.value)
      setPlacesPhase('ready')
      /*
        重新发布时旧记录只存了**地标名**（没有 id）：等列表回来后按名字回填 id。
        找不到同名地标就保持"未选" —— 宁可让用户自己选，也不要随便挑一个。
      */
      const want = republish?.placeName ?? ''
      if (want) {
        const hit = r.value.find((p) => p.name === want)
        if (hit) setPlaceId(hit.id)
      }
    } else setPlacesPhase('error')
  }, [republish?.placeName])
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

  useEffect(() => {
    if (!sheet) return
    const previous = document.activeElement as HTMLElement | null
    const panel = sheetRef.current
    const controls = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
    ;(controls()[0] ?? panel)?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (sheet !== 'drafts' || draftReady)) {
        event.preventDefault(); pendingRoute.current = null; setSheet(null)
      }
      if (event.key === 'Tab') {
        const items = controls()
        if (!items.length) { event.preventDefault(); panel?.focus(); return }
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); if (previous?.isConnected) previous.focus() }
  }, [sheet, draftReady])

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

  return <Screen className={`pub ${original ? 'pub--has-image' : 'pub--empty'}`} header={<TopBar variant="plain"
    left={<button className="iconbtn pub__close" disabled={publishing} aria-label="关闭" onClick={() => dirty.current ? setSheet('exit') : leave()}><IconClose size={24} /></button>}
    center={<span className="pub__topTitle">写一段回忆</span>}
    right={<div className="pub__publishTarget"><Button size="compact" className="pub__publish" disabled={!canPublish} loading={publishing} data-publishing={publishing ? '1' : '0'} onClick={() => void publish()}>发布</Button></div>} />}>
    <div className="pub__body">
      <div className="pub__hero"><h1>把这一刻，<br />留在校园里。</h1><span aria-hidden="true" /></div>
      <section className="pub__location" data-pub-place-field>
        <div className={`pub__place ${selectedPlace ? 'pub__place--selected' : ''}`}>
          <PublishIcon name="pin" size={26} />
          <label htmlFor="pub-place">{selectedPlace ? '关联地点' : '选择校园地点'}</label>
          {selectedPlace ? <strong>{selectedPlace.name}</strong> : <span className="pub__required">必选</span>}
          <span className="pub__placeArrow" aria-hidden="true">›</span>
          {placesPhase === 'ready' && <select id="pub-place" className="pub__select" aria-label="选择校园地点" disabled={locked} value={placeId} data-pub-place={placeId} onChange={e => setPlaceId(e.target.value)}><option value="">选择一个校园地点</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        </div>
        {placesPhase === 'loading' && <p className="pub__hint" role="status">地标加载中…</p>}
        {placesPhase === 'ready' && !places.length && <p className="pub__hint">暂无可选地点，请稍后再试。</p>}
        {placesPhase === 'error' && <Button variant="text" onClick={() => void loadPlaces()}>地标加载失败，点击重试</Button>}
      </section>
      <section className="pub__writing">
        <label className="ui-sr-only" htmlFor="pub-text">回忆正文</label>
        <textarea id="pub-text" className="pub__textarea" data-pub-text aria-describedby="pub-text-count" aria-invalid={count > 500 || undefined} disabled={locked} value={text} rows={original ? 2 : 5} onChange={e => { dirty.current = Boolean(e.target.value.trim() || original); setText(e.target.value) }} placeholder="这里发生了什么，想和大家分享？" />
        <p id="pub-text-count" className={`pub__counter ${count > 500 ? 'pub__hint--err' : ''}`}>{count} / 500<span className="ui-sr-only"> 字</span></p>
      </section>
      <section className="pub__media" aria-label="照片与图片编辑">
        {original ? <>
          <div className="pub__photo">
            <ImageTextPreview source={baseDisplay} caption={imageText} editing={textEditorOpen} disabled={locked} sticker={Boolean(rawSticker)} onChange={setImageText} />
            <button className="pub__photoBadge" disabled={locked} onClick={() => setTextEditorOpen(v => !v)} aria-expanded={textEditorOpen}>图片编辑</button>
            <button className="pub__photoMore" disabled={locked} aria-label="图片更多操作" onClick={() => setSheet('image-options')}><span><PublishIcon name="more" size={18} /></span></button>
          </div>
          <div className="pub__tools" aria-label="图片工具">
            <button className={`pub__tool ${textEditorOpen ? 'is-active' : ''}`} disabled={locked} aria-expanded={textEditorOpen} aria-controls="pub-image-editor" onClick={() => setTextEditorOpen(v => !v)}><PublishIcon name="text" /><span>添加文字</span></button>
            <button className="pub__tool" disabled={locked || processing || busy || rendering} aria-busy={processing} onClick={() => void cutout()}><PublishIcon name="sparkles" /><span>{processing ? '生成中…' : '生成贴纸'}</span></button>
            <button className="pub__tool pub__tool--muted" disabled={locked || busy} onClick={() => setSheet('image')}><PublishIcon name="replace" /><span>更换</span></button>
            <button className="pub__tool pub__tool--muted" disabled={locked} onClick={() => { clearEffect(); setOriginal(''); stickerRequested.current = false; setImageText(defaultImageText()); setTextEditorOpen(false) }}><PublishIcon name="trash" /><span>删除</span></button>
          </div>
          {textEditorOpen && <ImageTextControls value={imageText} disabled={locked} onChange={setImageText} onDone={() => setTextEditorOpen(false)} onDelete={() => setImageText(defaultImageText())} />}
          {processing && <p className="pub__hint" role="status">正在识别主体，你可以继续编辑正文和地点。</p>}
          {rawSticker && <div className="pub__stickerActions"><label><input type="checkbox" checked={outline} disabled={locked || rendering} onChange={e => setOutline(e.target.checked)} />白色描边</label><Button variant="secondary" disabled={locked || processing || rendering || !sticker} onClick={() => setAdopted(true)}>{rendering ? '预览处理中…' : adopted ? '已采用贴纸' : '确认采用贴纸'}</Button></div>}
          {(processing || rawSticker || stickerRequested.current) && <Button variant="text" disabled={locked} onClick={clearEffect}>恢复原图 / 取消处理</Button>}
          {rawSticker && !adopted && <p className="pub__hint">预览满意后确认采用，或恢复原图后发布。</p>}
        </> : <>
          <button className="pub__add" data-pub-add-image disabled={locked || busy} onClick={() => setSheet('image')}>
            <PublishIcon name="photo" size={48} /><strong>{busy ? '读取图片中…' : '添加一张照片'}</strong><span>也可以只用文字，记录这一刻。</span>
          </button>
          <div className="pub__imageHint"><PublishIcon name="text" size={23} /><span aria-hidden="true">|</span><PublishIcon name="sparkles" size={20} /><p>上传后，可添加文字或生成主体贴纸。</p></div>
        </>}
      </section>
      {notice && <p className="pub__hint" role="status">{notice}</p>}
      {err && <p className="pub__err" data-publish-err role="alert">{err}</p>}
      <footer className="pub__footer">
        {original ? <p><PublishIcon name="pin" size={20} /><span>{selectedPlace ? `发布后，这段回忆会出现在${selectedPlace.name}的地图上。` : '选择校园地点，让这段回忆有一个坐标。'}</span></p> : <><p data-pub-blocked={!placeId ? 'no-place' : !text.trim() ? 'empty' : undefined}>选择地点，写点文字或添加照片即可发布。</p><CampusTrail /></>}
      </footer>
    </div>
    {sheet && <div className="pub__overlay"><div ref={sheetRef} tabIndex={-1} className="pub__sheet" role="dialog" aria-modal="true" aria-label={sheet === 'image' ? '添加图片' : sheet === 'image-options' ? '图片操作' : sheet === 'exit' ? '退出编辑' : '本地草稿'}>
      {sheet === 'image' && <><h2>添加图片</h2><Button variant="secondary" onClick={() => void chooseImage(true)}>拍照</Button><Button variant="secondary" onClick={() => void chooseImage(false)}>从相册选择</Button><Button variant="secondary" onClick={() => setSheet(null)}>取消</Button></>}
      {sheet === 'image-options' && <><h2>图片操作</h2><Button variant="secondary" onClick={() => { setTextEditorOpen(true); setSheet(null) }}>编辑图片文字</Button><Button variant="secondary" onClick={() => setSheet('image')}>更换图片</Button><Button variant="secondary" onClick={() => setSheet(null)}>取消</Button></>}
      {sheet === 'exit' && <><h2>保存这次记录？</h2><p>草稿保存在当前设备，贴纸恢复时需重新生成。</p><Button onClick={() => void exit(true)}>保存草稿并退出</Button><Button variant="danger" onClick={() => void exit(false)}>放弃编辑</Button><Button variant="secondary" onClick={() => { pendingRoute.current = null; setSheet(null) }}>继续编辑</Button></>}
      {sheet === 'drafts' && <><h2>继续上次的记录</h2>{!draftReady && <p>读取草稿中…</p>}{drafts.map(d => <Button variant="secondary" key={d.id} onClick={() => restore(d)}>{d.text.slice(0, 30) || '图片草稿'} · {new Date(d.updatedAt).toLocaleDateString()}</Button>)}<Button variant="secondary" disabled={!draftReady} onClick={() => setSheet(null)}>新建帖子（保留已有草稿）</Button></>}
      {err && <p className="pub__err" role="alert">{err}</p>}
    </div></div>}
  </Screen>
}
