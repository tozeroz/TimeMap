// 记录当前地图视图签名到 window.__mapSig，供后续对比（在线/离线都适用）
(() => {
  const sig = () => {
    const boxes = [...document.querySelectorAll('.rm, .map__marker')]
      .slice(0, 4)
      .map((n) => {
        const b = n.getBoundingClientRect()
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
      })
    return {
      hash: location.hash,
      mode: document.querySelector('.leaflet-container')
        ? 'online'
        : document.querySelector('.map__world')
          ? 'offline'
          : 'none',
      markers: boxes.length,
      first: boxes[0] ?? null,
      spread:
        boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null,
    }
  }
  window.__mapSig = sig()
  return window.__mapSig
})()
