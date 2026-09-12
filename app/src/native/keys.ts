/**
 * 第三方地图 Key（由用户在自己的控制台创建）。
 *
 * 为什么要放在源码里：这两家都是**前端 JS SDK**，Key 必然会随包发到客户端 ——
 * 这是它们的产品设计（所以它们才用「授权域名白名单 + 安全密钥」而不是服务端签名）。
 * 真正需要保密的只有高德的「安全密钥」，它同理也只能随包下发，官方要求配白名单使用。
 *
 * 换 key / 吊销：直接改这里，然后 `pnpm build && npx cap sync android` 重新打包。
 */
export const TENCENT_MAP_KEY = 'I75BZ-4Z5O5-LV4IM-IVOTE-CXMJZ-MZFZ4'
export const AMAP_JS_KEY = 'cd0f06820f603647084b7863076b8e57'
export const AMAP_SECURITY_CODE = 'b3d7098a29060cff59ed79f50a47b2e3'
