-- 040_release_1_4_1：把「检查更新」指向 1.4.1。
--
-- 先上传 APK，再执行这条迁移：`/api/app/release` 会立刻把用户导到新地址，
-- 地址上还没有文件时用户会看到 404。tools/release-apk.ps1 的顺序也是先传后改。
update app_release
   set latest_version = '1.4.1',
       apk_url        = 'http://8.148.156.146/download/campus-demo-1.4.1.apk',
       notes          = '演示版本 1.4.1（本仓库自行构建并托管）。相对 1.3.3：修复地图上点帖子卡片无法进入帖子详情（触摸路径不触发 click、标记命中盒错位、标签压住卡片）；并合入热门排序（点击量 + 行为驱动份额分配）与匿名发帖。',
       updated_at     = now()
 where active = true
   and latest_version <> '1.4.1';
