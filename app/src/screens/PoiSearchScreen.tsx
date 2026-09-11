import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconCheck, IconClose, IconLocation, IconSearch } from '../components/icons'
import { pois } from '../data/mock'
import { goBack, navigate } from '../router'
import './poi.css'

/**
 * 地点选择器（原版 campusx://poi/search）。
 *
 * 原版实测的关键行为：**点列表项不会进新页面，而是「选中」**（画面变化但仍在同一
 * CampusPoiSearchActivity），点右上角「确认」才返回发布页并把地点带回去。
 * 注意「不添加地点」是一个特殊的清除项。
 */
export function PoiSearchScreen() {
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string>(pois[0].name)

  const list = pois.filter((p) =>
    keyword ? p.name.includes(keyword) || p.address.includes(keyword) : true,
  )

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('publish')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          right={
            <button
              className="poi__confirm"
              onClick={() => navigate('publish', { place: selected })}
            >
              确认
            </button>
          }
        />
      }
      scroll
    >
      <div className="poi__search">
        <IconSearch size={18} />
        <input
          className="poi__input"
          placeholder="搜索地点"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="poi__map">
        <div className="poi__map-grid" />
        <div className="poi__pin">
          <IconLocation size={22} />
        </div>
      </div>

      <div className="list">
        {/* 清除选择 */}
        <button
          className={`row poi__row ${selected === '' ? 'is-selected' : ''}`}
          onClick={() => setSelected('')}
        >
          <div className="row__main">
            <div className="row__title">不添加地点</div>
          </div>
          {selected === '' && (
            <span className="poi__check">
              <IconCheck size={16} />
            </span>
          )}
        </button>

        {list.map((p) => (
          <button
            key={p.id}
            className={`row poi__row ${selected === p.name ? 'is-selected' : ''}`}
            onClick={() => setSelected(p.name)}
          >
            <div className="row__main">
              <div className="row__title">{p.name}</div>
              <div className="row__sub">{p.address}</div>
            </div>
            <span className="poi__distance">{p.distance}</span>
            {selected === p.name && (
              <span className="poi__check">
                <IconCheck size={16} />
              </span>
            )}
          </button>
        ))}

        {list.length === 0 && <p className="poi__empty">没有找到「{keyword}」相关的地点</p>}
      </div>
    </Screen>
  )
}
