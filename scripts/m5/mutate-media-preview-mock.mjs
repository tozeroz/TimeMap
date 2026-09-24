/**
 * 受控突变：把 `MediaPreviewScreen` **恢复成 Round 319 之前的实现**
 * （mock 数据源 + 跨实体兜底 `?? posts.flatMap(...)`）
 * —— 用来证明媒体预览门禁断言**真的能红**
 *
 * ## 复现的历史代码（逐字）
 * ```
 *   import { posts } from '../data/mock'
 *   const post = posts.find((p) => p.id === postId)
 *   const gallery = (post?.images ?? posts.flatMap((p) => p.images)).filter(Boolean)
 * ```
 *
 * ## 预计打红哪几条
 *   `MEDIA_MISSING_ID_NO_ENTITY_LEAK` —— 不存在的 id 会显示**所有动态的图片**（泄漏）
 *   `MEDIA_EMPTY_POST_SHOWS_EMPTY`    —— 无图片的动态同样触发兜底 ⇒ 不是空态
 *   `MEDIA_STATE_EXPLICIT`            —— 不再有 not_found/error 状态
 *   `MEDIA_NO_MOCK_DATA_SOURCE`       —— 出现 mock 图片
 *   ⭐ 而 `MEDIA_NAV_PRESENT_WHEN_IMAGES` **预计仍 PASS**
 *      —— 假数据下"有图片"照样成立（甚至上一张/下一张也在）⇒ **归因清晰**
 *         （这条本来就只判"有图时导航在不在"，不判图是真是假）
 *
 * ⚠️ 注入后**必须通过 tsc**（否则验的是"构建会不会崩"而非"断言能不能红"）。
 *
 * 用法：node scripts/m5/mutate-media-preview-mock.mjs inject|restore
 *       MUT_TARGET="app/src/screens/MediaPreviewScreen.tsx"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\screens\\MediaPreviewScreen.tsx'
const BACKUP = 'G:\\demo map\\tools\\tmp\\MediaPreviewScreen.tsx.origmedia.txt'
const mode = process.argv[2]

function norm(text) {
  const crlf = text.includes('\r\n')
  return [crlf ? text.replace(/\r\n/g, '\n') : text, crlf ? '\r\n' : '\n']
}
function denorm(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

/** 历史实现（恢复到改前那一版：mock + 跨实体兜底；其余 UI 不变） */
const LEGACY = `import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconMore } from '../components/icons'
import { posts } from '../data/mock'
import { goBack } from '../router'
import './media.css'

/* [突变] 复现历史形态：mock 数据源 + 跨实体兜底（取不到就显示**所有动态**的图片） */
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
              <span key={String(src) + '-' + i} className={'media__dot ' + (i === index ? 'is-active' : '')} />
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
`

if (mode === 'inject') {
  try {
    if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)
    const [, eol] = norm(readFileSync(FILE, 'utf8'))
    writeFileSync(FILE, denorm(LEGACY, eol), 'utf8')
    console.log('  已注入突变：MediaPreviewScreen 退回 mock 数据源 + 跨实体兜底')
  } catch (err) {
    console.error('FAIL ' + String(err && err.message))
    if (existsSync(BACKUP)) {
      writeFileSync(FILE, readFileSync(BACKUP, 'utf8'), 'utf8')
      rmSync(BACKUP, { force: true })
      console.error('  （回滚）已还原 MediaPreviewScreen.tsx')
    }
    process.exit(1)
  }
} else if (mode === 'restore') {
  if (!existsSync(BACKUP)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
  writeFileSync(FILE, readFileSync(BACKUP, 'utf8'), 'utf8')
  rmSync(BACKUP, { force: true })
  console.log('  已还原 MediaPreviewScreen.tsx')
} else {
  console.error('用法：node mutate-media-preview-mock.mjs inject|restore')
  process.exit(2)
}
