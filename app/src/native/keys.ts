/**
 * 第三方地图 Key。
 *
 * **仓库里不放真 Key**：
 * - 本文件只保留占位符；
 * - 真 Key 放在 `app/.env.local`（已被 .gitignore 的 `*.local` 忽略，不进 git）；
 * - Vite 构建时把 `import.meta.env.VITE_*` 注入进来。
 *
 * 为什么这么处理：这两家都是**前端 JS SDK**，Key 最终必然随包发到客户端 ——
 * 这是它们的产品设计（所以它们用「域名白名单 + 安全密钥」，而不是服务端签名）。
 * 但「随包下发」不等于「应该公开在 GitHub 上」：公开仓库里的 Key 会被爬虫扫走，
 * 直接消耗你的配额。
 *
 * 首次使用：复制 `app/.env.example` 为 `app/.env.local`，填上自己的 Key，
 * 然后 `pnpm build && npx cap sync android` 重新打包。
 * 没配也能跑：地图会自动跳过官方 SDK，直接走不需要 Key 的栅格瓦片 / 离线自绘底图。
 */
const env = import.meta.env

/** 未配置时用占位符 */
export const TENCENT_MAP_KEY = (env.VITE_TENCENT_MAP_KEY as string | undefined)?.trim() || 'YOUR_TENCENT_MAP_KEY'
export const AMAP_JS_KEY = (env.VITE_AMAP_JS_KEY as string | undefined)?.trim() || 'YOUR_AMAP_JS_KEY'
export const AMAP_SECURITY_CODE =
  (env.VITE_AMAP_SECURITY_CODE as string | undefined)?.trim() || 'YOUR_AMAP_SECURITY_CODE'

/**
 * 是否已配好自己的 Key。
 * 没配就别去请求官方 SDK 了 —— 省掉一次注定失败的等待，直接降级到栅格瓦片。
 */
export const hasTencentKey = (): boolean => !TENCENT_MAP_KEY.startsWith('YOUR_')
export const hasAmapKey = (): boolean => !AMAP_JS_KEY.startsWith('YOUR_')
