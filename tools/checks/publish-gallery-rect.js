// 发布页左下角「相册」键的中心点（CSS 视口像素），供真实触摸点击使用
(() => {
  const btn = document.querySelector('.pub__controls [aria-label="相册"]')
  if (!btn) return { center: null }
  const r = btn.getBoundingClientRect()
  return {
    center: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
    disabled: !!btn.disabled,
  }
})()
