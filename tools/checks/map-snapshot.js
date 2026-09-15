// 地图当前“视图签名”：腾讯 SDK / 栅格瓦片 / 离线自绘三套底图都适用。
// 优先用底图自己上报的 data-center + data-zoom（最直接），
// 离线自绘没有这套上报，就退化成读标记的屏幕坐标。
(() => {
  const read = () => {
    const host = document.querySelector('.realmaps')
    const mode = host?.dataset.provider ?? (document.querySelector('.map__world') ? 'offline' : 'none')
    const center = host?.dataset.center ?? null
    const zoom = host?.dataset.zoom ? Number(host.dataset.zoom) : null
    const boxes = [...document.querySelectorAll('.rm, .map__marker')]
      .slice(0, 4)
      .map((n) => {
        const b = n.getBoundingClientRect()
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
      })
    return {
      hash: location.hash,
      mode,
      center,
      zoom,
      markers: boxes.length,
      first: boxes[0] ?? null,
      spread:
        boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null,
    }
  }
  window.__mapRead = read
  window.__mapSig = read()
  return window.__mapSig
})()
