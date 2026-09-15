// 返回“授权地理位置”弹窗两个按钮的中心点（CSS 视口像素），供真实触摸点击使用。
// 键名保持 ASCII，方便 acceptance.ps1 解析。
(() => {
  const buttons = [...document.querySelectorAll('.map__modal-btn')]
  const center = (el) => {
    const r = el.getBoundingClientRect()
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]
  }
  const skip = buttons[0]
  const allow = buttons[1]
  return {
    modalPresent: !!document.querySelector('.map__modal'),
    buttonCount: buttons.length,
    skipText: skip?.innerText ?? null,
    allowText: allow?.innerText ?? null,
    skipCenter: skip ? center(skip) : null,
    allowCenter: allow ? center(allow) : null,
  }
})()
