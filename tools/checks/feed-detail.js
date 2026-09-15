// 验证动态详情页与评论详情页的结构与交互
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/feed?id=p1'
  await wait(900)
  out.详情作者行 = document.querySelector('.feed__author-meta')?.innerText?.trim()
  out.底部动作 = [...document.querySelectorAll('.feed__action')].map((b) => b.innerText.trim())
  out.输入框提示 = document.querySelector('.feed__input')?.placeholder

  // 点赞
  const likeBtn = document.querySelector('.feed__action')
  const before = likeBtn?.innerText?.trim()
  likeBtn?.click()
  await wait(400)
  out.点赞变化 = `${before} -> ${document.querySelector('.feed__action')?.innerText?.trim()}`

  // 进评论详情
  document.querySelector('.feed__action--text')?.click()
  await wait(800)
  out.评论页路由 = location.hash
  out.评论页作者 = document.querySelector('.cd__name')?.innerText ?? null
  out.评论页计数 = document.querySelector('.cd__count')?.innerText ?? null
  out.评论页输入提示 = document.querySelector('.feed__input')?.placeholder
  out.评论条数 = document.querySelectorAll('.cd__list .cmt').length

  // 发一条评论
  const input = document.querySelector('.feed__input')
  const sendBtn = document.querySelector('.cd__send')
  out.发送按钮初始禁用 = sendBtn?.disabled ?? null
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '测试评论')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await wait(300)
  out.发送按钮可用 = !document.querySelector('.cd__send')?.disabled
  document.querySelector('.cd__send')?.click()
  await wait(500)
  out.发送后评论数 = document.querySelectorAll('.cd__list .cmt').length

  return out
})()
