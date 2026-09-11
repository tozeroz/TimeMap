// 读取地图当前变换（用于拖拽前后对比）
(async () => {
  const world = document.querySelector('.map__world')
  return {
    transform: world ? getComputedStyle(world).transform : null,
    hash: location.hash,
  }
})()
