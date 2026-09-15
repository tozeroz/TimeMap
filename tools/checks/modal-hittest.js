// 诊断：地图页“授权地理位置”弹窗能不能被真实触摸点到
// （程序化 .click() 会绕过命中测试，所以这个脚本必须配合 adb shell input tap 使用）
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const result = {}

  const btn = document.querySelectorAll('.map__modal-btn')
  const wrap = document.querySelector('.map__modal-wrap')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      center: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
      zIndex: getComputedStyle(el).zIndex,
      pointerEvents: getComputedStyle(el).pointerEvents,
      position: getComputedStyle(el).position,
    }
  }

  result.modalPresent = !!document.querySelector('.map__modal')
  result.wrap = box(wrap)
  result.buttons = [...btn].map((b) => ({ text: b.innerText, ...box(b) }))

  // 关键：弹窗按钮中心点上，实际命中的是哪个元素？
  result.hitTest = [...btn].map((b) => {
    const r = b.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      button: b.innerText,
      hitTag: el ? el.tagName : null,
      hitClass: el ? String(el.className).slice(0, 80) : null,
      hitIsTheButton: el === b || (el && b.contains(el)),
    }
  })

  // 地图容器与实际渲染层的 z-index 情况
  const stage = document.querySelector('.map')
  result.stageChildren = stage
    ? [...stage.children].map((c) => ({
        cls: String(c.className).slice(0, 60),
        zIndex: getComputedStyle(c).zIndex,
        pos: getComputedStyle(c).position,
      }))
    : null

  const host = document.querySelector('.realmaps')
  result.realmapsChildren = host
    ? [...host.children].map((c) => ({
        tag: c.tagName,
        cls: String(c.className).slice(0, 60),
        zIndex: getComputedStyle(c).zIndex,
      }))
    : null

  // 再取一次命中，看弹窗按钮上方到底压着什么
  const first = btn[1]
  if (first) {
    const r = first.getBoundingClientRect()
    const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    result.stackAtAuthorize = stack.slice(0, 6).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`)
  }

  await wait(50)
  return result
})()
