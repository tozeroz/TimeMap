-- 039_release_1_3_4：把「检查更新」指向 1.3.4。
--
-- 先上传 APK，再执行这条迁移：`/api/app/release` 会立刻把用户导到新地址，
-- 地址上还没有文件时用户会看到 404。tools/release-apk.ps1 的顺序也是先传后改。
update app_release
   set latest_version = '1.3.4',
       apk_url        = 'http://8.148.156.146/download/campus-demo-1.3.4.apk',
       notes          = '演示版本 1.3.4（本仓库自行构建并托管）。修复：在地图上点帖子卡片不再被当成「点地点」而打开地点抽屉，恢复跳转到该帖子详情；图钉/地点名仍然是打开地点抽屉。',
       updated_at     = now()
 where active = true
   and latest_version <> '1.3.4';
