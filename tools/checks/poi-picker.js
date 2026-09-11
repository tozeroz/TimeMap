// 验证选点页语义：点列表项是「选中」（不进新页），点「确认」回到发布页并带上地点
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/publish'
  await wait(900)
  out.发布页初始地点 = document.querySelector('.pub__poi')?.innerText?.trim() ?? null

  document.querySelector('.pub__poi')?.click()
  await wait(700)
  out.进入选点页 = location.hash
  out.页面仍在此路由 = location.hash === '#/poi'
  out.默认选中 = document.querySelector('.poi__row.is-selected .row__title')?.innerText ?? null

  // 点第二个地点
  const rows = [...document.querySelectorAll('.poi__row')]
  rows[2]?.click()
  await wait(400)
  out.选中项 = document.querySelector('.poi__row.is-selected .row__title')?.innerText ?? null
  out.仍是选点页 = location.hash === '#/poi'
  out.勾选标记数 = document.querySelectorAll('.poi__check').length

  // 点确认
  document.querySelector('.poi__confirm')?.click()
  await wait(700)
  out.确认后路由 = location.hash
  out.发布页地点 = document.querySelector('.pub__poi')?.innerText?.trim() ?? null

  // 「不添加地点」
  location.hash = '#/poi'
  await wait(700)
  const noneRow = [...document.querySelectorAll('.poi__row')].find((r) => r.innerText.includes('不添加地点'))
  noneRow?.click()
  await wait(300)
  document.querySelector('.poi__confirm')?.click()
  await wait(700)
  out.不添加地点后 = document.querySelector('.pub__poi')?.innerText?.trim() ?? null

  return out
})()
