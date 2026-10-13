/** Crop to the alpha bounds and optionally bake a white outline into transparent PNG. */
export async function renderSticker(source: string, outline: boolean): Promise<string> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('贴纸图片无法读取'))
    img.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const pixels = ctx.getImageData(0, 0, img.width, img.height).data
  let left = img.width, top = img.height, right = -1, bottom = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (pixels[(y * img.width + x) * 4 + 3] > 8) {
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
  }
  if (right < left) throw new Error('未识别到主体，请换图或恢复原图')
  const width = right - left + 1, height = bottom - top + 1
  const radius = outline ? Math.max(3, Math.round(Math.max(width, height) / 100)) : 0
  const mask = document.createElement('canvas')
  mask.width = width; mask.height = height
  const m = mask.getContext('2d')!
  m.drawImage(img, left, top, width, height, 0, 0, width, height)
  m.globalCompositeOperation = 'source-in'
  m.fillStyle = '#fff'; m.fillRect(0, 0, width, height)
  canvas.width = width + radius * 2; canvas.height = height + radius * 2
  if (outline) {
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) ctx.drawImage(mask, radius + x, radius + y)
    }
  }
  ctx.drawImage(img, left, top, width, height, radius, radius, width, height)
  return canvas.toDataURL('image/png')
}
