-- 048（2026-11-23）：评论点赞。
--
-- 与 likes 表**同型**（唯一约束保证重复请求不重复计数，删除即撤销），但**不能复用**
-- likes：likes.post_id 是 NOT NULL 且外键指向 posts(id)，评论点赞塞进去要么改列可空、
-- 要么伪造 post_id —— 前者让「赞了帖子」和「赞了评论」的计数查询必须处处加
-- `where post_id is not null`（一处漏掉就会把评论赞算成帖子赞），后者直接串数据。
--
-- 为什么不做成「likes 多一列 comment_id」：两个聚合口径完全不同（帖子详情要
-- `count(*) from likes where post_id=$1`，评论树要按 comment_id 分组），分表后
-- 各自的主键/索引都能直接命中，也便于将来给评论赞单独做限额或审计。
--
-- 消息中心（inboxRoutes.ts）把「赞了你的评论」的事件源挂在
-- comments.author_id = 收件人 上，所以 comment_id 必须有索引。
create table comment_likes (
  id          uuid primary key,
  comment_id  uuid not null references comments(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint comment_likes_user_comment_uniq unique (user_id, comment_id)
);

create index comment_likes_comment_idx on comment_likes (comment_id);
