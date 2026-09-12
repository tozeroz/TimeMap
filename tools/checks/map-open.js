// 地图打开后的状态（腾讯 SDK / 高德 SDK / 栅格瓦片 / 离线自绘都适用）
// 想打开哪张底图，先让调用方写 localStorage.setItem('probe.mapHash', '#/map?raster=1')；
// 不写就是默认的 '#/map'。这样每次都由本脚本自己设 hash，不依赖上一步的导航残留。
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const want = localStorage.getItem('probe.mapHash') || '#/map'
  location.hash = want
  await wait(1400)
  // 关掉授权弹窗（原版首次进入也有这个阻断式弹窗）
  document.querySelector('.map__modal-btn')?.click()
  await wait(4000)

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
    badge: document.querySelector('.map__onlineBadge, .map__offlineBadge')?.innerText ?? null,
    center: host?.dataset.center ?? null,
    zoom: host?.dataset.zoom ?? null,
    modalGone: !document.querySelector('.map__modal'),
    markers: boxes.length,
    first: boxes[0] ?? null,
    spread:
      boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null,
    tilesLoaded: document.querySelectorAll('.leaflet-tile-loaded').length,
    canvases: host ? host.querySelectorAll('canvas').length : 0,
    regionLabel: document.querySelector('.map__region')?.innerText?.trim() ?? null,
  }
})()
