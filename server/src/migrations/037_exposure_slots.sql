/*
  037（2026-11-06）：曝光位置与会话。

  为什么需要（方案见 docs/zjx/热度排序方案-行为驱动份额分配-2026-11-06.md）：
    · 同一条帖子放第 1 槽和第 18 槽，点击率能差 3–5 倍。如果不知道曝光发生在第几槽，
      算出来的"点击率"其实是"位置带来的点击率"，拿它做质量门会误杀好内容。
    · session_id 用来区分"一个人刷新十次"和"十个不同的人各看一次"，也是后续按会话
      去重、识别刷量行为的基础。

  这一段只加数据、不改任何排序逻辑（影子模式）：排序仍然看 post_daily_stats 的
  曝光/点开汇总，本表的 slot/surface 目前只用于分析。
*/
alter table post_events
  add column if not exists slot smallint,
  add column if not exists surface text,
  add column if not exists session_id uuid;

comment on column post_events.slot is
  '本次曝光的视觉位次（1 = 第一屏第一个），用于位置偏差分析；同一人同一天只记第一次看到的位次';
comment on column post_events.surface is
  '曝光发生在哪个界面：campus / place / favorites / myposts / user / map';
comment on column post_events.session_id is
  '浏览器会话 id（客户端 sessionStorage 生成），用于区分"同一人多次"与"多人各一次"';

-- 位置分析的主查询形态：某天某界面的第 N 槽有多少曝光、点开率多少
create index if not exists post_events_surface_slot_idx
  on post_events (surface, day, slot);
