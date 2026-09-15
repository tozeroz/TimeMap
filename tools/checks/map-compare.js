// 与上一次 map-snapshot 的快照对比：拖拽 → 中心移动；缩放 → zoom 变化。
// 关键点：在线底图的缩放/惯性动画在 MuMu 的 WebView 上可能跑 1~2 秒，
// 所以这里轮询等待（最多 6 秒），而不是靠调用方 sleep 一个拍脑袋的时长。
(async () => {
  const before = window.__mapSig ?? null
  const read =
    window.__mapRead ??
    (() => {
      const host = document.querySelector('.realmaps')
      return {
        mode: host?.dataset.provider ?? (document.querySelector('.map__world') ? 'offline' : 'none'),
        center: host?.dataset.center ?? null,
        zoom: host?.dataset.zoom ? Number(host.dataset.zoom) : null,
        markers: document.querySelectorAll('.rm, .map__marker').length,
        first: null,
        spread: null,
      }
    })

  const measure = () => {
    const now = read()
    const [bLat, bLng] = (before?.center ?? '').split(',').map(Number)
    const [nLat, nLng] = (now.center ?? '').split(',').map(Number)
    const centerMovedM =
      Number.isFinite(bLat) && Number.isFinite(nLat)
        ? Math.round(
            Math.hypot(nLat - bLat, nLng - bLng) * 111000,
          )
        : null
    const zoomDelta = before?.zoom != null && now.zoom != null ? Number((now.zoom - before.zoom).toFixed(2)) : null
    const moved =
      before?.first && now.first
        ? Math.round(Math.hypot(now.first.x - before.first.x, now.first.y - before.first.y))
        : null
    const spreadRatio =
      before?.spread && now.spread ? Number((now.spread / before.spread).toFixed(2)) : null
    return {
      mode: now.mode,
      zoomBefore: before?.zoom ?? null,
      zoomAfter: now.zoom,
      zoomDelta,
      centerMovedM,
      moved,
      spreadRatio,
      changed:
        Math.abs(zoomDelta ?? 0) > 0.5 ||
        (centerMovedM ?? 0) > 20 ||
        (moved ?? 0) > 30 ||
        (spreadRatio !== null && Math.abs(spreadRatio - 1) > 0.08),
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
