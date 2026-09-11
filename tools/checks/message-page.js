// 验证聊天页：好友申请弹窗、移除补位、邀请分享面板
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/message'
  await wait(1000)

  const rows = () => document.querySelectorAll('.srow')
  out.初始推荐数 = rows().length
  out.首个昵称 = rows()[0]?.querySelector('.srow__name')?.innerText?.trim()
  out.每行按钮数 = rows()[0]?.querySelectorAll('button').length

  // 点「添加」→ 弹好友申请
  rows()[0]?.querySelector('.srow__btn')?.click()
  await wait(600)
  out.弹窗标题 = document.querySelector('.dialog__title')?.innerText ?? null
  out.预填内容 = document.querySelector('.dialog__input')?.value ?? null
  out.字数计数 = document.querySelector('.dialog__count')?.innerText?.trim() ?? null

  // 发送
  document.querySelector('.dialog__btn--primary')?.click()
  await wait(600)
  out.弹窗已关闭 = !document.querySelector('.dialog__panel')
  out.首个按钮文案 = rows()[0]?.querySelector('.srow__btn')?.innerText?.trim()

  // 移除首行
  const before = rows().length
  rows()[0]?.querySelector('.srow__remove')?.click()
  await wait(500)
  out.移除后 = `${before} -> ${rows().length}`

  // 邀请面板
  document.querySelector('.invite__btn')?.click()
  await wait(600)
  out.邀请面板 = !!document.querySelector('.dialog__sheet')
  out.分享目标 = [...document.querySelectorAll('.dialog__targetLabel')].map((e) => e.innerText)
  document.querySelector('.dialog__cancel')?.click()
  await wait(400)
  out.面板已关闭 = !document.querySelector('.dialog__sheet')

  return out
})()
