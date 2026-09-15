// 发布页与摄像头链路检查
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/publish'
  await wait(1200)
  out.运行环境 = window.Capacitor?.isNativePlatform?.() ? 'native(APK)' : 'web'
  out.有拍摄模式取景器 = !!document.querySelector('.pub__viewfinder')
  out.快门按钮存在 = !!document.querySelector('.pub__shutter')
  out.顶栏发布按钮文案 = document.querySelector('.pub__publish')?.innerText?.trim() ?? null
  out.初始发布按钮禁用 = document.querySelector('.pub__publish')?.disabled ?? null

  // 切到文字模式，验证输入后发布按钮可用
  const textMode = [...document.querySelectorAll('.pub__mode')].find((b) => b.innerText === '文字')
  textMode?.click()
  await wait(400)
  const ta = document.querySelector('.pub__textarea')
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, '这是一条真实发布的测试动态')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(300)
  out.输入后发布按钮可用 = !document.querySelector('.pub__publish')?.disabled

  // 真的发布
  document.querySelector('.pub__publish')?.click()
  await wait(900)
  out.发布后路由 = location.hash
  out.信息流首条文本 = document.querySelector('.pcard__overlay-text')?.innerText
    ?? document.querySelector('.pcard__text')?.innerText ?? null
  out.本地帖子数 = (() => {
    try {
      return JSON.parse(localStorage.getItem('campus.demo.myPosts.v1') ?? '[]').length
    } catch {
      return -1
    }
  })()

  return out
})()
