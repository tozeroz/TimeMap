import { useCallback, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconCamera, IconClose, IconEmoji, IconImage, IconLocation } from '../components/icons'
import { posts } from '../data/mock'
import { addMyPost } from '../data/store'
import { ensureCameraPermission, isNative, pickPhoto, takePhoto } from '../native/camera'
import { goBack, navigate, useRoute } from '../router'
import './publish.css'

type Mode = '语音' | '拍摄' | '文字'

const FONTS = ['经典', '黑体', '宋体', '手写体'] as const

/**
 * 发布页（原版点右下角「+」进入）。三模式合成器：
 * - 拍摄：**调用真实摄像头**（Capacitor Camera），拍下即加入草稿
 * - 文字：图文编辑器，「说点什么...」+ 从**真实相册**选图 + 字体选择
 * - 语音：录音波形（占位，未接真实录音）
 *
 * 点「发布」会把草稿写进本地帖子库（localStorage 持久化），
 * 返回校园页后能在信息流最前面看到自己发的帖子。
 */
export function PublishScreen() {
  const route = useRoute()
  const [mode, setMode] = useState<Mode>('拍摄')
  const [zoom, setZoom] = useState('1x')
  const [text, setText] = useState('')
  const [font, setFont] = useState<(typeof FONTS)[number]>('经典')
  const [place, setPlace] = useState(route.query.place ?? '北京交通大学')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const preview = posts[1].images[0]

  const shoot = useCallback(async () => {
    setBusy(true)
    try {
      const ok = await ensureCameraPermission()
      if (!ok) return
      const photo = await takePhoto()
      if (photo) {
        setImages((prev) => [photo.dataUrl, ...prev])
        setFlash(true)
        window.setTimeout(() => setFlash(false), 160)
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const addFromGallery = useCallback(async () => {
    setBusy(true)
    try {
      const photo = await pickPhoto()
      if (photo) setImages((prev) => [...prev, photo.dataUrl])
    } finally {
      setBusy(false)
    }
  }, [])

  function publish() {
    if (!text.trim() && images.length === 0) return
    addMyPost({ text, images, place })
    navigate('campus')
  }

  const canPublish = text.trim().length > 0 || images.length > 0

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
            <span className="pub__poiWrap">
              <button className="pub__poi" onClick={() => navigate('poi')}>
                <IconLocation size={13} />
                <span>{place || '添加地点'}</span>
              </button>
              {place && (
                <button className="pub__poiClear" onClick={() => setPlace('')} aria-label="移除地点">
                  <IconClose size={12} />
                </button>
              )}
            </span>
          }
          right={
            <button
              className={`pub__publish ${canPublish ? 'is-on' : ''}`}
              onClick={publish}
              disabled={!canPublish}
            >
              发布
            </button>
          }
        />
      }
      scroll={false}
    >
      <div className="pub__body">
        {mode === '拍摄' && (
          <div className="pub__viewfinder">
            {images.length > 0 ? (
              <img className="pub__preview" src={images[0]} alt="" />
            ) : (
              <img className="pub__preview" src={preview} alt="" />
            )}
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
            {!isNative() && <p className="pub__nativeHint">浏览器预览：点击快门会打开文件选择</p>}
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
              {images.map((src, i) => (
                <img key={i} className="pub__thumbImg" src={src} alt="" />
              ))}
              <button className="pub__thumbAdd" onClick={addFromGallery} aria-label="添加图片">
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
            <p className="pub__voiceTip">（录音功能尚未接入真实麦克风）</p>
          </div>
        )}
      </div>

      <div className="pub__controls">
        <button className="pub__thumb" onClick={addFromGallery} aria-label="相册" disabled={busy}>
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
          <button className="pub__send" onClick={publish} disabled={!canPublish}>
            发布
          </button>
        ) : (
          <button className="pub__shutter" onClick={shoot} disabled={busy} aria-label="快门">
            <IconCamera size={24} />
          </button>
        )}
      </div>

      {images.length > 0 && (
        <div className="pub__draftBar no-scrollbar">
          {images.map((src, i) => (
            <div key={i} className="pub__draftItem">
              <img src={src} alt="" />
              <button
                className="pub__draftRemove"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="移除"
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
          <span className="pub__draftCount">已拍 {images.length} 张</span>
        </div>
      )}
    </Screen>
  )
}
