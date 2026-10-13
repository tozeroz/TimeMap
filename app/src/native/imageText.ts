export interface ImageText {
  text: string
  color: string
  size: 'small' | 'medium' | 'large'
  x: number
  y: number
}

export const IMAGE_TEXT_COLORS = ['#ffffff', '#111111', '#ff8a32', '#1d513d', '#e64c65']
export const defaultImageText = (): ImageText => ({ text: '', color: '#ffffff', size: 'medium', x: 0.08, y: 0.72 })
const ratios = { small: 0.04, medium: 0.065, large: 0.09 }

/** Compose only the post image. The map retains the untouched source. */
export async function renderImageText(source: string, caption: ImageText): Promise<string> {
  if (!caption.text.trim()) return source
  if (Array.from(caption.text).length > 50) throw new Error('图片文字不能超过50字')
  const img = new Image()
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('图片无法读取')); img.src = source })
  const canvas = document.createElement('canvas')
  canvas.width = img.width; canvas.height = img.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('图片文字预览不可用')
  const ctx = context
  ctx.drawImage(img, 0, 0)
  let fontSize = Math.max(1, img.width * ratios[caption.size])
  const maxWidth = img.width * 0.84
  const margin = Math.min(img.width * 0.015, img.height * 0.05)
  function wrap() {
    ctx.font = `600 ${fontSize}px Arial, sans-serif`
    const lines: string[] = []
    for (const paragraph of caption.text.split('\n')) {
      let line = ''
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = char }
        else line += char
      }
      lines.push(line)
    }
    return lines
  }
  let lines = wrap()
  // Even a narrow image or many line breaks must keep the complete text visible.
  for (let i = 0; i < 10 && lines.length * fontSize * 1.25 > img.height - margin * 2; i++) {
    fontSize *= Math.min(0.9, (img.height - margin * 2) / (lines.length * fontSize * 1.25))
    lines = wrap()
  }
  const width = Math.max(...lines.map(line => ctx.measureText(line).width))
  const height = lines.length * fontSize * 1.25
  const x = Math.max(margin, Math.min(img.width * caption.x, img.width - width - margin))
  const y = Math.max(margin, Math.min(img.height * caption.y, img.height - height - margin))
  ctx.textBaseline = 'top'
  ctx.fillStyle = IMAGE_TEXT_COLORS.includes(caption.color) ? caption.color : '#ffffff'
  ctx.lineWidth = Math.max(0.5, fontSize * 0.06)
  ctx.strokeStyle = ctx.fillStyle === '#111111' ? '#ffffff' : '#000000'
  ctx.lineJoin = 'round'
  lines.forEach((line, index) => { ctx.strokeText(line, x, y + index * fontSize * 1.25); ctx.fillText(line, x, y + index * fontSize * 1.25) })
  return canvas.toDataURL('image/png')
}
