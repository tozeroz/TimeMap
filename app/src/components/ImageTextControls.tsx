import { useRef, useState, type PointerEvent } from 'react'
import { Button } from './Button'
import { IMAGE_TEXT_COLORS, type ImageText } from '../native/imageText'

export function ImageTextPreview({ source, caption, disabled, sticker, onChange }: {
  source: string; caption: ImageText; disabled: boolean; sticker: boolean; onChange: (value: ImageText) => void
}) {
  const [aspect, setAspect] = useState(1)
  const drag = useRef<{ pointer: number; x: number; y: number; caption: ImageText; width: number; height: number } | null>(null)
  function start(e: PointerEvent<HTMLButtonElement>) {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, caption, width: rect.width, height: rect.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current
    if (!d || disabled || d.pointer !== e.pointerId) return
    onChange({ ...d.caption, x: Math.max(0, Math.min(0.84, d.caption.x + (e.clientX - d.x) / d.width)), y: Math.max(0, Math.min(0.95, d.caption.y + (e.clientY - d.y) / d.height)) })
  }
  return <div className={`pub__preview ${sticker ? 'pub__preview--sticker' : ''}`}>
    <div className="pub__imageFrame" style={{ width: `min(100%, ${360 * aspect}px)` }}>
      <img src={source} alt={sticker ? '主体贴纸预览' : '原照片预览'} data-pub-draft="0" onLoad={e => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
      {caption.text.trim() && <button type="button" className="pub__textDrag" disabled={disabled} aria-label="拖动图片文字"
        onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
        onKeyDown={e => {
          const offsets: Record<string, [number, number]> = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] }
          const offset = offsets[e.key]
          if (offset) { e.preventDefault(); onChange({ ...caption, x: Math.max(0, Math.min(0.84, caption.x + offset[0])), y: Math.max(0, Math.min(0.95, caption.y + offset[1])) }) }
        }} />}
    </div>
  </div>
}

export function ImageTextControls({ value, disabled, onChange, onDelete }: {
  value: ImageText; disabled: boolean; onChange: (value: ImageText) => void; onDelete: () => void
}) {
  const count = Array.from(value.text).length
  return <div className="pub__textEditor">
    <label className="pub__label" htmlFor="pub-image-text">图片文字</label>
    <textarea id="pub-image-text" value={value.text} disabled={disabled} rows={2} placeholder="最多50字，支持换行" onChange={e => onChange({ ...value, text: e.target.value })} />
    <p className={`pub__hint ${count > 50 ? 'pub__hint--err' : ''}`} role={count > 50 ? 'alert' : undefined}>{count} / 50 字{count > 50 ? '，请缩短后发布' : ''}</p>
    <div className="pub__actions">
      <label>颜色 <select aria-label="图片文字颜色" disabled={disabled} value={value.color} onChange={e => onChange({ ...value, color: e.target.value })}>
        {IMAGE_TEXT_COLORS.map((color, i) => <option key={color} value={color}>{['白色', '黑色', '橙色', '绿色', '粉色'][i]}</option>)}
      </select></label>
      <label>字号 <select aria-label="图片文字字号" disabled={disabled} value={value.size} onChange={e => onChange({ ...value, size: e.target.value as ImageText['size'] })}>
        <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
      </select></label>
      <Button variant="danger" disabled={disabled} onClick={onDelete}>删除图片文字</Button>
    </div>
    <p className="pub__hint">在预览图上拖动可调整文字位置。文字只显示在帖子图片中。</p>
  </div>
}
