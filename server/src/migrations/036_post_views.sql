-- 帖子曝光/点击埋点（2026-11-06，迁移 036）
--
-- 需求：首页/地点页要显示「点击数」，并据此改进热度排序。
--
-- 为什么是三张表/两处计数，而不是只加一个 posts.view_count：
--   · 光有绝对点击数，无法区分「曝光 3 次点开 2 次」（好内容）与
--     「曝光 300 次点开 2 次」（被顶到前面但没人想看）——排序要用点击率。
--   · 点击率必须同时有分母（曝光）和分子（点开），所以要按天存两个计数。
--   · 展示用的「点击数」要在列表里按行取，不能每条帖都去聚合子表，
--     因此在 posts 上冗余一个 open_count 计数器（写入时同步维护）。
--
-- 去重口径（防止刷新页面/来回切 tab 把数字刷上去）：
--   · 登录用户按 (帖, 天, 用户) 去重
--   · 未登录用户按 (帖, 天, 客户端 visitorId) 去重
--   两种身份统一落成 post_events 里的一个 subject 文本（'u:<id>' / 'v:<id>'），
--   这样主键只有一种形态，统计 SQL 不用分叉。

alter table posts
  add column if not exists open_count integer not null default 0;

create table if not exists post_events (
  post_id uuid not null references posts(id) on delete cascade,
  day     date not null default current_date,
  subject text not null,
  seen    boolean not null default false,
  opened  boolean not null default false,
  primary key (post_id, day, subject)
);

comment on table post_events is
  '帖子事件去重台账：一行代表「某个访客在某天对某帖曝光过/点开过」。计数靠日统计表，本表只负责不重复计数。';

create table if not exists post_daily_stats (
  post_id     uuid not null references posts(id) on delete cascade,
  day         date not null default current_date,
  impressions integer not null default 0,
  opens       integer not null default 0,
  primary key (post_id, day)
);

comment on table post_daily_stats is
  '帖子按天的曝光/点开计数。热度排序用最近 14 天聚合算点击率，过期明细可整体删除。';

create index if not exists post_daily_stats_day_idx on post_daily_stats (day);
create index if not exists post_events_day_idx on post_events (day);
