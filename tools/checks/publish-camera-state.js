// 拍摄模式当前状态 + 取景画面亮度分布（配合真实触摸点击使用）
(async () => {
  const video = document.querySelector('.pub__video')
  const draft = [...document.querySelectorAll('.pub__draftItem img')].map((img) => ({
    isJpeg: img.src.startsWith('data:image/jpeg'),
    bytes: img.src.length,
  }))
  let frame = null
  if (video && video.videoWidth) {
    await new Promise((r) => setTimeout(r, 500))
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 48
    c.getContext('2d').drawImage(video, 0, 0, 64, 48)
    const d = c.getContext('2d').getImageData(0, 0, 64, 48).data
    let sum = 0
    let min = 255
    let max = 0
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
      sum += lum
      if (lum < min) min = lum
      if (lum > max) max = lum
    }
    frame = { avg: Math.round(sum / (d.length / 4)), min: Math.round(min), max: Math.round(max) }
  }
  const video2 = document.querySelector('.pub__video')
  return {
    camState: video2?.dataset.camState ?? null,
    facing: video2?.dataset.facing ?? null,
    mirrored: video2?.classList.contains('is-mirrored') ?? null,
    videoSize: video2 ? [video2.videoWidth, video2.videoHeight] : null,
    draftCount: draft.length,
    draft,
    frame,
    frameNotBlank: frame ? frame.max - frame.min > 8 : null,
    flipEnabled: !document.querySelector('[aria-label="切换前后置摄像头"]')?.disabled,
  }
})()
