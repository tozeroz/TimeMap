import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { PublishIcon } from './PublishArtwork'
import { IMAGE_TEXT_COLORS, clampTextScale, drawImageText, layoutImageText, type ImageText } from '../native/imageText'

export function ImageTextPreview({ source, caption, editing, disabled, sticker, onChange }: {
  source: string; caption: ImageText; editing: boolean; disabled: boolean; sticker: boolean; onChange: (value: ImageText) => void
}) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; mode: 'move' | 'scale' | 'rotate'; x: number; y: number; caption: ImageText; width: number; height: number; centerX: number; centerY: number; angle: number; distance: number } | null>(null)
  const layout = useMemo(() => {
    if (!dimensions.width || !caption.text.trim() || Array.from(caption.text).length > 50) return null
    const ctx = document.createElement('canvas').getContext('2d')
    return ctx ? layoutImageText(ctx, caption, dimensions.width, dimensions.height) : null
  }, [caption, dimensions])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dimensions.width) return
    canvas.width = dimensions.width; canvas.height = dimensions.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!caption.text.trim() || Array.from(caption.text).length > 50) { return }
    drawImageText(ctx, caption, dimensions.width, dimensions.height)
  }, [caption, dimensions])
  function start(e: PointerEvent<HTMLButtonElement>, mode: 'move' | 'scale' | 'rotate') {
    if (disabled || !layout) return
    e.preventDefault()
    const rect = frameRef.current!.getBoundingClientRect()
    const centerX = rect.left + (layout.x + layout.width / 2) / dimensions.width * rect.width
    const centerY = rect.top + (layout.y + layout.height / 2) / dimensions.height * rect.height
    drag.current = { pointer: e.pointerId, mode, x: e.clientX, y: e.clientY,
      caption: { ...caption, x: layout.x / dimensions.width, y: layout.y / dimensions.height },
      width: rect.width, height: rect.height, centerX, centerY,
      angle: Math.atan2(e.clientY - centerY, e.clientX - centerX), distance: Math.max(1, Math.hypot(e.clientX - centerX, e.clientY - centerY)) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current
    if (!d || disabled || d.pointer !== e.pointerId) return
    if (d.mode === 'move') onChange({ ...d.caption, x: Math.max(0, Math.min(1, d.caption.x + (e.clientX - d.x) / d.width)), y: Math.max(0, Math.min(1, d.caption.y + (e.clientY - d.y) / d.height)) })
    if (d.mode === 'scale') onChange({ ...d.caption, scale: clampTextScale((d.caption.scale ?? 1) * Math.hypot(e.clientX - d.centerX, e.clientY - d.centerY) / d.distance) })
    if (d.mode === 'rotate') {
      const delta = Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX) - d.angle
      onChange({ ...d.caption, rotation: ((d.caption.rotation ?? 0) + delta * 180 / Math.PI + 540) % 360 - 180 })
    }
  }
  const events = { onPointerMove: move, onPointerUp: () => { drag.current = null }, onPointerCancel: () => { drag.current = null } }
  return <div className={`pub__preview ${sticker ? 'pub__preview--sticker' : ''}`}>
    <div ref={frameRef} className="pub__imageFrame" style={dimensions.width ? { width: `min(100%, ${480 * dimensions.width / dimensions.height}px)` } : undefined}>
      <img src={source} alt={sticker ? '主体贴纸预览' : '原照片预览'} data-pub-draft="0" onLoad={e => setDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
      <canvas ref={canvasRef} className="pub__captionCanvas" aria-hidden="true" />
      {editing && layout && <div className="pub__selection" style={{ left: `${layout.x / dimensions.width * 100}%`, top: `${layout.y / dimensions.height * 100}%`, width: `${layout.width / dimensions.width * 100}%`, height: `${layout.height / dimensions.height * 100}%`, transform: `rotate(${caption.rotation ?? 0}deg)` }}>
        <button type="button" className="pub__textDrag" disabled={disabled} aria-label="拖动图片文字" onPointerDown={e => start(e, 'move')} {...events}
          onKeyDown={e => {
            const offsets: Record<string, [number, number]> = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] }
            const offset = offsets[e.key]
            if (offset) { e.preventDefault(); onChange({ ...caption, x: Math.max(0, Math.min(1, caption.x + offset[0])), y: Math.max(0, Math.min(1, caption.y + offset[1])) }) }
          }} />
        {['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} type="button" className={`pub__scaleHandle pub__scaleHandle--${corner}`} disabled={disabled} aria-label={`缩放图片文字 ${corner}`} onPointerDown={e => start(e, 'scale')} {...events} onKeyDown={e => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange({ ...caption, scale: clampTextScale((caption.scale ?? 1) + (e.key === 'ArrowUp' ? 0.1 : -0.1)) }) }
        }} />)}
        <button type="button" className="pub__rotateHandle" disabled={disabled} aria-label="旋转图片文字" onPointerDown={e => start(e, 'rotate')} {...events} onKeyDown={e => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChange({ ...caption, rotation: ((caption.rotation ?? 0) + (e.key === 'ArrowRight' ? 5 : -5) + 540) % 360 - 180 }) }
        }}><PublishIcon name="rotate" size={18} /></button>
      </div>}
    </div>
  </div>
}

export function ImageTextControls({ value, disabled, onChange, onDelete, onDone }: {
  value: ImageText; disabled: boolean; onChange: (value: ImageText) => void; onDelete: () => void; onDone: () => void
}) {
  const count = Array.from(value.text).length
  return <div id="pub-image-editor" className="pub__editorGroup">
    <div className="pub__textEditor">
      <div className="pub__editorInputRow">
        <div className="pub__editorInput"><label className="ui-sr-only" htmlFor="pub-image-text">图片文字</label>
          <textarea id="pub-image-text" value={value.text} disabled={disabled} rows={1} placeholder="写一句想留在照片上的话…" aria-describedby="pub-image-count" aria-invalid={count > 50 || undefined} onChange={e => onChange({ ...value, text: e.target.value })} />
          <button type="button" className="pub__clearText" disabled={disabled || !value.text} aria-label="清空图片文字" onClick={onDelete}>×</button>
        </div>
        <button type="button" className="pub__editorDone" disabled={disabled || count > 50} onClick={onDone}><PublishIcon name="check" /><span>完成</span></button>
      </div>
      <div className="pub__editorOptions">
        <div className="pub__textStyles" role="group" aria-label="文字样式">
          {(['simple', 'handwritten', 'outline'] as const).map((style, index) => <button type="button" key={style} disabled={disabled} aria-pressed={(value.style ?? 'simple') === style} onClick={() => onChange({ ...value, style })}>{['简约', '手写', '描边'][index]}</button>)}
        </div>
        <div className="pub__textColors" role="group" aria-label="文字颜色">
          {IMAGE_TEXT_COLORS.slice(0, 4).map((color, i) => <button type="button" key={color} className="pub__color" style={{ '--swatch': color } as import('react').CSSProperties} aria-label={['白色', '黑色', '珊瑚橙', '鼠尾草绿'][i]} aria-pressed={value.color === color} disabled={disabled} onClick={() => onChange({ ...value, color })} />)}
        </div>
      </div>
      <div className="pub__editorAdjustments"><label>大小 <input type="range" aria-label="图片文字大小" min="0.5" max="2" step="0.05" value={value.scale ?? 1} disabled={disabled} onChange={e => onChange({ ...value, scale: Number(e.target.value) })} /></label><label>旋转 <input type="range" aria-label="图片文字角度" min="-180" max="180" step="1" value={value.rotation ?? 0} disabled={disabled} onChange={e => onChange({ ...value, rotation: Number(e.target.value) })} /></label></div>
    </div>
    <p id="pub-image-count" className={`pub__hint ${count > 50 ? 'pub__hint--err' : ''}`} role={count > 50 ? 'alert' : undefined}>文字可以拖动、缩放和旋转。<span>{count} / 50</span></p>
  </div>
}
