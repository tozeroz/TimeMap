// 全路由回归：逐页确认关键元素存在，产出覆盖矩阵
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const routes = [
    ['campus', '#/campus', '.pcard'],
    ['me', '#/me', '.me__avatar'],
    ['map', '#/map', '.leaflet-container, .map__world'],
    ['feed', '#/feed?id=p1', '.feed__text'],
    ['comments', '#/comments?id=p1', '.cd__count'],
    ['message', '#/message', '.srow'],
    ['chat', '#/chat?id=t1', '.chatbar__input'],
    ['group', '#/group?id=g1', '.grp__notice'],
    ['board', '#/board', '.board__emptyText'],
    ['daily', '#/daily', '.daily__fab'],
    ['poi', '#/poi', '.poi__confirm'],
    ['poidetail', '#/poidetail', '.pd__name'],
    ['publish', '#/publish', '.pub__mode'],
    ['scanner', '#/scanner', '.scan__frame'],
    ['login', '#/login', '.login__title'],
    ['loginselect', '#/loginselect', '.ls__login'],
    ['onboarding', '#/onboarding', '.ob__title'],
    ['announce', '#/announce', '.ann__item'],
    ['feedlist', '#/feedlist', '.fl__error'],
    ['media', '#/media?post=p1&i=0', '.media__image'],
    ['upgrade', '#/upgrade', '.up__dialog'],
    ['more', '#/more', '.row'],
    ['user', '#/user?id=u1', '.up__name'],
    ['account', '#/account', '.dp__title'],
    ['verify', '#/verify', '.dpcard'],
    ['privacy', '#/privacy', '.dprow'],
    ['blacklist', '#/blacklist', '.dpempty'],
    ['about', '#/about', '.dpcard__version'],
    ['contact', '#/contact', '.dprow'],
    ['interests', '#/interests', '.chip'],
    ['tags', '#/tags', '.chip'],
    ['bio', '#/bio', '.para'],
    ['school', '#/school', '.para'],
    ['edit-profile', '#/edit-profile', '.para'],
  ]

  const rows = []
  for (const [name, hash, selector] of routes) {
    location.hash = hash
    await wait(420)
    const el = document.querySelector(selector)
    rows.push({
      page: name,
      hash,
      期望选择器: selector,
      结果: el ? 'OK' : 'MISSING',
    })
  }
  const failed = rows.filter((r) => r.结果 !== 'OK')
  return { 总数: rows.length, 通过: rows.length - failed.length, 失败: failed, 明细: rows }
})()
