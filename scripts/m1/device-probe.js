/**
 * 设备侧探测（M1）：在真机/模拟器的 APK WebView 里执行，验证三件事
 *   1) 页面来源确实是 https://localhost（混合内容的前提）
 *   2) WebView 能否真的 fetch 到 http://8.148.156.146/api/posts
 *      —— 这一步失败就说明混合内容/明文策略没配对，是真机上"发不出去"的根因
 *   3) 校园页正文里是否已经渲染出服务器帖子
 * 用法：node tools/device-eval.mjs --file scripts/m1/device-probe.js
 */
(async () => {
  const out = {
    origin: location.origin,
    hash: location.hash,
    localStorageKeys: Object.keys(localStorage),
  }

  try {
    const res = await fetch('http://8.148.156.146/api/posts')
    const text = await res.text()
    out.fetch = { status: res.status, body: text.slice(0, 200) }
  } catch (err) {
    out.fetchError = `${err.name}: ${err.message}`
  }

  try {
    const res = await fetch('http://8.148.156.146/api/ready')
    out.ready = { status: res.status, body: (await res.text()).slice(0, 120) }
  } catch (err) {
    out.readyError = `${err.name}: ${err.message}`
  }

  out.bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500)
  return out
})()
