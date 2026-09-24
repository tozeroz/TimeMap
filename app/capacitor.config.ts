import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。
 * - appId 故意与目标 app（com.kairuotu.campus）区分，避免覆盖模拟器上的原版应用
 * - webDir 指向 Vite 构建产物
 * - M1 起会请求后端 API（http://8.148.156.146，见 src/api/client.ts）
 */
const config: CapacitorConfig = {
  appId: 'com.campusx.demo',
  appName: '校园',
  webDir: 'dist',
  android: {
    /**
     * M2 起改为 false。
     *
     * M1 时期之所以必须开：页面来源是 https://localhost，而后端只有公网 IP、没有证书，
     * 接口是 http://8.148.156.146 —— 「HTTPS 页面请求 HTTP 资源」属于混合内容，默认被拦。
     *
     * M2 之后后端已经是 https://8.148.156.146（临时私有 CA + IP SAN 叶子证书，
     * 由 Network Security Config 内置该 CA），页面与接口同为 https，混合内容不复存在，
     * 于是这项临时债与明文例外**同时收回**。
     */
    allowMixedContent: false,
  },
  server: {
    /**
     * 保持 https：改成 http 虽然能绕开混合内容，但会让页面来源变成 http://localhost，
     * 而摄像头实时取景（getUserMedia）依赖安全上下文，属于已验证功能的回归风险，不值得。
     */
    androidScheme: 'https',
  },
  plugins: {
    /**
     * ⭐ SystemBars（Capacitor 8 **内置在 @capacitor/core**，不需要额外装插件）。
     *
     * 解决的是**真机上才暴露的问题**：Android 15+ 对 targetSdk ≥ 35 的应用
     * **强制 edge-to-edge** ⇒ WebView 铺满整屏（含状态栏区域）
     * ⇒ 页面顶栏与状态栏重叠、置顶按钮点不到
     *   （用户在自己手机上实测到；本项目 targetSdk = 36，必然中招）。
     *
     * ⚠️ 为什么**不用** @capacitor/status-bar 的 `overlaysWebView: false`：
     *    官方文档明确写了 "Android 16+ behavior change" —— `overlaysWebView` 与
     *    `backgroundColor` 在 targetSdk 36 上**不再起作用**（系统已强制 edge-to-edge、
     *    不再允许应用 opt-out）。所以那条路在 Android 16 上是**白改一轮**。
     *
     * ⇒ 正解：让 Capacitor 把**可靠**的安全区值注入 CSS。
     *    官方文档指出旧版 Android WebView(<140) 的 `env(safe-area-inset-*)` **值是错的**
     *    （Chromium issue 40699457）；SystemBars 会注入 `--safe-area-inset-*` 作为可靠来源，
     *    我们在 shell.css 里用它为状态栏留出内边距。
     *
     * `css` 是官方默认值，这里**显式写出**：这是**有意的依赖**，不是碰巧生效；
     * 将来若默认值变了，也希望是被人显式改掉的。
     */
    SystemBars: {
      insetsHandling: 'css',
    },
  },
}

export default config
