import { useMemo, useRef, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconCamera, IconClose, IconImage, IconLocation } from '../components/icons'
import { useTm, useToast, Toast } from '../components/TmPostCard'
import { CANTEEN_TAGS, EMOTION_TAGS } from '../data/timemap'
import { CATEGORY_COLOR } from '../data/timemap'
import { listPlaces, publish, placePostCount, isPlaceEnabled } from '../data/tmStore'
import { pickPhoto, takePhoto } from '../native/camera'
import { goBack, navigate, useRoute } from '../router'

const MAX_IMAGES = 3
const MAX_TAGS = 2

/**
 * 发布页（F04 / US-02）：
 * - 地点必填，只能选择「启用中」的预设地点（停用地点不能再关联新帖子）
 * - 纯文字或图文（1—3 张）；空白内容不能创建
 * - 情绪/食堂标签，最多 2 个
 * - 连续点击发布不产生重复帖子（submitting 同步置位 + 按钮禁用）
 * - 直接发布，无人工待审核状态；成功后回到地点详情
 */
export function PublishScreen() {
  useTm()
  const route = useRoute()
  const [placeId, setPlaceId] = useState(route.query.place ?? '')
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast, showToast] = useToast()
  const busyRef = useRef(false)

  const place = listPlaces().find((p) => p.id === placeId)
  const isCanteen = place?.category === '食堂'
  const tagPool = isCanteen ? CANTEEN_TAGS : EMOTION_TAGS

  const canPublish = useMemo(
    () => Boolean(placeId) && isPlaceEnabled(placeId) && (text.trim().length > 0 || images.length > 0),
    [placeId, text, images.length],
  )

  async function addImage(kind: 'camera' | 'gallery') {
    // 图片选择失败 / 用户取消：什么都不添加 —— 不会产生「半成品帖子」
    const photo = kind === 'camera' ? await takePhoto() : await pickPhoto()
    if (!photo?.dataUrl) return
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        showToast(`最多 ${MAX_IMAGES} 张图片`)
        return prev
      }
      return [...prev, photo.dataUrl]
    })
  }

  function toggleTag(t: string) {
    setTags((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t)
      if (prev.length >= MAX_TAGS) {
        showToast(`最多选 ${MAX_TAGS} 个标签`)
        return prev
      }
      return [...prev, t]
    })
  }

  function submit() {
    if (busyRef.current || submitting) return // 防连续点击产生重复帖子
    if (!placeId) {
      showToast('请先选择关联地点')
      return
    }
    if (!canPublish) {
      showToast('内容不能为空白')
      return
    }
    busyRef.current = true
    setSubmitting(true)
    try {
      const res = publish({ placeId, text, images, tags })
      if (!res.ok) {
        showToast(res.error ?? '发布失败，内容已保留')
        return
      }
      navigate('place', { id: placeId })
    } finally {
      busyRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Screen
      className="tpub"
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('map')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center="发布记忆"
          right={
            <button
              className={`tpub__submit ${canPublish && !submitting ? 'is-on' : ''}`}
              onClick={submit}
              disabled={!canPublish || submitting}
            >
              {submitting ? '发布中…' : '发布'}
            </button>
          }
        />
      }
      footer={
        <div className="tpub__foot">
          <button className="tpub__footBtn" onClick={() => void addImage('gallery')} aria-label="从相册选图">
            <IconImage size={20} />
            <span>相册</span>
          </button>
          <button className="tpub__footBtn" onClick={() => void addImage('camera')} aria-label="拍一张">
            <IconCamera size={20} />
            <span>拍照</span>
          </button>
          <span className="tpub__footCount">
            {images.length}/{MAX_IMAGES} 张
          </span>
        </div>
      }
    >
      {/* 地点：必填 */}
      <button className="tpub__place" onClick={() => setPickerOpen(true)} data-selected={placeId || undefined}>
        <IconLocation size={16} />
        {place ? (
          <>
            <span className="tpub__placeName">{place.name}</span>
            <span className="tpub__placeCat" style={{ color: CATEGORY_COLOR[place.category] }}>
              {place.category}
            </span>
          </>
        ) : (
          <span className="tpub__placeEmpty">选择关联地点（必选）</span>
        )}
      </button>

      <textarea
        className="tpub__text"
        placeholder="分享这个地点的故事、见闻或提醒…（可只发文字）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
      />

      {/* 图片（1—3 张） */}
      {images.length > 0 && (
        <div className="tpub__imgs">
          {images.map((src, i) => (
            <div key={i} className="tpub__imgItem">
              <img src={src} alt="" />
              <button
                className="tpub__imgRemove"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="移除图片"
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 标签 */}
      <div className="tpub__tagsBlock">
        <p className="tpub__tagsTitle">{isCanteen ? '食堂标签（选填，最多 2 个）' : '情绪标签（选填，最多 2 个）'}</p>
        <div className="tpub__tags">
          {tagPool.map((t) => (
            <button
              key={t}
              className={`tm__chipBtn ${tags.includes(t) ? 'is-active' : ''}`}
              onClick={() => toggleTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <p className="tpub__note">发布后内容直接可见；如遇不当内容，其他同学可举报，由学生管理员处理。</p>

      {/* 地点选择器：只列启用中的地点 */}
      {pickerOpen && (
        <div className="tm__sheetMask" onClick={() => setPickerOpen(false)}>
          <div className="tm__sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="tm__sheetTitle">选择关联地点</h3>
            <p className="tm__sheetDesc">所有帖子必须关联预设地点；已停用的地点不可选。</p>
            <div className="tpub__placeList">
              {listPlaces().map((p) => {
                const enabled = isPlaceEnabled(p.id)
                return (
                  <button
                    key={p.id}
                    className={`tpub__placeItem ${placeId === p.id ? 'is-active' : ''}`}
                    disabled={!enabled}
                    onClick={() => {
                      setPlaceId(p.id)
                      setTags([])
                      setPickerOpen(false)
                    }}
                  >
                    <span className="tpub__placeDot" style={{ background: CATEGORY_COLOR[p.category] }} />
                    <span className="tpub__placeItemName">{p.name}</span>
                    <span className="tpub__placeItemMeta">
                      {enabled ? `${placePostCount(p.id)} 帖` : '已停用'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
      <Toast msg={toast} />
    </Screen>
  )
}
