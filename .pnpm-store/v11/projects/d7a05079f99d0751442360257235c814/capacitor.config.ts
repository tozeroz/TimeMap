import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。
 * - appId 用 TimeMap 自己的包名（与参考应用 com.kairuotu.campus 区分，互不覆盖）
 * - webDir 指向 Vite 构建产物
 * - 地图瓦片 / SDK 需要联网，因此保留网络能力；其余数据全部本地
 */
const config: CapacitorConfig = {
  appId: 'com.bjtu.timemap',
  appName: 'BJTU TimeMap',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
