// 与上一次 map-snapshot 的快照对比：拖拽 → moved 变大；缩放 → spreadRatio 偏离 1。
// 关键点：Leaflet 的缩放/惯性动画在 MuMu 的 WebView 上可能跑 1~2 秒，
// 所以这里轮询等待（最多 6 秒），而不是靠调用方 sleep 一个拍脑袋的时长。
(async () => {
  const sig = () => {
    const boxes = [...document.querySelectorAll('.rm, .map__marker')]
      .slice(0, 4)
      .map((n) => {
        const b = n.getBoundingClientRect()
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
      })
    return {
      hash: location.hash,
      mode: document.querySelector('.leaflet-container')
        ? 'online'
        : document.querySelector('.map__world')
          ? 'offline'
          : 'none',
      markers: boxes.length,
      first: boxes[0] ?? null,
      spread:
        boxes.length >= 2 ? Math.round(Math.hypot(boxes[1].x - boxes[0].x, boxes[1].y - boxes[0].y)) : null,
    }
  }

  const before = window.__mapSig ?? null
  const measure = () => {
    const now = sig()
    const moved =
      before?.first && now.first
        ? Math.round(Math.hypot(now.first.x - before.first.x, now.first.y - before.first.y))
        : null
    const spreadRatio =
      before?.spread && now.spread ? Number((now.spread / before.spread).toFixed(2)) : null
    return {
      mode: now.mode,
      moved,
      spreadRatio,
      spreadBefore: before?.spread ?? null,
      spreadAfter: now.spread,
      changed:
        (moved ?? 0) > 30 || (spreadRatio !== null && Math.abs(spreadRatio - 1) > 0.08),
      now,
    }
  }

  const deadline = Date.now() + 6000
  let result = measure()
  while (!result.changed && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
    result = measure()
  }

  window.__mapSig = result.now
  delete result.now
  return result
})()
