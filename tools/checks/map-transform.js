// 地图当前“视图签名”：在线（Leaflet）与离线自绘地图都适用。
// 走的是标记的屏幕坐标 —— 拖拽会整体平移，缩放会改变标记间距，和服务商无关。
(async () => {
  const boxes = [...document.querySelectorAll('.rm, .map__marker')]
    .slice(0, 4)
    .map((n) => {
      const b = n.getBoundingClientRect()
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
    })
  const first = boxes[0] ?? null
  const spread =
    boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null
  return {
    hash: location.hash,
    mode: document.querySelector('.leaflet-container')
      ? 'online'
      : document.querySelector('.map__world')
        ? 'offline'
        : 'none',
    markers: boxes.length,
    first,
    spread,
  }
})()
