// 验证登录入口页与新手引导页
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/loginselect'
  await wait(900)
  out.品牌 = document.querySelector('.ls__brandText')?.innerText ?? null
  out.主按钮 = document.querySelector('.ls__login')?.innerText?.trim() ?? null
  out.协议文案 = document.querySelector('.ls__agreeText')?.innerText?.replace(/\s+/g, '') ?? null
  out.初始未勾选 = !document.querySelector('.ls__check')?.classList.contains('is-on')

  // 未勾选直接点登录 → 应提示且不跳转
  document.querySelector('.ls__login')?.click()
  await wait(500)
  out.未勾选提示 = document.querySelector('.ls__warn')?.innerText ?? null
  out.未跳转 = location.hash === '#/loginselect'

  // 勾选后再点 → 跳到手机号页
  document.querySelector('.ls__check')?.click()
  await wait(300)
  out.已勾选 = document.querySelector('.ls__check')?.classList.contains('is-on')
  document.querySelector('.ls__login')?.click()
  await wait(700)
  out.跳转后 = location.hash
  out.手机号页标题 = document.querySelector('.login__title')?.innerText ?? null

  location.hash = '#/onboarding'
  await wait(900)
  out.引导标题 = document.querySelector('.ob__title')?.innerText ?? null
  out.输入提示 = document.querySelector('.ob__input')?.placeholder ?? null
  out.按钮文案 = document.querySelector('.ob__next')?.innerText?.trim() ?? null

  return out
})()
