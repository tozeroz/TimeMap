import { useState } from 'react'
import { Screen } from '../components/Shell'
import { IconChatBubble, IconChevronDown, IconCompass, IconLocation, IconPlus } from '../components/icons'
import { users } from '../data/mock'
import { navigate } from '../router'
import './map.css'

/** 离线自绘地图：用本地 SVG 还原原 app 的底图观感（不依赖任何在线地图 SDK） */
function MapCanvas({ offset }: { offset: { x: number; y: number } }) {
  return (
    <svg className="map__canvas" viewBox="0 0 1080 1500" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="blocks" width="120" height="120" patternUnits="userSpaceOnUse">
          <rect width="120" height="120" fill="#f2f1ec" />
          <rect x="6" y="6" width="108" height="108" rx="4" fill="#eceae4" />
        </pattern>
      </defs>

      <g transform={`translate(${offset.x} ${offset.y})`}>
        {/* 街区底色 */}
        <rect x="-400" y="-400" width="2000" height="2300" fill="url(#blocks)" />

        {/* 主干道 */}
        <g stroke="#ffffff" strokeLinecap="round" fill="none">
          <path d="M-200 320 H1500" strokeWidth="26" />
          <path d="M-200 760 H1500" strokeWidth="34" />
          <path d="M-200 1160 H1500" strokeWidth="22" />
          <path d="M180 -200 V1700" strokeWidth="30" />
          <path d="M620 -200 V1700" strokeWidth="24" />
          <path d="M880 -200 V1700" strokeWidth="18" />
        </g>
        <g stroke="#e8e4d8" strokeWidth="1" fill="none">
          <path d="M-200 320 H1500" />
          <path d="M-200 760 H1500" />
          <path d="M-200 1160 H1500" />
          <path d="M180 -200 V1700" />
          <path d="M620 -200 V1700" />
        </g>

        {/* 河道 */}
        <path
          d="M-200 1330 C 240 1290, 560 1400, 900 1330 S 1320 1250, 1500 1300"
          stroke="#bcd8ef"
          strokeWidth="42"
          fill="none"
        />

        {/* 绿地 */}
        <rect x="700" y="420" width="300" height="240" rx="14" fill="#d9e9cd" />
        <rect x="60" y="860" width="220" height="180" rx="14" fill="#d9e9cd" />

        {/* 建筑块 */}
        <g fill="#e3e0d6">
          <rect x="240" y="380" width="150" height="110" rx="6" />
          <rect x="420" y="380" width="170" height="110" rx="6" />
          <rect x="240" y="520" width="120" height="90" rx="6" />
          <rect x="660" y="820" width="180" height="130" rx="6" />
          <rect x="240" y="960" width="140" height="120" rx="6" />
          <rect x="700" y="980" width="150" height="110" rx="6" />
        </g>

        {/* 路名 */}
        <g fill="#8b8578" fontSize="26" fontFamily="PingFang SC, sans-serif">
          <text x="240" y="306">西直门外上园村路</text>
          <text x="880" y="746">高粱桥斜街</text>
          <text x="200" y="1146">交大东路</text>
          <text x="196" y="520" transform="rotate(90 196 520)">上园村路</text>
          <text x="636" y="640" transform="rotate(90 636 640)">交大中路</text>
        </g>
        <g fill="#9aa9b8" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="360" y="1322">南长河</text>
        </g>
        <g fill="#7fa06a" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="740" y="560">明湖</text>
          <text x="100" y="960">思源园</text>
        </g>

        {/* 地名 */}
        <g fill="#4a4a4a" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="300" y="700">北京交通大学</text>
          <text x="300" y="732" fontSize="20" fill="#8b8578">西直门外上园村3号</text>
          <text x="700" y="900">逸夫教学楼</text>
          <text x="240" y="1100">学苑公寓</text>
          <text x="760" y="1240">交大嘉园</text>
        </g>

        {/* 用户头像标记 */}
        <g className="map__markers">
          {[
            { u: users.u1, x: 420, y: 640 },
            { u: users.u2, x: 620, y: 520 },
            { u: users.u3, x: 790, y: 720 },
            { u: users.u4, x: 520, y: 900 },
            { u: users.u5, x: 880, y: 520 },
            { u: users.u6, x: 300, y: 1010 },
            { u: users.u7, x: 700, y: 1180 },
            { u: users.u8, x: 950, y: 940 },
          ].map(({ u, x, y }) => (
            <g key={u.id} transform={`translate(${x} ${y})`}>
              <circle r="34" fill="#ffffff" />
              <image href={u.avatar} x="-28" y="-28" width="56" height="56" clipPath="circle(28px)" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  )
}

export function MapScreen() {
  const [offset, setOffset] = useState({ x: 0, y: 25 })
  const [tipOpen, setTipOpen] = useState(true)

  return (
    <Screen
      header={
        <header className="map__head">
          <div className="map__titlewrap">
            <h1 className="map__title">Map</h1>
            <button className="map__region">
              <span>北京市·海淀区</span>
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
      <div className="map">
        <MapCanvas offset={offset} />

        {/* 地图上的动态气泡卡片 */}
        <button className="map__bubble map__bubble--a" onClick={() => navigate('feed', { id: 'p2' })}>
          <span className="map__bubble-line">在东子买了一杯</span>
          <span className="map__bubble-line map__bubble-line--strong">一天好，不开心</span>
        </button>
        <button className="map__bubble map__bubble--b" onClick={() => navigate('feed', { id: 'p7' })}>
          东子买的
        </button>

        {/* 授权弹窗：复刻原 app 首次进入地图时的阻断式弹窗 */}
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

        {/* 定位按钮 */}
        <button className="map__locate" onClick={() => setOffset({ x: 0, y: 25 })} aria-label="回到定位">
          <IconLocation size={20} />
        </button>

        {/* 右侧操作 */}
        <div className="map__tools">
          <button
            className="map__tool"
            onClick={() => setOffset((o) => ({ x: o.x + 90, y: o.y }))}
            aria-label="向东"
          >
            <IconCompass size={20} />
          </button>
          <button
            className="map__tool map__tool--primary"
            onClick={() => navigate('publish')}
            aria-label="发布"
          >
            <IconPlus size={20} />
          </button>
        </div>
      </div>
    </Screen>
  )
}
