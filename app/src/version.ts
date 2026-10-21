/**
 * App 版本 —— **单一事实来源**。
 *
 * ⚠️ 这个值必须与 `app/android/app/build.gradle` 里的 `versionName` **一致**。
 *    两者不一致会让"检查更新"比错版本（例如永远提示有更新）。
 *    ⇒ 该一致性由门禁**机械校验**（`gate-wo23-update-check.mjs` 的
 *      `APP_VERSION_MATCHES_ANDROID`），不靠人记得同步。
 *
 * 为什么不装 `@capacitor/app` 去读原生版本：
 *   · 那会多一个**原生插件**（要 cap sync + gradle 重建），而这里只是要一个版本号
 *   · 用常量 + 机械校验，既没有额外依赖，也不会"悄悄漂移"（漂移会被门禁抓住）
 */
export const APP_VERSION = '1.3.1'
