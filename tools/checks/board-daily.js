// 验证留言板空态与发留言、今日打卡空态与 FAB
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/board'
  await wait(900)
  out.留言板空态 = document.querySelector('.board__emptyText')?.innerText ?? null
  out.输入框提示 = document.querySelector('.board__input')?.placeholder
  out.表情数 = document.querySelectorAll('.board__emoji').length

  // 发一条留言
  const input = document.querySelector('.board__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '周末一起打球吗')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await wait(300)
  document.querySelector('.board__send')?.click()
  await wait(500)
  out.留言后便签数 = document.querySelectorAll('.note').length
  out.留言内容 = document.querySelector('.note__text')?.innerText ?? null
  out.空态已消失 = !document.querySelector('.board__emptyText')

  location.hash = '#/daily'
  await wait(900)
  out.打卡页返回按钮 = !!document.querySelector('button[aria-label="返回"]')
  out.打卡页分享按钮 = !!document.querySelector('button[aria-label="分享"]')
  out.打卡页标题区 = document.querySelector('.topbar__center')?.innerText?.trim() || '(无标题)'
  out.品牌区文案 = document.querySelector('.daily__heroBrand')?.innerText ?? null
  out.空态文案 = document.querySelector('.daily__empty')?.innerText ?? null
  out.FAB存在 = !!document.querySelector('.daily__fab')

  return out
})()
