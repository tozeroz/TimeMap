// 验证个人资料页（原版实测：三张卡片）与个人页四个入口的跳转
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/me'
  await wait(900)
  // 个人页四个入口都应指向 profile-edit
  const entries = [...document.querySelectorAll('.me__entry')].map((e) => e.innerText.trim())
  out.入口文案 = entries

  const first = [...document.querySelectorAll('.me__entry')].find((e) => e.innerText.includes('我的兴趣'))
  first?.click()
  await wait(700)
  out.跳转 = location.hash
  out.页面标题 = document.querySelector('.topbar__center')?.innerText ?? null

  out.行标签 = [...document.querySelectorAll('.pe__row .pe__label')].map((e) => e.innerText)
  out.学校值 = [...document.querySelectorAll('.pe__row')].find((r) => r.innerText.includes('学校'))?.innerText?.replace(/\s+/g, ' ') ?? null
  out.未认证标签 = document.querySelector('.pe__tag')?.innerText ?? null
  out.学校提示 = document.querySelector('.pe__hint')?.innerText ?? null
  out.校园名片 = document.querySelector('.pe__cardTitle')?.innerText ?? null
  out.名片标签 = [...document.querySelectorAll('.pe__tagChip')].map((e) => e.innerText)

  // 改昵称
  const nickRow = [...document.querySelectorAll('.pe__row')].find((r) => r.innerText.includes('昵称'))
  nickRow?.click()
  await wait(500)
  out.弹窗标题 = document.querySelector('.pe__panelTitle')?.innerText ?? null
  const input = document.querySelector('.pe__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '新的昵称')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(200)
  document.querySelector('.pe__save')?.click()
  await wait(500)
  out.改后昵称行 = [...document.querySelectorAll('.pe__row')].find((r) => r.innerText.includes('昵称'))?.innerText?.replace(/\s+/g, ' ') ?? null

  // 切换名片标签
  document.querySelector('.pe__tagChip')?.click()
  await wait(300)
  out.标签选中数 = document.querySelectorAll('.pe__tagChip.is-on').length

  return out
})()
