import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。
 * - appId 故意与目标 app（com.kairuotu.campus）区分，避免覆盖模拟器上的原版应用
 * - webDir 指向 Vite 构建产物
 * - 纯本地 demo：不做任何网络请求
 */
const config: CapacitorConfig = {
  appId: 'com.campusx.demo',
  appName: '校园',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
