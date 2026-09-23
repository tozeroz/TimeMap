import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronRight, IconEdit } from '../components/icons'
import { PostCard, useTm, useToast, Toast } from '../components/TmPostCard'
import {
  ACTIVITY_STATUS_LABEL,
  CANTEEN_TAGS,
  CATEGORY_COLOR,
  EMOTION_TAGS,
  activityStatus,
  formatRange,
} from '../data/timemap'
import { activitiesForPlace, getPlace, isPlaceDisabled, postsForPlace, type SortMode } from '../data/tmStore'
import { goBack, navigate } from '../router'

/**
 * 地点详情（F03 / US-01 / US-03）：
 * - 基础资料（简介 + 分类）+ 校史与老照片（年代 + 来源，年代不明如实标注）
 * - [在这里发布]：停用地点不可再关联新帖子
 * - 近期活动卡片 → 活动详情 → 可回到地图上的举办地点（US-04）
 * - 帖子区：最新 / 近期热门（冻结热度公式）+ 食堂标签筛选
 * - 没有帖子时仍显示基础资料和发布入口
 */
export function PlaceDetailScreen({ id }: { id: string }) {
  useTm()
  const place = getPlace(id)
  const [sort, setSort] = useState<SortMode>('latest')
  const [tag, setTag] = useState<string | null>(null)
  const [toast, showToast] = useToast()

  if (!place) {
    return (
      <Screen
        header={
          <TopBar
            left={
              <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回">
                <IconBack size={22} />
              </button>
            }
            center="地点"
          />
        }
      >
        <div className="tm__statusPage">
          <h2>地点不存在</h2>
          <p>这个地点可能已被移除。</p>
          <button className="tm__btnPrimary" onClick={() => navigate('map')}>
            返回地图
          </button>
        </div>
        <Toast msg={toast} />
      </Screen>
    )
  }

  const disabled = isPlaceDisabled(place.id)
  const posts = postsForPlace(place.id, sort, tag ?? undefined)
  const acts = activitiesForPlace(place.id)
  const cover = place.photos[0]?.image
  const isCanteen = place.category === '食堂'

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回地图">
              <IconBack size={22} />
            </button>
          }
          center={place.name}
          right={
            <button
              className="iconbtn"
              aria-label="在这里发布"
              onClick={() => {
                if (disabled) {
                  showToast('该地点已停用，不能再关联新帖子')
                  return
                }
                navigate('publish', { place: place.id })
              }}
            >
              <IconEdit size={19} />
            </button>
          }
        />
      }
      footer={
        <div className="tm__placeFoot">
          <button
            className="tm__btnPrimary tm__btnPrimary--block"
            disabled={disabled}
            onClick={() => navigate('publish', { place: place.id })}
          >
            {disabled ? '该地点已停用，不能发布' : '在这里发布'}
          </button>
        </div>
      }
    >
      {/* 封面 + 基础资料 */}
      <section className="pd__hero">
        {cover && <img className="pd__heroImg" src={cover} alt="" />}
        <div className="pd__heroInfo">
          <div className="pd__titleRow">
            <h2 className="pd__name">{place.name}</h2>
            <span className="pd__cat" style={{ color: CATEGORY_COLOR[place.category], borderColor: CATEGORY_COLOR[place.category] }}>
              {place.category}
            </span>
            {disabled && <span className="tm__removedBadge">已停用</span>}
          </div>
          <p className="pd__intro">{place.intro}</p>
        </div>
      </section>

      {/* 校史与老照片（US-01：年代 + 来源，年代不明如实说明） */}
      <section className="pd__section">
        <h3 className="pd__sectionTitle">校史与老照片</h3>
        <p className="pd__history">{place.history}</p>
        <div className="pd__photos">
          {place.photos.map((ph) => (
            <figure key={ph.id} className="pd__photo">
              <img src={ph.image} alt={ph.caption} />
              <figcaption>
                <span className="pd__photoEra">{ph.era}</span>
                <span className="pd__photoCaption">{ph.caption}</span>
                <span className="pd__photoSource">来源：{ph.source}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 近期活动（地点页活动卡片，US-04） */}
      {acts.length > 0 && (
        <section className="pd__section">
          <h3 className="pd__sectionTitle">近期活动</h3>
          <div className="pd__acts">
            {acts.map((a) => {
              const st = activityStatus(a)
              return (
                <button key={a.id} className="pd__act" onClick={() => navigate('activity', { id: a.id })}>
                  <div className="pd__actMain">
                    <span className="pd__actTitle">{a.title}</span>
                    <span className="pd__actTime">{formatRange(a.startAt, a.endAt)}</span>
                  </div>
                  <span className={`tm__actBadge tm__actBadge--${st}`}>{ACTIVITY_STATUS_LABEL[st]}</span>
                  <IconChevronRight size={15} />
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 帖子区：最新 / 近期热门 + 标签筛选 */}
      <section className="pd__section">
        <div className="pd__filterRow">
          <button className={`pd__sortBtn ${sort === 'latest' ? 'is-active' : ''}`} onClick={() => setSort('latest')}>
            最新
          </button>
          <button className={`pd__sortBtn ${sort === 'hot' ? 'is-active' : ''}`} onClick={() => setSort('hot')}>
            近期热门
          </button>
        </div>

        {(isCanteen || posts.some((p) => p.tags.length > 0)) && (
          <div className="pd__tagRow no-scrollbar">
            <button className={`tm__chipBtn ${tag === null ? 'is-active' : ''}`} onClick={() => setTag(null)}>
              全部
            </button>
            {(isCanteen ? CANTEEN_TAGS : EMOTION_TAGS).map((t) => (
              <button
                key={t}
                className={`tm__chipBtn ${tag === t ? 'is-active' : ''}`}
                onClick={() => setTag(tag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {posts.length === 0 ? (
          <div className="tm__empty">
            <p>{sort === 'hot' ? '近期还没有热门内容' : '还没有内容'}</p>
            <span>点下方「在这里发布」，留下这里的第一段记忆</span>
          </div>
        ) : (
          <div className="pd__posts">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </section>
      <div className="pd__spacer" />
      <Toast msg={toast} />
    </Screen>
  )
}
