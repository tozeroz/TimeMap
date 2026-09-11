import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconCamera, IconEmoji, IconImage } from '../components/icons'
import { posts } from '../data/mock'
import { goBack, navigate } from '../router'
import './publish.css'

type Mode = '拍摄' | '文字' | '语音'

export function PublishScreen() {
  const [mode, setMode] = useState<Mode>('拍摄')
  const [zoom, setZoom] = useState('1x')
  const [shutterFlash, setShutterFlash] = useState(false)
  const preview = posts[1].images[0]

  function shoot() {
    setShutterFlash(true)
    window.setTimeout(() => setShutterFlash(false), 160)
    window.setTimeout(() => navigate('campus'), 220)
  }

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn pub__close" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center={
            <button className="pub__poi" onClick={() => navigate('poi')}>
              <span className="pub__poi-dot">📍</span>
              <span>北京交通大学</span>
              <IconClose size={12} />
            </button>
          }
        />
      }
      scroll={false}
    >
      <div className="pub">
        {/* 取景器：用本地生成的渐变图模拟相机画面 */}
        <div className="pub__viewfinder">
          <img className="pub__preview" src={preview} alt="" />
          <div className="pub__gridlines" />
          {shutterFlash && <div className="pub__flash" />}

          <div className="pub__zooms">
            {['1x', '2', '5'].map((z) => (
              <button
                key={z}
                className={`pub__zoom ${zoom === z ? 'is-active' : ''}`}
                onClick={() => setZoom(z)}
              >
                {z}
              </button>
            ))}
          </div>
        </div>

        {/* 模式与快门 */}
        <div className="pub__controls">
          <button className="pub__thumb" aria-label="相册">
            <IconImage size={20} />
          </button>

          <div className="pub__modes">
            {(['语音', '拍摄', '文字'] as Mode[]).map((m) => (
              <button
                key={m}
                className={`pub__mode ${mode === m ? 'is-active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <button className="pub__shutter" onClick={shoot} aria-label="快门">
            {mode === '文字' ? <IconEmoji size={24} /> : <IconCamera size={24} />}
          </button>
        </div>
      </div>
    </Screen>
  )
}
