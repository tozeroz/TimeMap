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
     * 必须开：WebView 的页面来源是 https://localhost（见下面的 androidScheme），
     * 而 M1 的后端只有公网 IP、没有证书，接口是 http://8.148.156.146。
     * 「https 页面请求 http 资源」就是混合内容，WebView 默认直接拦掉，
     * 表现为 fetch 立刻失败（TypeError: Failed to fetch），界面上看起来像"发不出去"。
     *
     * 明文本身仍然只对后端那一个 IP 放行，见 android/app/src/main/res/xml/network_security_config.xml。
     * M6 上了 HTTPS 之后，这项应该改回 false。
     */
    allowMixedContent: true,
  },
  server: {
    /**
     * 保持 https：改成 http 虽然能绕开混合内容，但会让页面来源变成 http://localhost，
     * 而摄像头实时取景（getUserMedia）依赖安全上下文，属于已验证功能的回归风险，不值得。
     */
    androidScheme: 'https',
  },
}

export default config
