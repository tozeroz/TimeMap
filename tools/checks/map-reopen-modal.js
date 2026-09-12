// 重新进入地图，让“授权地理位置”弹窗重新出现（不要点它，留给真实触摸测试用）
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const want = localStorage.getItem('probe.mapHash') || '#/map'
  location.hash = '#/campus'
  await wait(900)
  location.hash = want
  await wait(1800)
  return {
    hash: location.hash,
    modalPresent: !!document.querySelector('.map__modal'),
    mode: document.querySelector('.realmaps')?.dataset.provider ?? 'offline',
  }
})()
