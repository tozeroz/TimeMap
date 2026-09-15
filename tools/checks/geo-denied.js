// 未授权定位时的表现（前置：adb pm revoke 掉定位权限）
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  location.hash = '#/campus'
  await wait(700)
  location.hash = '#/map'
  await wait(1500)

  const modalTitle = document.querySelector('.map__modal-title')?.innerText ?? null
  const modalDesc = document.querySelector('.map__modal-desc')?.innerText ?? null
  const btnTexts = [...document.querySelectorAll('.map__modal-btn')].map((b) => b.innerText)

  // 1) 点“暂时不要”：弹窗关闭，应出现“未授权定位”提示条，蓝点退回校园中心
  document.querySelector('.map__modal-btn')?.click()
  await wait(1500)
  const badge = document.querySelector('.map__geoBadge')
  const afterDecline = {
    提示条文案: badge?.innerText ?? null,
    可点击: badge?.tagName === 'BUTTON',
    蓝点是校园兜底: document.querySelector('.rm__here')?.dataset.real === '0',
    弹窗已关闭: !document.querySelector('.map__modal'),
    在线地图仍在: !!document.querySelector('.realmaps'),
    底图来源: document.querySelector('.realmaps')?.dataset.provider ?? null,
  }

  // 2) 点提示条：应把说明弹窗找回来
  badge?.click()
  await wait(800)
  const modalBack = !!document.querySelector('.map__modal')

  // 3) 再点“授权”：走真正的系统权限申请
  document.querySelector('.map__modal-btn--primary')?.click()
  await wait(4000)
  const badgeAfter = document.querySelector('.map__geoBadge')?.innerText ?? null
  const here = document.querySelector('.rm__here')

  return {
    弹窗标题: modalTitle,
    弹窗说明: modalDesc,
    弹窗按钮: btnTexts,
    ...afterDecline,
    点提示条后弹窗回来: modalBack,
    点授权后提示条: badgeAfter,
    点授权后蓝点是真实定位: here?.dataset.real === '1',
    点授权后坐标: here ? [here.dataset.lat, here.dataset.lng] : null,
  }
})()
