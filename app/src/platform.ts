/**
 * 平台判定（**单一定义**，避免多处各写一份而漂移）
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么要有这个模块
 * ════════════════════════════════════════════════════════════════════
 * 引入网页端（WO#25）后，「我是不是跑在原生壳里」变成了**多处都要问**的问题：
 *   · Shell       —— 要不要画模拟状态栏 / 留系统状态栏高度
 *   · index.html  —— 要不要放开缩放
 *   · 更新弹窗    —— 能不能提供「下载 APK 自更新」这个动作（⚠️ 网页端**不能**）
 * 若各写一份判定，它们的口径迟早会漂移（例如一处用 Capacitor、一处用 hostname）。
 * ⇒ 收敛到一处，并**同时**用两个独立信号判断，任一命中即视为原生壳。
 *
 * ⚠️ 为什么不能只看 `window.Capacitor`：
 *   原生桥的脚本**注入时机不由我们控制**，在 `<head>` 里问它可能还没到；
 *   那时会把原生壳误判成网页端（实测踩过：会让 App 的缩放被放开、
 *   以及**让 App 误以为自己是网页端而隐藏 APK 更新入口**）。
 * ⚠️ 为什么还要看 hostname：
 *   Capacitor 的页面源固定是 `https://localhost`（androidScheme 的既定行为），
 *   这一点与桥是否已注入无关，可作为**独立**判据。
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.location.hostname === 'localhost') return true
  } catch {
    /* 取不到 location 时继续看 Capacitor */
  }
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform() === true
}

/** 是否作为**浏览器网页端**运行（原生壳之外的一切情况） */
export function isWebClient(): boolean {
  return !isNativeShell()
}
