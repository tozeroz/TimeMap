(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  location.hash = '#/campus'
  await wait(1000)
  const cards = [...document.querySelectorAll('.pcard')]
  return {
    卡片总数: cards.length,
    首条文本: cards[0]?.innerText?.replace(/\s+/g, ' ').slice(0, 40) ?? null,
    首条是否我发的: cards[0]?.innerText?.includes('自定义名称6') ?? false,
    本地帖子数: JSON.parse(localStorage.getItem('campus.demo.myPosts.v1') ?? '[]').length,
  }
})()
