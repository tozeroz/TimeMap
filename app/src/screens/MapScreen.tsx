import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronDown,
  IconCompass,
  IconLocation,
  IconPlus,
} from '../components/icons'
import { mapMarkers, posts } from '../data/mock'
import { navigate } from '../router'
import './map.css'

interface ViewState {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.6
const MAX_SCALE = 3

/**
 * 离线自绘地图（原版是腾讯地图 SDK）。
 *
 * 交互对齐原版：
 * - **拖拽平移**（pointer 事件，支持鼠标与触摸）
 * - 双指捏合 / 滚轮 / 双击 缩放
 * - 标记是「图片 + 彩色图钉 + 地点名」的气泡卡片（原版实测样式）
 * - 当前位置蓝点
 */
function MapCanvas({ view, onMarkers }: { view: ViewState; onMarkers?: (el: HTMLDivElement | null) => void }) {
  const inv = 1 / view.scale

  return (
    <div
      className="map__world"
      style={{
        transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
        transformOrigin: '0 0',
      }}
    >
      <svg className="map__canvas" viewBox="0 0 1400 2000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="blocks" width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill="#f2f1ec" />
            <rect x="6" y="6" width="108" height="108" rx="4" fill="#eceae4" />
          </pattern>
        </defs>

        <rect x="-600" y="-600" width="2600" height="3200" fill="url(#blocks)" />

        {/* 主干道 */}
        <g stroke="#ffffff" strokeLinecap="round" fill="none">
          <path d="M-300 420 H1900" strokeWidth="26" />
          <path d="M-300 880 H1900" strokeWidth="34" />
          <path d="M-300 1320 H1900" strokeWidth="22" />
          <path d="M-300 1740 H1900" strokeWidth="20" />
          <path d="M240 -300 V2200" strokeWidth="30" />
          <path d="M700 -300 V2200" strokeWidth="24" />
          <path d="M1120 -300 V2200" strokeWidth="18" />
        </g>
        <g stroke="#e8e4d8" strokeWidth="1" fill="none">
          <path d="M-300 420 H1900" />
          <path d="M-300 880 H1900" />
          <path d="M-300 1320 H1900" />
          <path d="M-300 1740 H1900" />
        </g>

        {/* 河道 / 绿地 */}
        <path d="M-300 1520 C 200 1480, 620 1600, 1000 1520 S 1600 1430, 1900 1480" stroke="#bcd8ef" strokeWidth="44" fill="none" />
        <rect x="820" y="500" width="330" height="260" rx="14" fill="#d9e9cd" />
        <rect x="90" y="960" width="240" height="200" rx="14" fill="#d9e9cd" />

        {/* 建筑块 */}
        <g fill="#e3e0d6">
          <rect x="300" y="480" width="160" height="120" rx="6" />
          <rect x="490" y="480" width="180" height="120" rx="6" />
          <rect x="300" y="630" width="130" height="100" rx="6" />
          <rect x="760" y="940" width="190" height="140" rx="6" />
          <rect x="300" y="1080" width="150" height="130" rx="6" />
          <rect x="800" y="1120" width="160" height="120" rx="6" />
        </g>

        {/* 路名 */}
        <g fill="#8b8578" fontSize="26" fontFamily="PingFang SC, sans-serif">
          <text x="320" y="404">西直门外上园村路</text>
          <text x="980" y="864">高粱桥斜街</text>
          <text x="260" y="1304">交大东路</text>
          <text x="256" y="620" transform="rotate(90 256 620)">上园村路</text>
          <text x="716" y="740" transform="rotate(90 716 740)">交大中路</text>
          <text x="300" y="1724">广源闸路</text>
        </g>
        <g fill="#9aa9b8" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="430" y="1512">南长河</text>
        </g>
        <g fill="#7fa06a" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="860" y="650">明湖</text>
          <text x="130" y="1060">思源园</text>
        </g>

        {/* 地名 */}
        <g fill="#4a4a4a" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="360" y="800">北京交通大学</text>
          <text x="360" y="832" fontSize="20" fill="#8b8578">西直门外上园村3号</text>
          <text x="800" y="1020">逸夫教学楼</text>
          <text x="300" y="1220">学苑公寓</text>
          <text x="860" y="1360">交大嘉园</text>
          <text x="1150" y="1120">思源楼</text>
          <text x="520" y="1660">教育超市</text>
        </g>

        {/* 当前位置：蓝点 + 方向扇形 */}
        <g transform="translate(700 1080)">
          <path d="M0 0 L-120 -230 A260 260 0 0 1 120 -230 Z" fill="#4a8cf7" fillOpacity="0.18" />
          <circle r="22" fill="#4a8cf7" fillOpacity="0.25" />
          <circle r="11" fill="#2f6fe0" stroke="#ffffff" strokeWidth="3" />
        </g>
      </svg>

      {/* 标记层：照片卡片 + 彩色图钉（原版实测样式），跟随地图平移缩放但标记本身不缩放 */}
      <div className="map__markers" ref={onMarkers}>
        {mapMarkers.map((m) => {
          const post = posts.find((p) => p.id === m.postId)
          const cover = post?.images[0]
          return (
            <div
              key={m.id}
              className="map__marker"
              style={{
                left: m.x,
                top: m.y,
                transform: `translate(-50%, -100%) scale(${inv})`,
                transformOrigin: '50% 100%',
              }}
            >
              <button className="map__markerCard" onClick={() => navigate('feed', { id: m.postId })}>
                {cover ? (
                  <img className="map__markerImg" src={cover} alt="" />
                ) : (
                  <span className="map__markerImg map__markerImg--text">{post?.text.slice(0, 18)}</span>
                )}
                <span className="map__markerName">{m.place}</span>
              </button>
              <span className="map__pin" style={{ color: m.color }} aria-hidden>
                <svg width="20" height="26" viewBox="0 0 20 26">
                  <path d="M10 25.5S19 15.6 19 9.6A9 9 0 0 0 1 9.6c0 6 9 15.9 9 15.9Z" fill="currentColor" />
                  <circle cx="10" cy="9.6" r="3.4" fill="#fff" />
                </svg>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function MapScreen() {
  const [view, setView] = useState<ViewState>({ x: -260, y: -700, scale: 1 })
  const [tipOpen, setTipOpen] = useState(true)
  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const pinch = useRef<{ distance: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && e.isPrimary === false) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y }
  }, [view.x, view.y])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setView((v) => ({ ...v, x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    // 双击缩放
    const now = Date.now()
    const moved = Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY)
    if (moved < 6) {
      if (now - lastTap.current < 300) {
        setView((v) => ({ ...v, scale: clampScale(v.scale >= 2 ? 1 : v.scale * 1.6) }))
        lastTap.current = 0
        return
      }
      lastTap.current = now
    }
  }, [])

  // 双指捏合（触摸设备）
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) return
    const [a, b] = [e.touches[0], e.touches[1]]
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (pinch.current === null) {
      pinch.current = { distance, scale: view.scale }
      return
    }
    const ratio = distance / pinch.current.distance
    setView((v) => ({ ...v, scale: clampScale(pinch.current!.scale * ratio) }))
  }, [view.scale])

  const onTouchEnd = useCallback(() => {
    pinch.current = null
  }, [])

  // 桌面滚轮缩放（浏览器预览用）
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => ({ ...v, scale: clampScale(v.scale * (e.deltaY > 0 ? 0.9 : 1.1)) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number) => setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }))

  return (
    <Screen
      header={
        <header className="map__head">
          <div className="map__titlewrap">
            <h1 className="map__title">Map</h1>
            <button className="map__region" onClick={() => navigate('poi')}>
              <span>北京交通大学（校本部）</span>
              <IconChevronDown size={13} />
            </button>
          </div>
          <button className="iconbtn map__msg" onClick={() => navigate('message')} aria-label="消息">
            <IconChatBubble size={22} />
          </button>
        </header>
      }
      scroll={false}
    >
      <div
        className="map"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <MapCanvas view={view} />

        {/* 右侧控件：定位 + 指南针（对齐原版右下角控件），缩放走双指/双击，与地图 App 一致 */}
        <div className="map__controls">
          <button
            className="map__ctrl"
            onClick={() => setView({ x: -260, y: -700, scale: 1 })}
            aria-label="回到定位"
          >
            <IconLocation size={20} />
          </button>
          <button className="map__ctrl" onClick={() => zoomBy(1.25)} aria-label="指北">
            <IconCompass size={20} />
          </button>
        </div>

        {/* 右下角发布 */}
        <button className="map__fab" onClick={() => navigate('publish')} aria-label="发布">
          <IconPlus size={22} />
        </button>

        {/* 授权弹窗（原版首次进入地图的阻断式弹窗） */}
        {tipOpen && (
          <div className="map__modal-wrap">
            <div className="map__modal">
              <h3 className="map__modal-title">授权地理位置</h3>
              <p className="map__modal-desc">在地图上，标记属于你的校园生活</p>
              <div className="map__modal-actions">
                <button className="map__modal-btn" onClick={() => setTipOpen(false)}>
                  暂时不要
                </button>
                <button
                  className="map__modal-btn map__modal-btn--primary"
                  onClick={() => setTipOpen(false)}
                >
                  授权
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Screen>
  )
}
