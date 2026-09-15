// 点击“放大”按钮，并回报按钮身份
(() => {
  const b = document.querySelectorAll('.map__ctrl')[1]
  if (!b) return { ok: false, reason: 'no .map__ctrl[1]' }
  const aria = b.getAttribute('aria-label')
  b.click()
  return { ok: true, aria, markers: document.querySelectorAll('.rm').length }
})()
