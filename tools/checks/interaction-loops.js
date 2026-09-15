// 交互闭环全量验证：覆盖有状态的操作（发送、切换、发布、翻页、筛选等）
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const setInput = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const results = []
  const check = (name, actual, expected) => {
    const ok = String(actual) === String(expected)
    results.push({ 检查项: name, 期望: expected, 实际: actual, 结果: ok ? 'PASS' : 'FAIL' })
  }

  // 1) 校园页：学校筛选 + 点赞
  location.hash = '#/campus'
  await wait(800)
  document.querySelector('.bigtitle__sub')?.click()
  await wait(400)
  const input = document.querySelector('.switcher__input')
  setInput(input, '上海')
  await wait(400)
  check('学校搜索「上海」结果数', document.querySelectorAll('.switcher__item').length, 2)
  const firstSchool = document.querySelector('.switcher__item')?.innerText?.split('\n')[0]?.trim()
  document.querySelector('.switcher__item')?.click()
  await wait(400)
  check('选中后校名与列表首项一致', document.querySelector('.bigtitle__sub')?.innerText?.trim(), firstSchool)
  const likeBtn = document.querySelector('.pcard__like')
  const likeBefore = likeBtn?.innerText?.trim()
  likeBtn?.click()
  await wait(300)
  check('点赞 +1', document.querySelector('.pcard__like')?.innerText?.trim(), String(Number(likeBefore) + 1))

  // 2) 单聊：发消息
  location.hash = '#/chat?id=t1'
  await wait(700)
  const before = document.querySelectorAll('.chat__row').length
  const chatInput = document.querySelector('.chatbar__input')
  setInput(chatInput, '收到，明天见')
  await wait(200)
  document.querySelector('.chatbar__input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await wait(400)
  check('单聊发送后条数', document.querySelectorAll('.chat__row').length, before + 1)
  check('发送后输入框清空', document.querySelector('.chatbar__input')?.value, '')

  // 3) 群聊：@ 面板插入
  location.hash = '#/group?id=g1'
  await wait(700)
  document.querySelector('.grp__at')?.click()
  await wait(300)
  check('@ 面板项数', document.querySelectorAll('.grp__at-item').length, 7)
  document.querySelector('.grp__at-item')?.click()
  await wait(300)
  check('@ 插入后输入框以 @ 开头', document.querySelector('.chatbar__input')?.value?.startsWith('@'), 'true')

  // 4) 发布页：三模式切换
  location.hash = '#/publish'
  await wait(800)
  check('默认拍摄模式有取景器', !!document.querySelector('.pub__viewfinder'), 'true')
  const textMode = [...document.querySelectorAll('.pub__mode')].find((b) => b.innerText === '文字')
  textMode?.click()
  await wait(400)
  check('文字模式出现输入框', !!document.querySelector('.pub__textarea'), 'true')
  check('文字模式按钮为发布', document.querySelector('.pub__send')?.innerText, '发布')
  const voiceMode = [...document.querySelectorAll('.pub__mode')].find((b) => b.innerText === '语音')
  voiceMode?.click()
  await wait(400)
  check('语音模式出现波形', document.querySelectorAll('.pub__wave span').length, 28)

  // 5) 图片预览：翻页
  location.hash = '#/media?post=p4&i=0'
  await wait(700)
  const counter = document.querySelector('.media__counter')?.innerText?.trim()
  const next = [...document.querySelectorAll('.media__navbtn')].find((b) => b.innerText.includes('下一张'))
  next?.click()
  await wait(400)
  check('预览翻页', document.querySelector('.media__counter')?.innerText?.trim() !== counter, 'true')

  // 6) 评论页：发评论
  location.hash = '#/comments?id=p1'
  await wait(700)
  const c0 = document.querySelectorAll('.cd__list .cmt').length
  const cInput = document.querySelector('.feed__input')
  setInput(cInput, '同款，我也想去')
  await wait(200)
  document.querySelector('.cd__send')?.click()
  await wait(400)
  check('发评论后条数', document.querySelectorAll('.cd__list .cmt').length, c0 + 1)

  // 7) 校园圈：刷新出内容
  location.hash = '#/feedlist'
  await wait(700)
  check('初始为错误态', !!document.querySelector('.fl__error'), 'true')
  document.querySelector('.fl__retry')?.click()
  await wait(600)
  check('刷新后卡片数', document.querySelectorAll('.pcard').length > 0, 'true')

  // 8) 留言板：发留言
  location.hash = '#/board'
  await wait(700)
  const bInput = document.querySelector('.board__input')
  setInput(bInput, '有人在二食堂见过我的卡吗')
  await wait(200)
  document.querySelector('.board__send')?.click()
  await wait(400)
  check('留言后便签数', document.querySelectorAll('.note').length, 1)

  // 9) 扫码：识别完成后按钮可用
  location.hash = '#/scanner'
  await wait(6000)
  check('扫码识别完成', !!document.querySelector('.scan__ok'), 'true')
  check('识别后按钮文案', document.querySelector('.scan__result')?.innerText, '查看扫描结果')

  // 10) 升级弹窗：跳转
  location.hash = '#/upgrade'
  await wait(700)
  const later = [...document.querySelectorAll('.up__actions button')].find((b) => b.innerText.includes('稍后'))
  later?.click()
  await wait(600)
  check('稍后再说 → 校园页', location.hash, '#/campus')

  const failed = results.filter((r) => r.结果 === 'FAIL')
  return { 总计: results.length, 通过: results.length - failed.length, 失败项: failed, 明细: results }
})()
