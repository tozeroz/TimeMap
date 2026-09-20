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
}

export default config
