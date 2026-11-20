# FoodTime Neo 图片导入记录

2026-11-20，按用户提供的图片更新本地及远程数据库，项目地址为 https://github.com/FoodtimeNeo/FoodtimeNeo-Web 。

| 用途 | 资源文件 | 图片尺寸 | 媒体 ID |
| --- | --- | --- | --- |
| 列表封面 | `assets/training-projects/foodtime-neo/logo.jpg` | 223 × 197 | `9c0291c2-c0a0-5368-a984-fdcbe522699c` |
| 详情展示图 | `assets/training-projects/foodtime-neo/poster.jpg` | 682 × 896 | `16e24838-edf3-55c8-ac55-054218b9b201` |

项目 ID：`c1a55000-2026-4000-8000-000000000009`。封面与展示图独立设置，展示图位置为 0。保留原始像素、比例及内容，仅移除 JPEG 结束标记之后的微信附加字节；来源校验信息保存在同目录 `manifest.json`。

导入工具为 `server/src/importProjectArtwork.ts`：校验数据库目标、图片格式及现有管理员；事务内关联媒体，导入前备份项目记录；相同媒体不会重复插入。远程图片存放在 `/srv/campus/uploads/public/project-artwork/`。

远程导入前完整数据库备份：`/srv/campus/backups/foodtime-artwork-before-20261120-091846.dump`。

远程项目关联备份：`/srv/campus/backups/foodtime-artwork-associations-before-20261120-091846.json`。

远程补齐了详情图片所需的 `041_project_details` 数据库迁移及迁移校验记录，未发布前后端代码。

验证结果：本地接口、列表封面、详情海报及点击放大通过；远程数据库媒体关联正确；通过线上 Nginx 图片接口读取的两张图片 SHA-256 与导入文件一致；后端服务健康检查正常。导入时因 umask 导致的新目录读取权限已修正，导入工具也已显式设置目录权限。

本地页面截图保存在 `docs/zwf/evidence/foodtime-artwork/`。
