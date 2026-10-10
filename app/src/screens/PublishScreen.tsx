import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPost,
  listPlaces,
  uploadMedia,
  type ApiPlaceListItem,
} from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconImage, IconLocation } from '../components/icons'
import { ensureCameraPermission, pickPhoto } from '../native/camera'
import { goBack, useRoute } from '../router'
import './publish.css'

/** 最多 3 张图（与需求 4.3 的"普通图文"口径一致；服务端也有上限校验） */
const MAX_IMAGES = 3

/**
 * 转换为 Blob：发布页的图片在内存里是 **dataURL**（`pickPhoto()` 的返回），
 * 而上传接口要 `File | Blob`。
 * ⚠️ 用 `fetch(dataUrl)` 而不是 `atob()` 手工解码：`atob` 对非 Latin-1 的 dataURL 会抛错。
 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const r = await fetch(dataUrl)
  return r.blob()
}

/**
 * 发布页（F04 / US-02；按需求 4.2 的「在这里发布」入口与 3.2 的业务规则重做）。
 *
 * ## 为什么重做（这不是"改一下调用参数"）
 *   改前这一页是**复刻那个产品的图片合成器**：三个模式「拍摄 / 文字 / 语音」，
 *   带实时取景摄像头、字体选择（经典/黑体/宋体/手写体）、真实录音。
 *   而 TimeMap 的发布范围是**纯文字或普通图文**（需求 3.1 MVP：「纯文字或普通图文发布」），
 *   且 3.2 的核心规则是「所有帖子必须关联管理员启用的预设地点」。
 *   ⇒ 于是：
 *     · **删除**「拍摄」模式（页内实时取景 + 快门 + 前后置切换）
 *     · **删除**「语音」模式（语音帖**不在 TimeMap 范围**：需求里没有语音这一项）
 *     · **删除**字体选择（那是图片合成器的能力，属 P1 的 F09/F10）
 *     · **新增**地点必选器（只能选管理员**启用**的地点）
 *     · 保留「从相册选图」（普通图文的唯一配图来源）
 *
 * ## US-02 验收标准逐条落点
 *   ① 「地点为必填项，只能选择启用地点」
 *      → 地点选择器的数据源是 `GET /api/places`（服务端**默认只返回启用地点**）；
 *        未选地点时发布按钮禁用，并明确提示原因
 *   ② 「支持纯文字和普通图文发布」→ 文字 + 可选 ≤3 图
 *   ③ 「发布后在地点详情与"我的发布"中可见，不出现人工待审核状态」
 *      → 直接 POST 即 published（服务端没有待审核态）；成功后跳该地点详情页，
 *        用户立刻能看到自己刚发的内容
 *   ④ 「空白内容或图片上传失败时不能创建成功帖子」
 *      → 空白正文禁用提交；图片上传失败**立即中止**（不发帖）并保留草稿
 *   ⑤ 「连续点击发布不得产生重复帖子」
 *      → `clientRequestId` **在用户开始这次发布时生成一次**（`crypto.randomUUID()`），
 *        重试复用同一个值；服务端凭它认出重放并返回原帖。
 *        ⚠️ 关键：绝不能每次调用现生成 —— 那样连点两次会得到两个不同的键，幂等就失效了。
 *   ⑥ 「只有作者能够删除自己的帖子」→ 删除入口在 FeedDetail（服务端校验归属）
 */
export function PublishScreen() {
  const route = useRoute()
  /*
    地点：从地点详情页的「在这里发布」进来时带 `?placeId=`，这里预选。
    ⚠️ 只做**预选**，不做锁定 —— 用户仍可改（需求没有说"必须发在这个地点"）。
  */
  const [placeId, setPlaceId] = useState(route.query.placeId ?? '')
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [err, setErr] = useState('')

  /**
   * 幂等键：**在发布页挂载时生成一次**，整页生命周期内复用。
   *
   * 为什么不是"点发布时生成"：那样连点两次会生成两个不同的键 ⇒ 服务端认不出是重放
   * ⇒ 产生两条帖子（US-02⑤ 直接失败）。用 useRef 保证只生成一次且不触发重渲染。
   * 为什么发布成功后要重置：用户留在本页再发**另一条**内容时，那是**新的一次发布**，
   * 必须用新键 —— 否则会被服务端当成上一条的重放，直接返回上一条而不创建新帖。
   */
  const clientRequestIdRef = useRef<string>(crypto.randomUUID())

  /* ---- 地点列表（只含启用地点；服务端默认过滤） ---- */
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])
  const [placesPhase, setPlacesPhase] = useState<'loading' | 'ready' | 'error'>('loading')

  const loadPlaces = useCallback(async () => {
    setPlacesPhase('loading')
    const r = await listPlaces()
    if (r.ok) {
      setPlaces(r.value)
      setPlacesPhase('ready')
    } else {
      setPlaces([])
      setPlacesPhase('error')
    }
  }, [])

  useEffect(() => {
    void loadPlaces()
  }, [loadPlaces])

  const picked = places.find((p) => p.id === placeId) ?? null
  const canPublish = text.trim().length > 0 && Boolean(placeId) && !publishing

  async function addFromGallery() {
    if (images.length >= MAX_IMAGES) {
      setErr(`最多 ${MAX_IMAGES} 张图片`)
      return
    }
    setBusy(true)
    setErr('')
    try {
      // 原生端要先拿系统相机权限，否则相册/相机选择器会被拒
      await ensureCameraPermission()
      const photo = await pickPhoto()
      if (photo) setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, photo.dataUrl]))
    } catch (e) {
      setErr(`选择图片失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 发布：**先传媒体，再发帖**。
   *
   * 顺序不能反：服务端**只有"发帖时一并挂媒体"这一条路**，没有"给已有帖子补挂媒体"的接口。
   * 反过来会先产生一条没图的帖子，且永远补不回来。
   *
   * ⚠️ 任何一步失败都**不显示成功**、**不清空草稿** —— 与"写操作失败绝不本地假成功"一致。
   */
  async function doPublish() {
    if (!canPublish) return
    setPublishing(true)
    setErr('')
    try {
      const mediaIds: string[] = []
      for (const durl of images) {
        try {
          const blob = await dataUrlToBlob(durl)
          const up = await uploadMedia(blob, 'post')
          if (!up.ok) {
            setErr(`图片上传失败：${up.reason}（帖子未创建，草稿仍在）`)
            return
          }
          mediaIds.push(up.value.id)
        } catch (e) {
          setErr(`图片处理失败：${(e as Error).message}（帖子未创建）`)
          return
        }
      }

      const r = await createPost({
        body: text.trim(),
        placeId,
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
        clientRequestId: clientRequestIdRef.current,
      })
      if (!r.ok) {
        setErr(
          r.status === 401
            ? '未登录：请先登录后再发布'
            : r.status === 400
              ? `发布被拒绝：${r.reason}`
              : `发布失败：${r.reason}`,
        )
        return
      }

      /*
        发布成功。
        ⚠️ 服务端在"同 clientRequestId 重放"时返回 200 + `idempotentReplay:true` + 原帖 id；
          正常创建是 201。两种都算成功，跳转都用服务端给的 id（**不要**用本地推断的 id）。
        下一次发布要用**新**的幂等键（见 clientRequestIdRef 的说明）。
      */
      clientRequestIdRef.current = crypto.randomUUID()
      /*
        跳转：发到**该地点的详情页**。
        为什么不是跳信息流：TimeMap 的组织单位是地点（需求 1.1），
        发完立刻在地点页看到自己的内容，正是 US-02③ 要证明的"发布后可见"。
      */
      goBack('map')
      window.location.hash = `#/poidetail?id=${encodeURIComponent(r.value.placeId ?? placeId)}`
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Screen
      className="pub"
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn pub__close" onClick={() => goBack('map')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center={<span className="pub__topTitle">发布内容</span>}
          right={
            <button
              className={`pub__publish ${canPublish ? 'is-on' : ''}`}
              onClick={() => void doPublish()}
              disabled={!canPublish}
              data-publishing={publishing ? '1' : '0'}
            >
              {publishing ? '发布中' : '发布'}
            </button>
          }
        />
      }
      scroll
    >
      <div className="pub__body">
        {/* ① 地点必选（US-02 的第一条验收） */}
        <section className="pub__field" data-pub-place-field>
          <label className="pub__label" htmlFor="pub-place">
            <IconLocation size={15} />
            地点（必选）
          </label>
          {placesPhase === 'loading' && <p className="pub__hint">地点加载中…</p>}
          {placesPhase === 'error' && (
            <div className="pub__hint pub__hint--err" data-pub-places="error">
              <span>地点列表加载失败，无法发布</span>
              <button className="pub__retry" onClick={() => void loadPlaces()}>
                重试
              </button>
            </div>
          )}
          {placesPhase === 'ready' && (
            <>
              <select
                id="pub-place"
                className="pub__select"
                data-pub-place={picked?.id ?? ''}
                value={placeId}
                onChange={(e) => setPlaceId(e.target.value)}
              >
                <option value="">请选择地点</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.category}）
                  </option>
                ))}
              </select>
              {/*
                ⚠️ 明确告诉用户"只能选启用的地点"是**服务端规则**，不是界面随手限制：
                停用地点不在这个列表里，所以选不到（US-01⑤）。
              */}
              <p className="pub__hint">只显示管理员已启用的地点；停用地点不能关联新帖子。</p>
            </>
          )}
        </section>

        {/* ② 正文（纯文字也可以发） */}
        <section className="pub__field">
          <label className="pub__label" htmlFor="pub-text">
            内容
          </label>
          <textarea
            id="pub-text"
            className="pub__textarea"
            data-pub-text
            placeholder="记录这个地点发生的事…（纯文字即可发布）"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="pub__hint">{text.trim().length} 字 · 帖子发布后直接公开，没有人工待审核状态。</p>
        </section>

        {/* ③ 配图（普通图文；≤3 张） */}
        <section className="pub__field">
          <label className="pub__label">
            <IconImage size={15} />
            图片（可选，最多 {MAX_IMAGES} 张）
          </label>
          <div className="pub__thumbs">
            {images.map((src, i) => (
              <span key={i} className="pub__thumb">
                <img className="pub__thumbImg" src={src} alt="" data-pub-draft={String(i)} />
                <button
                  className="pub__thumbRemove"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label="移除这张图片"
                >
                  <IconClose size={12} />
                </button>
              </span>
            ))}
            {images.length < MAX_IMAGES && (
              <button
                className="pub__thumbAdd"
                data-pub-add-image
                onClick={() => void addFromGallery()}
                disabled={busy}
                aria-label="从相册添加图片"
              >
                <IconImage size={20} />
              </button>
            )}
          </div>
          {/*
            已上传图片的预览说明：这里显示的是**本地草稿**（dataURL），
            真正上传发生在点发布时 —— 若上传失败会明确报错且**不创建帖子**。
          */}
          <p className="pub__hint">图片在上传成功前不会创建帖子；上传失败会保留草稿并提示。</p>
        </section>

        {err && (
          <p className="pub__err" data-publish-err>
            {err}
          </p>
        )}

        {/* 未选地点时把"为什么不能发"说清楚，而不是给一个灰按钮让人猜 */}
        {placesPhase === 'ready' && !placeId && (
          <p className="pub__blocked" data-pub-blocked="no-place">
            请先选择地点：TimeMap 的所有内容都必须关联一个预设地点。
          </p>
        )}
        {!text.trim() && (
          <p className="pub__blocked" data-pub-blocked="no-text">
            请输入内容（空白内容不会创建帖子）。
          </p>
        )}
      </div>
    </Screen>
  )
}
