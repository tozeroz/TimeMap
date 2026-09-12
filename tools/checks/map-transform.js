// 地图当前视图（只读）：provider 无关
(() => {
  const host = document.querySelector('.realmaps')
  const boxes = [...document.querySelectorAll('.rm, .map__marker')]
    .slice(0, 4)
    .map((n) => {
      const b = n.getBoundingClientRect()
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
    })
  return {
    hash: location.hash,
    mode: host?.dataset.provider ?? (document.querySelector('.map__world') ? 'offline' : 'none'),
    center: host?.dataset.center ?? null,
    zoom: host?.dataset.zoom ?? null,
    markers: boxes.length,
    first: boxes[0] ?? null,
    spread:
      boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null,
  }
})()
