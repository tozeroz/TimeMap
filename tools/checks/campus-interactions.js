// 验证校园页的新交互：学校切换面板、作者头像进主页、点赞
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = {}

  location.hash = '#/campus'
  await wait(900)
  out.初始学校 = document.querySelector('.bigtitle__sub')?.innerText?.trim()

  // 打开学校切换面板
  document.querySelector('.bigtitle__sub')?.click()
  await wait(600)
  out.面板已打开 = !!document.querySelector('.switcher')
  out.学校条目数 = document.querySelectorAll('.switcher__item').length
  out.搜索框提示语 = document.querySelector('.switcher__input')?.placeholder ?? null

  // 选一个学校
  const target = [...document.querySelectorAll('.switcher__item')].find((e) =>
    e.innerText.includes('清华大学'),
  )
  target?.click()
  await wait(600)
  out.选择后学校 = document.querySelector('.bigtitle__sub')?.innerText?.trim()
  out.面板已关闭 = !document.querySelector('.switcher')

  // 点作者头像进他人主页
  document.querySelector('.pcard__author')?.click()
  await wait(900)
  out.作者跳转 = location.hash
  out.他人主页已渲染 = !!document.querySelector('.up__name')
  out.他人昵称 = document.querySelector('.up__name')?.innerText ?? null
  out.他人主页动态数 = document.querySelectorAll('.up__grid .pcard').length

  // 回校园页测点赞
  location.hash = '#/campus'
  await wait(800)
  const likeBtn = document.querySelector('.pcard__like')
  const before = likeBtn?.innerText?.trim()
  likeBtn?.click()
  await wait(400)
  const after = document.querySelector('.pcard__like')?.innerText?.trim()
  out.点赞数变化 = `${before} -> ${after}`

  return out
})()
