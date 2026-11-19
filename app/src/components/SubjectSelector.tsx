import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { boxInside, imagePoint, selectionFromDrag, type CutoutBox } from '../../../shared/cutout'
import { Button } from './Button'
import './subjectselector.css'

export function SubjectSelector({ source, initialBox, onCancel, onConfirm }: {
  source: string; initialBox?: CutoutBox; onCancel: () => void; onConfirm: (box: CutoutBox) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ id: number; start: [number, number] } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [box, setBox] = useState<CutoutBox>([[0, 0], [0, 0]])
  const [error, setError] = useState('')
  const valid = Boolean(size.width && boxInside(box, size.width, size.height))
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { previous?.focus() }
  }, [])
  function point(event: PointerEvent): [number, number] {
    return imagePoint(event.clientX, event.clientY, image.current!.getBoundingClientRect(), size.width, size.height)
  }
  function reset(width = size.width, height = size.height) {
    setBox([[Math.round(width * .2), Math.round(height * .2)], [Math.round(width * .8), Math.round(height * .8)]])
  }
  return <dialog ref={dialog} className="subject-select" aria-labelledby="subject-title"
    onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="subject-title">框选抠图主体</h2>
    <p id="subject-help">在原图上拖出方框，完整框住想保留的主体。可以重新拖框，边缘留一点空隙。</p>
    <div className="subject-select__stage" role="group" aria-label="主体框选区域" aria-describedby="subject-help"
      style={{ width: size.width ? `min(100%, ${42 * size.width / size.height}dvh)` : '100%' }}
      onPointerDown={event => {
        if (!size.width || !event.isPrimary || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, start: point(event) }
        setBox(selectionFromDrag(drag.current.start, drag.current.start))
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) setBox(selectionFromDrag(drag.current.start, point(event)))
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return
        setBox(selectionFromDrag(drag.current.start, point(event)))
        drag.current = null
      }}
      onPointerCancel={() => { drag.current = null; reset() }}>
      <img ref={image} src={source} alt="框选主体的原图" draggable={false} onLoad={event => {
        const { naturalWidth: width, naturalHeight: height } = event.currentTarget
        setSize({ width, height })
        if (initialBox && boxInside(initialBox, width, height)) setBox(initialBox)
        else reset(width, height)
      }} onError={() => { setSize({ width: 0, height: 0 }); setError('图片无法读取，请取消后重新选择图片。') }} />
      {valid && <span className="subject-select__box" aria-hidden="true" style={{
        left: `${box[0][0] / size.width * 100}%`, top: `${box[0][1] / size.height * 100}%`,
        width: `${(box[1][0] - box[0][0]) / size.width * 100}%`, height: `${(box[1][1] - box[0][1]) / size.height * 100}%`,
      }} />}
    </div>
    <details className="subject-select__adjust"><summary>精确调整选区</summary>
      <p>也可直接输入原图像素坐标，无需拖动。</p>
      <div className="subject-select__fields">{(['左边', '上边', '右边', '下边'] as const).map((label, index) => {
        const row = index < 2 ? 0 : 1, axis = index % 2
        return <label key={label}>{label}<input type="number" min="1" step="1" max={(axis ? size.height : size.width) - 1}
          disabled={!size.width} value={Number.isFinite(box[row][axis]) ? box[row][axis] : ''} onChange={event => {
            const next: CutoutBox = [[...box[0]], [...box[1]]]
            next[row][axis] = event.currentTarget.valueAsNumber; setBox(next)
          }} /></label>
      })}</div>
    </details>
    {!valid && size.width > 0 && <p role="status">选区宽高需至少10像素，且不能贴住图片边缘。</p>}
    {error && <p role="alert">{error}</p>}
    <div className="subject-select__actions"><Button variant="secondary" onClick={onCancel}>取消</Button>
      <Button variant="secondary" disabled={!size.width} onClick={() => reset()}>重置选区</Button>
      <Button disabled={!valid} onClick={() => onConfirm(box)}>按选区生成贴纸</Button></div>
  </dialog>
}
