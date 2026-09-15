(async () => {
  location.hash = '#/feed?id=p1'
  await new Promise((r) => setTimeout(r, 900))
  const actions = [...document.querySelectorAll('.feed__action')]
  const before = location.hash
  const commentBtn = actions.find((b) => b.querySelector('svg') && b.innerText.trim() !== '收藏' && b !== actions[0])
  commentBtn?.click()
  await new Promise((r) => setTimeout(r, 800))
  return {
    before,
    actionTexts: actions.map((b) => b.innerText.trim()),
    clickedIndex: actions.indexOf(commentBtn),
    after: location.hash,
    commentPageRendered: !!document.querySelector('.feed__comments-title'),
  }
})()
