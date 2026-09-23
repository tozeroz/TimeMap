-- ---------------------------------------------------------------------------
-- WO#23 收尾（Owner 裁定 ③：App 自更新必须实现体验等价）：发布 1.1 并托管真实安装包
--
-- ⚠️ 为什么用**迁移**而不是直接 UPDATE 数据库：
--   直接改库会让"仓库"与"线上实际状态"脱节（drift）—— 本项目刚刚因此吃过一次亏
--   （见 ops/nginx/campus-locations.inc 顶部记录的那次：仓库副本 23 行、服务器 99 行）。
--   ⇒ 凡是**需要长期成立的状态**，都要能从仓库重建。
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 这次发布的是什么（如实说明，不夸大）
-- ═══════════════════════════════════════════════════════════════════════════
--   · latest_version = '1.1' —— 与 `app/src/version.ts` 的 APP_VERSION **一致**、
--     也与 `app/android/app/build.gradle` 的 versionName **一致**（两处一致由门禁机械校验）
--   · apk_url = http://8.148.156.146/download/campus-demo-1.1.apk
--     —— 这是我们**自己构建并托管**的 APK（Nginx `/download/` 静态下发，
--        MIME = application/vnd.android.package-archive）。
--     ⚠️ 用 **http**（不是 https）是**有意**的：线上是**私有 CA 自签证书**，
--        浏览器/下载器会对 APK 下载给出证书告警；而 80 端口在同一份配置里可用
--        （campus.conf 的两个 server 块 include 同一份 locations）。
--        ⇒ 这是**已知取舍**，不是疏忽。
--   · notes 写清这是什么，**不写**编造的"功能亮点"。
--
-- ⚠️ 本迁移**幂等**：只在当前"生效行"的版本还不是 1.1 时更新；重复执行无副作用。
--    ⚠️ 这里修过一处**我自己的错误**：初版写了 `where inactive_guard IS NULL`
--       —— 该列**不存在**（表里只有 `active boolean`）。写 SQL 时想当然地加了一个
--       "防呆列"，如果没被 typecheck/迁移执行拦住就会在部署时炸。
--       ⇒ 事实来源是 `006_media_scope.sql` 与 014 里的表定义，不是我脑子里的印象。
update app_release
   set latest_version = '1.1',
       apk_url        = 'http://8.148.156.146/download/campus-demo-1.1.apk',
       notes          = '演示版本 1.1（本仓库自行构建并托管）。安装包仅用于验证"检查更新 → 下载安装包"这条链路。',
       updated_at     = now()
 where active = true
   and latest_version <> '1.1';
