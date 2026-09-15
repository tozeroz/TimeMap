// 发布页拍摄模式的结构与状态（真机）。
// 相机能不能出画面取决于设备：模拟器没有摄像头，应当优雅降级但仍然保持正确形态。
// 除了原始字段，这里还给出若干 ASCII 布尔结论，方便 acceptance.ps1 直接断言
// （acceptance.ps1 必须保持纯 ASCII，不能直接匹配中文）。
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const EXPECT_KEYS = ['相册', '拍摄', '切换前后置摄像头']
  const EXPECT_TABS = ['语音', '拍摄', '文字']
  return wait(0)
    .then(() => {
      location.hash = '#/campus'
      return wait(500)
    })
    .then(() => {
      location.hash = '#/publish'
      return wait(3000)
    })
    .then(() => {
      const video = document.querySelector('.pub__video')
      const center = (el) => {
        const r = el.getBoundingClientRect()
        return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]
      }
      const controlEls = [...document.querySelectorAll('.pub__controls > *')]
      const controls = controlEls.map((b) => ({
        aria: b.getAttribute('aria-label') ?? (b.innerText || '').trim(),
        disabled: b.disabled ?? null,
        center: center(b),
      }))
      const order = controls.map((c) => c.aria)
      const tabs = [...document.querySelectorAll('.pub__mode')].map((b) => b.innerText)
      const fallbackText = document.querySelector('.pub__camFallbackText')?.innerText ?? null
      const fallbackVisible = !!document.querySelector('.pub__camFallback')
      const camState = video?.dataset.camState ?? null

      return {
        camState,
        facing: video?.dataset.facing ?? null,
        hasStream: !!video?.srcObject,
        videoSize: video ? [video.videoWidth, video.videoHeight] : null,
        fallbackText,
        fallbackVisible,
        controls,
        controlOrder: order.join('|'),
        modeTabs: tabs,
        poi: document.querySelector('.pub__poi')?.innerText?.trim() ?? null,
        gridlines: !!document.querySelector('.pub__gridlines'),
        zoomPills: [...document.querySelectorAll('.pub__zoom')].map((b) => b.innerText),
        // ---- ASCII 结论，给 acceptance.ps1 用 ----
        threeKeysOk: order.length === 3 && order[0] === EXPECT_KEYS[0] && order[1] === EXPECT_KEYS[1],
        lastKeyIsFlip: order[2] === EXPECT_KEYS[2],
        tabsOk: tabs.length === 3 && tabs.join('|') === EXPECT_TABS.join('|'),
        poiOk: !!document.querySelector('.pub__poi')?.innerText?.trim(),
        hasVideoEl: !!video,
        // 有摄像头就应该是 live，没有就必须给出可读的降级说明（不能是黑屏）
        camHandled: camState === 'live' || (camState === 'error' && fallbackVisible && !!fallbackText),
      }
    })
})()
