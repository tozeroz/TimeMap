// 点击“回到定位”按钮（把地图拉回真实坐标）
(() => {
  const b = document.querySelectorAll('.map__ctrl')[0]
  if (!b) return { ok: false, reason: 'no .map__ctrl[0]' }
  const aria = b.getAttribute('aria-label')
  b.click()
  return { ok: true, aria }
})()
