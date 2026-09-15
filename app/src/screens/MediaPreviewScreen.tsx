import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconMore } from '../components/icons'
import { posts } from '../data/mock'
import { goBack } from '../router'
import './media.css'

/**
 * 图片预览（对应原版 campusx://chat/media-preview）。
 * 全屏浏览 + 点按隐藏/显示控件 + 上一张/下一张。
 */
export function MediaPreviewScreen({ postId, startIndex }: { postId?: string; startIndex?: number }) {
  const post = posts.find((p) => p.id === postId)
  const gallery = (post?.images ?? posts.flatMap((p) => p.images)).filter(Boolean)
  const safeStart = Math.min(Math.max(0, startIndex ?? 0), Math.max(0, gallery.length - 1))
  const [index, setIndex] = useState(safeStart)
  const [chrome, setChrome] = useState(true)

  if (gallery.length === 0) {
    return (
      <Screen className="media" scroll={false}>
        <div className="media__stage">
          <p className="media__counter">没有可预览的图片</p>
        </div>
      </Screen>
    )
  }

  return (
    <Screen className="media" scroll={false}>
      <div className="media__stage" onClick={() => setChrome((v) => !v)}>
        <img className="media__image" src={gallery[index]} alt="" />
      </div>

      {chrome && (
        <>
          <TopBar
            variant="plain"
            left={
              <button className="iconbtn media__btn" onClick={() => goBack('campus')} aria-label="关闭">
                <IconClose size={22} />
              </button>
            }
            right={
              <button className="iconbtn media__btn" aria-label="更多">
                <IconMore size={20} />
              </button>
            }
          />
          <div className="media__dots">
            {gallery.map((src, i) => (
              <span key={`${src}-${i}`} className={`media__dot ${i === index ? 'is-active' : ''}`} />
            ))}
          </div>
        </>
      )}

      <div className="media__nav">
        <button
          className="media__navbtn"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          上一张
        </button>
        <span className="media__counter">
          {index + 1} / {gallery.length}
        </span>
        <button
          className="media__navbtn"
          disabled={index >= gallery.length - 1}
          onClick={() => setIndex((i) => Math.min(gallery.length - 1, i + 1))}
        >
          下一张
        </button>
      </div>
    </Screen>
  )
}
