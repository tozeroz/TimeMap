// 地图打开后的状态（在线 Leaflet 与离线自绘都适用）
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  // 已经是 map 路由就别再改 hash —— 否则会把 ?offline=1 这类参数冲掉
  if (!location.hash.startsWith('#/map')) location.hash = '#/map'
  await wait(1400)
  // 关掉授权弹窗（原版首次进入也有这个阻断式弹窗）
  document.querySelector('.map__modal-btn')?.click()
  await wait(3500)

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
    modalGone: !document.querySelector('.map__modal'),
    markers: boxes.length,
    first: boxes[0] ?? null,
    spread:
      boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null,
    tilesLoaded: document.querySelectorAll('.leaflet-tile-loaded').length,
    regionLabel: document.querySelector('.map__region')?.innerText?.trim() ?? null,
  }
})()
