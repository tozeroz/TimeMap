import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconLocation, IconSearch } from '../components/icons'
import { pois } from '../data/mock'
import { goBack, navigate } from '../router'
import './poi.css'

export function PoiSearchScreen() {
  const [keyword, setKeyword] = useState('')
  const list = pois.filter((p) => (keyword ? p.name.includes(keyword) || p.address.includes(keyword) : true))

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('map')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          right={
            <button className="poi__confirm" onClick={() => navigate('map')}>
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
        <button className="row" onClick={() => navigate('map')}>
          <div className="row__main">
            <div className="row__title">不添加地点</div>
          </div>
        </button>
        {list.map((p) => (
          <button key={p.id} className="row" onClick={() => navigate('map', { poi: p.id })}>
            <div className="row__main">
              <div className="row__title">{p.name}</div>
              <div className="row__sub">{p.address}</div>
            </div>
            <span className="poi__distance">{p.distance}</span>
          </button>
        ))}
      </div>
    </Screen>
  )
}
