import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconCamera, IconClose, IconEmoji, IconImage, IconLocation } from '../components/icons'
import { posts } from '../data/mock'
import { goBack, navigate } from '../router'
import './publish.css'

type Mode = '语音' | '拍摄' | '文字'

const FONTS = ['经典', '黑体', '宋体', '手写体'] as const

/**
 * 发布页（原版点右下角「+」进入）。
 *
 * 原版实测是**三模式合成器**：
 * - 顶部：关闭 + 定位标签（可移除）
 * - 拍摄模式：取景画面 + 变焦 1x/2/5 + 快门
 * - 文字模式：图文编辑器，「说点什么...」输入框 + 字体选择
 * - 语音模式：录音波形
 * - 底部：语音 / 拍摄 / 文字 三个模式切换
 */
export function PublishScreen() {
  const [mode, setMode] = useState<Mode>('拍摄')
  const [zoom, setZoom] = useState('1x')
  const [text, setText] = useState('')
  const [font, setFont] = useState<(typeof FONTS)[number]>('经典')
  const [place, setPlace] = useState('北京交通大学')
  const [flash, setFlash] = useState(false)
  const preview = posts[1].images[0]

  function shoot() {
    setFlash(true)
    window.setTimeout(() => setFlash(false), 160)
    window.setTimeout(() => navigate('campus'), 240)
  }

  return (
    <Screen
      className="pub"
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn pub__close" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center={
            <button className="pub__poi" onClick={() => setPlace('')}>
              <IconLocation size={13} />
              <span>{place || '添加地点'}</span>
              {place && <IconClose size={12} />}
            </button>
          }
        />
      }
      scroll={false}
    >
      <div className="pub__body">
        {mode === '拍摄' && (
          <div className="pub__viewfinder">
            <img className="pub__preview" src={preview} alt="" />
            <div className="pub__gridlines" />
            {flash && <div className="pub__flash" />}
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
        )}

        {mode === '文字' && (
          <div className="pub__editor">
            <textarea
              className="pub__textarea"
              placeholder="说点什么..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="pub__thumbs">
              <img className="pub__thumbImg" src={posts[0].images[0]} alt="" />
              <button className="pub__thumbAdd" aria-label="添加图片">
                <IconImage size={20} />
              </button>
            </div>
            <div className="pub__fonts no-scrollbar">
              {FONTS.map((f) => (
                <button
                  key={f}
                  className={`pub__font ${font === f ? 'is-active' : ''}`}
                  onClick={() => setFont(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === '语音' && (
          <div className="pub__voice">
            <div className="pub__wave" aria-hidden>
              {Array.from({ length: 28 }).map((_, i) => (
                <span key={i} style={{ height: `${12 + ((i * 37) % 46)}px` }} />
              ))}
            </div>
            <p className="pub__voiceTip">按住说话，最长 60 秒</p>
          </div>
        )}
      </div>

      <div className="pub__controls">
        <button className="pub__thumb" aria-label="相册">
          <IconEmoji size={20} />
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

        {mode === '文字' ? (
          <button className="pub__send" onClick={() => navigate('campus')}>
            发布
          </button>
        ) : (
          <button className="pub__shutter" onClick={shoot} aria-label="快门">
            <IconCamera size={24} />
          </button>
        )}
      </div>
    </Screen>
  )
}
