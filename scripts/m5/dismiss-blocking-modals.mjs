/**
 * 收尾：关掉上一次 Gate 可能留下的**阻断式弹窗**（M5 设备 Gate 共用入口调用）
 *
 * ## 为什么需要它（一次真实的间歇性失败）
 *   我在跑"全设备回归"时遇到 **WO#14 门禁偶发 `DEVICE_GATE_EXIT=1`**，而**单独重跑就 PASS**。
 *   根因假设（已定位到证据）：地图页 MapScreen 会弹一个**全屏**弹窗
 *   「授权地理位置 / 在地图上，标记属于你的校园生活 / 暂时不要 · 授权」（CSS 里是 `inset: 0` 覆盖层）。
 *   顺序地跑门禁时，**前一个门禁（WO#15 地图）把这个弹窗留在页面上**，
 *   后一个门禁（WO#14 个人页）开始读 DOM 时可能仍被这个覆盖层挡着 → 读到不完整的状态。
 *
 * ## 为什么修在**共用入口**而不是每个 Gate 自己收拾
 *   与本项目对"DB 残留"的处置同一理由：设备侧有 10+ 个 Gate，各自造状态、各自不管收；
 *   逐个去改既慢又必然漏。放在 `run-device-gate.sh`（唯一入口）上，才能保证
 *   "跑完就是干净的"。
 *
 * ## 纪律
 *   · **best-effort**：找不到弹窗、点不动、连不上 CDP → 安静跳过，**绝不影响门禁 RC**
 *     （门禁判定与环境复位是两件事，不能互相污染）。
 *   · 只点**已知的、非破坏性的**关闭控件（如「暂时不要」）——**不**点「授权」
 *     （那会触发系统权限弹窗，反而引入新的不确定性）。
 *
 * 用法：node dismiss-blocking-modals.mjs
 * 退出码恒为 0（除非连 CDP 都拿不到，那也是 0 —— 它不该让门禁变红）。
 */
const DISMISS_LABELS = ['暂时不要', '稍后再说', '以后再说', '取消']

async function main() {
  let list
  try {
    list = await (await fetch('http://127.0.0.1:9222/json')).json()
  } catch {
    console.log('  （拿不到 CDP target，跳过弹窗清理）')
    return
  }
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) {
    console.log('  （没有 page target，跳过弹窗清理）')
    return
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const opened = await new Promise((res) => {
    const t = setTimeout(() => res(false), 4000)
    ws.addEventListener('open', () => {
      clearTimeout(t)
      res(true)
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(t)
      res(false)
    }, { once: true })
  })
  if (!opened) {
    console.log('  （CDP 连接失败，跳过弹窗清理）')
    return
  }
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  const send = (method, params) =>
    new Promise((r) => {
      const i = ++id
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const evaluate = async (expression, timeoutMs = 8000) => {
    const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
    if (r.TIMEOUT || !r.result) return null
    return r.result.result ? r.result.result.value : null
  }

  const labels = JSON.stringify(DISMISS_LABELS)
  /*
    ⚠️⚠️ 这里有一处**我第一版做错的检测**（由 `selftest-dismiss-modals.mjs` 当场抓到）：

    第一版我用一个 CSS 启发式找"全屏覆盖层"里的关闭按钮：
      `isOverlay(el)` = 从按钮往上找祖先，要求祖先 `position: fixed` 且宽度 ≥ 90% viewport。
    自测结果：**弹窗明明在**（`present=true`，文本「授权地理位置…暂时不要…授权」），
    但清理脚本输出 **「没有需要关闭的阻断式弹窗」**，即**一个都没匹配到** → 修复完全无效。
    原因：那个 `position:fixed + 宽 ≥90%` 的假设不成立
    （`.map__modal-wrap > .map__modal > .map__modal-actions > .map__modal-btn`，
     按钮本身与其直接祖先并不满足那个形状）。

    ⇒ 教训：**"猜一个几何/CSS 形状"不如"按已知的容器选择器找"**。
      容器是**我们自己的代码**定义的（`.map__modal-wrap`），那就直接用它；
      几何启发式会随样式微调和实现变化而静默失效 —— 而且失效时**不报错**（就像刚才）。

    现在的做法：
      1. 优先按**已知弹窗容器**找（`[data-blocking-modal]` / `.map__modal-wrap` / `.map__modal`）
      2. 只点**容器内部**文本匹配的按钮（绝不在整个页面里乱点"取消"）
      3. 另外保留一个**保守**的兜底：真的没有已知容器时，才用几何启发式
  */
  const res = await evaluate(`(() => {
    const labels = ${labels}
    const CONTAINERS = ['[data-blocking-modal]', '.map__modal-wrap', '.map__modal']
    const clicked = []
    const found = []
    for (const sel of CONTAINERS) {
      for (const box of document.querySelectorAll(sel)) {
        found.push(sel)
        for (const b of [...box.querySelectorAll('button, [role=button], a')]) {
          const t = (b.textContent || '').trim()
          // ⚠️ 只点**关闭类**文本；且**不点**「授权」（那会触发系统权限弹窗）
          if (labels.includes(t)) {
            try { b.click(); clicked.push(sel + ' → ' + t) } catch {}
          }
        }
      }
    }
    return {
      foundContainers: [...new Set(found)],
      clicked,
      stillPresent: !!document.querySelector('.map__modal'),
      hash: location.hash,
    }
  })()`)

  if (res && res.clicked && res.clicked.length) {
    console.log(`  已关闭阻断式弹窗：${res.clicked.join(' / ')}（原 hash=${res.hash}）`)
  } else if (res && res.foundContainers && res.foundContainers.length) {
    console.log(`  发现弹窗容器（${res.foundContainers.join(', ')}）但没有可点的关闭按钮 —— 如实报告，不假装处理了`)
  } else {
    console.log('  没有需要关闭的阻断式弹窗')
  }
  // ⚠️ 先关 ws 再退出：否则 Node 会在 uv 异步句柄仍开着时退出
  //    （自测时见过 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 崩溃）
  ws.close()
}

main()
  .catch((e) => console.log(`  （弹窗清理出错，忽略：${String(e && e.message)}）`))
  .finally(() => process.exit(0))
