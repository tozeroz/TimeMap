import { useEffect, useRef, useState } from 'react'
import './avatarcropper.css'

const SIZE = 280
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))

/** Preview and export share the same crop coordinates, independent of screen size. */
export function AvatarCropper({ file, onCancel, onConfirm }: {
  file: File
  onCancel: () => void
  onConfirm: (file: File) => Promise<boolean>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [url, setUrl] = useState('')
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const confirming = useRef(false)
  const scale = dimensions.width ? Math.max(SIZE / dimensions.width, SIZE / dimensions.height) * zoom : 1
  const width = dimensions.width * scale
  const height = dimensions.height * scale
  const x = clamp(position.x, Math.max(0, (width - SIZE) / 2))
  const y = clamp(position.y, Math.max(0, (height - SIZE) / 2))

  useEffect(() => {
    const source = URL.createObjectURL(file)
    setUrl(source)
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { URL.revokeObjectURL(source); previous?.focus() }
  }, [file])

  async function confirm() {
    if (!image.current || !dimensions.width || confirming.current) return
    confirming.current = true
    setWorking(true); setError('')
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, 512, 512)
      context.drawImage(image.current, ((width - SIZE) / 2 - x) / scale,
        ((height - SIZE) / 2 - y) / scale, SIZE / scale, SIZE / scale, 0, 0, 512, 512)
      // Source rectangle starts at the visible frame's top-left within the image.
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Image export failed')), 'image/jpeg', 0.92))
      if (!await onConfirm(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))) {
        setError('头像上传失败，请重试。')
      }
    } catch { setError('图片处理失败，请重试或换一张照片。') }
    finally { confirming.current = false; setWorking(false) }
  }

  return <dialog ref={dialog} className="avatar-crop" aria-labelledby="avatar-crop-title"
    onCancel={event => { event.preventDefault(); if (!working) onCancel() }}>
    <h2 id="avatar-crop-title">调整头像</h2>
    <p id="avatar-crop-hint">拖动照片调整位置，滑动下方滑杆缩放。</p>
    <div className="avatar-crop__frame" tabIndex={0} role="group" aria-label="头像裁剪区域" aria-describedby="avatar-crop-hint"
      onPointerDown={event => {
        if (working || !dimensions.width) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      }}
      onPointerMove={event => {
        const previous = drag.current
        if (!previous || previous.id !== event.pointerId || working) return
        const ratio = SIZE / event.currentTarget.getBoundingClientRect().width
        setPosition({ x: clamp(x + (event.clientX - previous.x) * ratio, Math.max(0, (width - SIZE) / 2)),
          y: clamp(y + (event.clientY - previous.y) * ratio, Math.max(0, (height - SIZE) / 2)) })
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onKeyDown={event => {
        if (working || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        setPosition({ x: clamp(x + (event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0), Math.max(0, (width - SIZE) / 2)),
          y: clamp(y + (event.key === 'ArrowUp' ? -5 : event.key === 'ArrowDown' ? 5 : 0), Math.max(0, (height - SIZE) / 2)) })
      }}>
      {url && <img ref={image} src={url} alt="头像裁剪预览" draggable={false}
        onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => { setDimensions({ width: 0, height: 0 }); setError('无法读取这张图片，请换一张照片。') }}
        style={{ width: `${width / SIZE * 100}%`, height: `${height / SIZE * 100}%`,
          left: `${50 + x / SIZE * 100}%`, top: `${50 + y / SIZE * 100}%` }} />}
    </div>
    <label className="avatar-crop__zoom">缩放 <input type="range" min="1" max="3" step="0.01" value={zoom}
      disabled={working || !dimensions.width} onChange={event => { setPosition({ x, y }); setZoom(Number(event.target.value)) }} /></label>
    <p className="avatar-crop__hint">也可用方向键微调位置。确认后，仍需保存个人资料。</p>
    {error && <p className="avatar-crop__error" role="alert">{error}</p>}
    <div className="avatar-crop__actions">
      <button disabled={working} onClick={onCancel}>取消</button>
      <button disabled={working || !dimensions.width} onClick={() => void confirm()}>{working ? '正在上传…' : '确认使用'}</button>
    </div>
  </dialog>
}
