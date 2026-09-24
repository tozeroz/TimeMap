import { useEffect, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconMore } from '../components/icons'
import { getPost, mediaUrl } from '../api/client'
import { goBack } from '../router'
import './media.css'

/**
 * 图片预览（对应原版 `campusx://chat/media-preview`）。
 * 全屏浏览 + 点按隐藏/显示控件 + 上一张/下一张。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ Round 319（最终 audit 的第 ①② 问）：本屏原来**同时**有两处缺陷
 * ════════════════════════════════════════════════════════════════════
 * ```
 * 改前：
 *   import { posts } from '../data/mock'                                   ← ① mock 数据源
 *   const post = posts.find((p) => p.id === postId)
 *   const gallery = (post?.images ?? posts.flatMap((p) => p.images))        ← ② **跨实体兜底**
 *                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                   取不到目标动态时，**静默回落到"所有动态的图片"** ——
 *                   与 WO#17 修掉的 `?? posts[0]` 是**同一类**（identity 泄漏）：
 *                   请求 A 的预览，看到的却是别人（甚至所有人）的图片。
 * ```
 * ⇒ 现在：**只**用 `getPost(postId)` 的权威图片（服务端 `/api/posts/:id` 返回 `images`），
 *   **不再有任何跨实体兜底**；拿不到就**如实**给不可用态。
 *
 * ⚠️ 术语与边界（如实标注，避免夸大）：
 *   · 我们的图片来自**帖子的公开图片**（`ApiMediaRef` + `mediaUrl(id)`）。
 *     而原版这个路由是 `campusx://chat/media-preview`（**聊天**里的图片预览）——
 *     ⚠️ 写这句时我踩过一次坑：原本在 "chat" 两侧加了粗体标记（两个星号），
 *        结果那两个星号与紧随的斜杠构成了 **星号 + 斜杠** 序列 ⇒ **提前结束块注释**
 *        ⇒ 整段注释被当成代码。本项目已多次踩过"注释里的星号斜杠序列"，这是同一类。
 *        （所以这段说明里**刻意不再写出那个两字符序列**。）
 *     其真实入口是**聊天消息里的图片**，而我们在原版侧**无聊天图片数据**，
 *     造该数据必须发消息/发图 = **写操作** ⇒ `MEDIA_PREVIEW_ORIGINAL_ENTRY: BLOCKED_BY_POLICY`、
 *     `MEDIA_PREVIEW_ORIGINAL_PRESENTATION: NOT_EVALUATED`（见 A3A4 文档）。
 *   · 所以本屏现在做的是"**帖**图预览"，不是"原版聊天图预览的 1:1 复现"。
 *     这一点**不**因本次修改而改变 —— 修改只是**去掉假数据与跨实体泄漏**。
 */
export function MediaPreviewScreen({ postId, startIndex }: { postId?: string; startIndex?: number }) {
  const [gallery, setGallery] = useState<string[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [errorText, setErrorText] = useState('')
  const [index, setIndex] = useState(0)
  const [chrome, setChrome] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!postId) {
        if (alive) {
          setGallery([])
          setErrorText('未指定动态（缺少 id 参数）')
          setState('error')
        }
        return
      }
      setState('loading')
      const r = await getPost(postId)
      if (!alive) return
      if (!r.ok) {
        /* ⭐ 不回落、不显示任何别的动态的图片 —— 这正是被修的缺陷 */
        setGallery([])
        setErrorText(r.reason)
        setState(r.status === 404 ? 'not_found' : 'error')
        return
      }
      /* 权威图片：只来自这条动态自己 */
      const imgs = (r.value.images ?? []).map((m) => mediaUrl(m.id))
      setGallery(imgs)
      const start = Math.min(Math.max(0, startIndex ?? 0), Math.max(0, imgs.length - 1))
      setIndex(start)
      setState('ready')
    })()
    return () => {
      alive = false
    }
  }, [postId, startIndex])

  if (state === 'loading') {
    return (
      <Screen className="media" scroll={false}>
        <div className="media__stage">
          <p className="media__counter">加载中…</p>
        </div>
      </Screen>
    )
  }

  if (state === 'not_found' || state === 'error') {
    return (
      <Screen className="media" scroll={false}>
        <div className="media__stage" data-media-state={state}>
          <p className="media__counter">
            {state === 'not_found' ? '这条动态不存在（可能已被删除）' : `加载失败：${errorText}`}
          </p>
        </div>
      </Screen>
    )
  }

  /* 「成功但没有图片」= 明确空态（与"失败"严格区分） */
  if (gallery.length === 0) {
    return (
      <Screen className="media" scroll={false}>
        <div className="media__stage" data-media-state="empty">
          <p className="media__counter">没有可预览的图片</p>
        </div>
      </Screen>
    )
  }

  return (
    <Screen className="media" scroll={false}>
      <div className="media__stage" onClick={() => setChrome((v) => !v)}>
        <img className="media__image" src={gallery[index]} alt="" />
      </div>

      {chrome && (
        <>
          <TopBar
            variant="plain"
            left={
              <button className="iconbtn media__btn" onClick={() => goBack('campus')} aria-label="关闭">
                <IconClose size={22} />
              </button>
            }
            right={
              <button className="iconbtn media__btn" aria-label="更多">
                <IconMore size={20} />
              </button>
            }
          />
          <div className="media__dots">
            {gallery.map((src, i) => (
              <span key={`${src}-${i}`} className={`media__dot ${i === index ? 'is-active' : ''}`} />
            ))}
          </div>
        </>
      )}

      <div className="media__nav">
        <button
          className="media__navbtn"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          上一张
        </button>
        <span className="media__counter">
          {index + 1} / {gallery.length}
        </span>
        <button
          className="media__navbtn"
          disabled={index >= gallery.length - 1}
          onClick={() => setIndex((i) => Math.min(gallery.length - 1, i + 1))}
        >
          下一张
        </button>
      </div>
    </Screen>
  )
}
