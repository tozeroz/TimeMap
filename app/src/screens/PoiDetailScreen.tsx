import { useEffect, useState } from 'react'
import { getPlace, relativeTime, avatarFor, type ApiPlaceDetail } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconShare } from '../components/icons'
import { goBack, navigate } from '../router'
import './poidetail.css'

/**
 * 地点详情（原版 `com.kairuotu.feed.poi.detail.PoiDetailActivity`）。
 *
 * 1:1 依据 —— **可采信**的只读证据（supplements/poi-detail.json，只读取得，未被政策排除）：
 *   原版控件树（1080×1920）：
 *     id/iv_poi_detail_dynamic_back  [14,88][112,186]      返回（左上）
 *     id/tv_poi_name                 [28,500][978,566]     地点名（大号、加粗、占满宽度）
 *     id/iv_poi_detail_share         [992,500][1059,567]   分享（右上，与地点名同一行）
 *     id/tv_distance                 [28,580][124,637]     「距我4公里」
 *     id/tv_address                  [138,580][1052,637]   完整地址（与距离**同一行**，距离在左）
 *     图片 FrameLayout               [21,689][526,1356]    该地点的动态图片（左侧一张，非通栏）
 *     id/view_user_tag + tv_user_tag_name [21,696][187,721] 图片上的作者标签（「食物语」）
 *
 * 因此本页**没有**中心标题、没有统计（几条动态/几人来过）、没有"在这里发动态"、
 * 没有"最近来过"。此前这些是按想象加的，与证据不符 —— 这次按证据删掉。
 *
 * 已知偏差（如实标注，不假装 1:1）：
 *   「距我 N 公里」需要用户位置。本 demo **不申请设备定位权限**，
 *   改用**校区参考坐标**（见 CAMPUS_REF）计算，属于演示简化。
 *   原版用的是真实定位 —— 这一点在 SLICE4-REPORT 里记为偏差，不算作一致。
 */
const CAMPUS_REF = { lat: 39.9519, lng: 116.3373 } // 北京交通大学（演示用参照点）

/** 球面距离（km），保留一位小数以内的整数公里表达，对齐原版「距我4公里」的写法 */
function distanceKm(lat: number, lng: number): number {
  const R = 6371
  const dLat = ((lat - CAMPUS_REF.lat) * Math.PI) / 180
  const dLng = ((lng - CAMPUS_REF.lng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((CAMPUS_REF.lat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function PoiDetailScreen({ id }: { id: string }) {
  const [place, setPlace] = useState<ApiPlaceDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!id) {
        setErr('未指定地点（缺少 id 参数）')
        setState('error')
        return
      }
      const r = await getPlace(id)
      if (!alive) return
      if (r.ok) {
        setPlace(r.value)
        setState('ready')
      } else {
        setErr(r.status === 404 ? '该地点不存在' : `加载失败：${r.reason}`)
        setState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  const header = (
    <TopBar
      left={
        <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回">
          <IconBack size={22} />
        </button>
      }
      right={
        <button className="iconbtn" aria-label="分享">
          <IconShare size={20} />
        </button>
      }
    />
  )

  if (state === 'loading') {
    return (
      <Screen header={header}>
        <p className="pd__state">加载中…</p>
      </Screen>
    )
  }
  if (state === 'error' || !place) {
    return (
      <Screen header={header}>
        <div className="pd__state">
          <p>网络错误</p>
          <p className="pd__state-sub">{err}</p>
        </div>
      </Screen>
    )
  }

  const hasGeo = place.latitude != null && place.longitude != null
  const km = hasGeo ? Math.round(distanceKm(place.latitude!, place.longitude!)) : null

  return (
    <Screen header={header} scroll>
      {/* 地点名 + 分享同一行；距离 + 地址同一行（距离在左）—— 严格按证据的分区与顺序 */}
      <section className="pd__head">
        <h2 className="pd__name">{place.name}</h2>
        <div className="pd__meta">
          {km != null && <span className="pd__distance">距我{km}公里</span>}
          {place.address && <span className="pd__addr">{place.address}</span>}
        </div>
      </section>

      {/* 该地点的动态：原版是左侧一张图 + 图上的作者标签 */}
      <section className="pd__feed">
        {place.posts.length === 0 && <p className="pd__empty">这里还没有动态</p>}
        {place.posts.map((p) => (
          <button
            key={p.id}
            className="pd__item"
            data-post-id={p.id}
            onClick={() => navigate('feed', { id: p.id })}
          >
            <span className="pd__imgWrap">
              {/* 无图帖：用作者头像色块占位（M4 接入媒体后再换成真实图片） */}
              <img className="pd__img" src={avatarFor(p.author)} alt="" />
              <span className="pd__userTag" data-user-tag={p.author}>
                {p.author}
              </span>
            </span>
            <span className="pd__body">{p.body}</span>
            <span className="pd__time">{relativeTime(p.createdAt)}</span>
          </button>
        ))}
      </section>
    </Screen>
  )
}
