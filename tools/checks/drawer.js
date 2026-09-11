// 验证抽屉菜单（原版实测 8 项）
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/me'
  await wait(900)
  out.抽屉初始关闭 = !document.querySelector('.drawer')

  document.querySelector('button[aria-label="菜单"]')?.click()
  await wait(500)
  out.抽屉已打开 = !!document.querySelector('.drawer')
  out.菜单项 = [...document.querySelectorAll('.drawer__item')]
    .map((e) => e.innerText.trim())
    .filter((t) => !t.includes('demo'))

  // 点「版本信息」
  const about = [...document.querySelectorAll('.drawer__item')].find((e) => e.innerText.includes('版本信息'))
  about?.click()
  await wait(700)
  out.跳转后 = location.hash
  out.二级页标题 = document.querySelector('.dp__title')?.innerText ?? null
  out.版本号 = document.querySelector('.dpcard__version')?.innerText ?? null

  // 回个人页再测另一项
  location.hash = '#/me'
  await wait(700)
  document.querySelector('button[aria-label="菜单"]')?.click()
  await wait(400)
  const account = [...document.querySelectorAll('.drawer__item')].find((e) => e.innerText.includes('账号与安全'))
  account?.click()
  await wait(700)
  out.第二项跳转 = location.hash
  out.第二页标题 = document.querySelector('.dp__title')?.innerText ?? null

  return out
})()
