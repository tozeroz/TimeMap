// 悬浮控件（回到定位 / 放大）的中心点，CSS 视口像素，供真实触摸点击使用
(() => {
  const center = (el) => {
    const r = el.getBoundingClientRect()
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]
  }
  const ctrls = [...document.querySelectorAll('.map__ctrl')]
  return {
    count: ctrls.length,
    recenterCenter: ctrls[0] ? center(ctrls[0]) : null,
    zoomCenter: ctrls[1] ? center(ctrls[1]) : null,
  }
})()
