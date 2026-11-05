-- 匿名发帖（2026-11-05，迁移 035）
--
-- 需求：发布时可以勾选「匿名发布」；匿名帖在所有公开展示面统一显示为
-- 「匿名同学」+ 系统头像。
--
-- 为什么是「加一列布尔」而不是「把 author_name 改写成匿名同学」：
--   · 审核/举报/作者本人管理仍然需要能定位到真实发布者（posts.author_id 不动）
--   · 读模型遮罩（server/src/anonymous.ts）可以随时调整口径（例如以后允许
--     "匿名但保留 ID 可查"），而把真名覆盖掉就再也恢复不了
--   · 历史帖子默认 false，行为与之前完全一致（无需数据回填）
alter table posts
  add column if not exists is_anonymous boolean not null default false;

-- 作者自己的「我的发布」、管理端审核都会按作者过滤，加个索引不吃亏。
create index if not exists posts_author_created_idx
  on posts (author_id, created_at desc);

comment on column posts.is_anonymous is
  '匿名发布：true 时读模型把 author 遮罩为「匿名同学」，authorId 只返回给作者本人';
