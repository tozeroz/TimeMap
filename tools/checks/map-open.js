(async () => {
  location.hash = '#/map'
  await new Promise((r) => setTimeout(r, 1200))
  // 关掉授权弹窗（原版首次进入也有这个阻断式弹窗）
  document.querySelector('.map__modal-btn')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const world = document.querySelector('.map__world')
  return {
    hash: location.hash,
    modalGone: !document.querySelector('.map__modal'),
    markers: document.querySelectorAll('.map__marker').length,
    transform: world ? getComputedStyle(world).transform : null,
    regionLabel: document.querySelector('.map__region')?.innerText?.trim() ?? null,
  }
})()
