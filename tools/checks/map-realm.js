// 在线地图（Leaflet）在设备上的加载情况
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  location.hash = '#/map'
  await wait(1500)
  document.querySelector('.map__modal-btn')?.click()
  await wait(5000)
  return {
    有leaflet容器: !!document.querySelector('.leaflet-container'),
    瓦片已加载: document.querySelectorAll('.leaflet-tile-loaded').length,
    瓦片总数: document.querySelectorAll('.leaflet-tile').length,
    标记数: document.querySelectorAll('.rm').length,
    在线标记: document.querySelector('.map__onlineBadge')?.innerText ?? null,
    离线标记: document.querySelector('.map__offlineBadge')?.innerText ?? null,
    首块瓦片URL: document.querySelector('.leaflet-tile')?.src ?? null,
  }
})()
