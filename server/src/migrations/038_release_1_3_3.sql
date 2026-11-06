-- 038_release_1_3_3：把「检查更新」指向 1.3.3。
--
-- 先上传 APK，再执行这条迁移：`/api/app/release` 会立刻把用户导到新地址，
-- 地址上还没有文件时用户会看到 404。tools/release-apk.ps1 的顺序也是先传后改。
update app_release
   set latest_version = '1.3.3',
       apk_url        = 'http://8.148.156.146/download/campus-demo-1.3.3.apk',
       notes          = '演示版本 1.3.3（本仓库自行构建并托管）。相对 1.3.2：新增帖子点击数展示、热度改为行为驱动的份额分配排序、曝光位次埋点（影子）、匿名发帖；并合入他人地图标签分类、活动投稿、用户资料等功能。',
       updated_at     = now()
 where active = true
   and latest_version <> '1.3.3';
