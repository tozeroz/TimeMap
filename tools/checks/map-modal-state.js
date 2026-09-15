// 弹窗是否还在（用于真实触摸点击之后的断言）
(() => ({
  modalPresent: !!document.querySelector('.map__modal'),
  geoBadge: document.querySelector('.map__geoBadge')?.innerText ?? null,
}))()
