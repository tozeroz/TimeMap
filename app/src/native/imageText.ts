export interface ImageText {
  text: string
  color: string
  size: 'small' | 'medium' | 'large'
  x: number
  y: number
  /** Optional fields keep drafts saved before the editor redesign compatible. */
  style?: 'simple' | 'handwritten' | 'outline'
  scale?: number
  rotation?: number
}

export const IMAGE_TEXT_COLORS = ['#ffffff', '#111111', '#ff735c', '#829579', '#ff8a32', '#1d513d', '#e64c65']
export const defaultImageText = (): ImageText => ({ text: '', color: '#ffffff', size: 'medium', x: 0.18, y: 0.56, style: 'simple', scale: 1, rotation: 0 })
const ratios = { small: 0.04, medium: 0.055, large: 0.075 }
export const imageTextFont = (style: ImageText['style']) => style === 'handwritten'
  ? 'KaiTi, STKaiti, "Kaiti SC", cursive'
  : 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif'
export const clampTextScale = (scale: number) => Math.max(0.5, Math.min(2, scale))

/** Shared geometry keeps the selection frame, on-screen text and exported pixels aligned. */
export function layoutImageText(ctx: CanvasRenderingContext2D, caption: ImageText, imageWidth: number, imageHeight: number) {
  const rotation = Number.isFinite(caption.rotation) ? caption.rotation! : 0
  const radians = rotation * Math.PI / 180
  let fontSize = Math.max(1, imageWidth * (ratios[caption.size] ?? ratios.medium) * clampTextScale(caption.scale ?? 1))
  const margin = Math.min(imageWidth * 0.02, imageHeight * 0.02)
  const font = imageTextFont(caption.style)
  const wrap = () => {
    ctx.font = `500 ${fontSize}px ${font}`
    const lines: string[] = []
    for (const paragraph of caption.text.split('\n')) {
      let line = ''
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > imageWidth * 0.82) { lines.push(line); line = char }
        else line += char
      }
      lines.push(line)
    }
    return lines
  }
  let lines = wrap()
  let width = 0, height = 0, boundWidth = 0, boundHeight = 0
  for (let i = 0; i < 16; i++) {
    width = Math.max(fontSize, ...lines.map(line => ctx.measureText(line).width))
    height = lines.length * fontSize * 1.3
    boundWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
    boundHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
    const fit = Math.min(1, (imageWidth - 2 * margin) / boundWidth, (imageHeight - 2 * margin) / boundHeight)
    if (fit >= 1) break
    fontSize *= fit * 0.98
    lines = wrap()
  }
  const centerX = Math.max(boundWidth / 2 + margin, Math.min(imageWidth * caption.x + width / 2, imageWidth - boundWidth / 2 - margin))
  const centerY = Math.max(boundHeight / 2 + margin, Math.min(imageHeight * caption.y + height / 2, imageHeight - boundHeight / 2 - margin))
  return { x: centerX - width / 2, y: centerY - height / 2, width, height, fontSize, font, lines, radians }
}

export function drawImageText(ctx: CanvasRenderingContext2D, caption: ImageText, width: number, height: number) {
  const layout = layoutImageText(ctx, caption, width, height)
  ctx.save()
  ctx.translate(layout.x + layout.width / 2, layout.y + layout.height / 2)
  ctx.rotate(layout.radians)
  ctx.font = `500 ${layout.fontSize}px ${layout.font}`
  ctx.textBaseline = 'top'
  ctx.fillStyle = IMAGE_TEXT_COLORS.includes(caption.color) ? caption.color : '#ffffff'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = ctx.fillStyle === '#111111' ? '#ffffff' : '#192d42'
  ctx.lineWidth = Math.max(0.5, layout.fontSize * (caption.style === 'outline' ? 0.12 : 0.035))
  layout.lines.forEach((line, index) => {
    const x = -layout.width / 2, y = -layout.height / 2 + index * layout.fontSize * 1.3
    ctx.strokeText(line, x, y); ctx.fillText(line, x, y)
  })
  ctx.restore()
  return layout
}

/** Compose only the post image. The map retains the untouched source. */
export async function renderImageText(source: string, caption: ImageText): Promise<string> {
  if (!caption.text.trim()) return source
  if (Array.from(caption.text).length > 50) throw new Error('图片文字不能超过50字')
  const img = new Image()
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('图片无法读取')); img.src = source })
  const canvas = document.createElement('canvas')
  canvas.width = img.width; canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('图片文字预览不可用')
  ctx.drawImage(img, 0, 0)
  drawImageText(ctx, caption, img.width, img.height)
  return canvas.toDataURL('image/png')
}
