/**
 * 设备侧 TLS 探测（M2）—— 在 APK 的 WebView 里执行，验证审核记录 05 的 TLS Gate 第 1/3 条。
 *
 * 三件事：
 *   1. https://<IP>/api/health 必须 200（证明 APK 内置的私有 CA 真的生效：
 *      trust-anchors 加对了、IP SAN 也匹配）
 *   2. http://<IP>/api/health 必须**失败**（明文不再可用）
 *   3. 报告页面来源与失败原因，便于区分是"证书不受信"还是"明文被拦"
 *
 * 关于第 2 条的归因说明：
 *   现在 WebView 页面来源是 https://localhost，allowMixedContent 已关闭，
 *   所以 http:// 请求会先被"混合内容"策略拦掉；即便它过了，Network Security Config
 *   的 cleartextTrafficPermitted="false" 也会拦。两者都导致"明文不可用"这个结论，
 *   这里如实报告实际观察到的是哪一种，不假装区分得很精确。
 *
 * 用法：node tools/device-eval.mjs --file scripts/m2/device-tls-probe.js
 */
(async () => {
  const IP = '8.148.156.146'
  const out = {
    origin: location.origin,
    hash: location.hash,
  }

  // 1) HTTPS + 私有 CA
  try {
    const res = await fetch(`https://${IP}/api/health`)
    out.https = { status: res.status, body: (await res.text()).slice(0, 100) }
  } catch (err) {
    out.httpsError = `${err.name}: ${err.message}`
  }

  // 1b) HTTPS 就绪检查（readiness）
  try {
    const res = await fetch(`https://${IP}/api/ready`)
    out.httpsReady = { status: res.status, body: (await res.text()).slice(0, 100) }
  } catch (err) {
    out.httpsReadyError = `${err.name}: ${err.message}`
  }

  // 2) 明文必须不可用
  try {
    const res = await fetch(`http://${IP}/api/health`)
    out.cleartext = { status: res.status, note: '明文请求竟然成功了 —— 与预期不符' }
  } catch (err) {
    out.cleartextError = `${err.name}: ${err.message}`
  }

  // 2b) 未内置 CA 的地址（用系统 CA 签的真实站点）作为对照：
  //     证明 WebView 的 TLS 校验是工作的，而不是"什么都放行"
  try {
    const res = await fetch('https://example.com/', { mode: 'no-cors' })
    out.systemTrustedSite = { ok: true, type: res.type }
  } catch (err) {
    out.systemTrustedSiteError = `${err.name}: ${err.message}`
  }

  // 3) 应用层是否已经用 https（看客户端实际打到哪儿）
  out.localStorageKeys = Object.keys(localStorage)

  return out
})()
