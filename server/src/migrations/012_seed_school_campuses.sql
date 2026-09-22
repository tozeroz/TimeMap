-- ---------------------------------------------------------------------------
-- WO#16 层 B（审核 61 APPROVED TO IMPLEMENT）：种下**有基线观察证据**的学校与校区
--
-- ⚠️ 本迁移的定位：**baseline-derived fixture**，不是从任何生产系统同步来的。
--    审核 60 明确要求："建议 seed metadata/provenance 明确写 baseline-derived fixture，
--    以后不会被误认为从生产系统同步而来。"
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 只种什么、**不**种什么（审核 60/61 的硬边界）
-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ 允许种：**实体本身**（学校 与 校区）—— 因为它们有明确的原版观察证据
--    证据：docs/original-baseline/supplements/schools.json
--          campus_picker = 标题「北京交通大学（当前学校）」+ 校本部 / 威海校区 / 东校区
--          ⇒ `seed entity existence: SUPPORTED BY BASELINE`
--
-- ❌ **不得**顺手种（审核原文：这些一律 "DO NOT INFER"）：
--    · users.school_campus_id        —— 用户属于哪个校区，无依据
--    · posts.school_campus_id        —— 动态属于哪个校区，无依据
--    · campus post counts            —— 不得把原版的 4/15/329/2502 当作我们的计数
--    · 当前选中的校区（current selected campus）
--    ⚠️ 尤其：`posts.place_id → places.name = '北京交通大学'` 只说明一个**地理 POI**，
--       **推不出** `school_campus = 校本部`（这正是 Gate PLACE_DOES_NOT_IMPLY_CAMPUS 守的线）
--
-- ❌ 也**不**种其他学校（清华/北大/复旦/…）与它们的人数：
--    那些是**原版某次真实数据快照**，不是我们 demo 必须复制的数据集。
--    审核 61：`SEARCH_CONTENT_SCALE_DIFFERENCE: ACCEPTABLE / DOCUMENTED`
--    ⇒ 我们的学校搜索页内容**会比原版少**，这是**数据驱动的差异**，不是实现缺陷。
--
-- ⚠️ UUID 用**固定值**（便于迁移可重复执行与测试引用，且一眼能看出是种子数据）：
--    学校   b0000000-0000-4000-8000-00000000000s
--    校区   b0000000-0000-4000-8000-00000000000c 系（这里用 1/2/3 区分三校区）
-- ---------------------------------------------------------------------------

insert into schools (id, name) values
  ('b0000000-0000-4000-8000-000000000001', '北京交通大学')
on conflict (id) do nothing;

-- 三个校区名**逐字**取自基线观察（校本部 / 威海校区 / 东校区）
insert into campuses (id, school_id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '校本部'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', '威海校区'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', '东校区')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 复核（迁移自检）：实体数量应为 1 校 / 3 校区；且**归属列必须仍为 0**
--   ⚠️ 后者是本迁移的**关键约束**：种实体**不**等于种归属。
-- ---------------------------------------------------------------------------
do $$
declare
  n_schools int;
  n_campuses int;
  n_post_attr int;
  n_user_attr int;
begin
  select count(*) into n_schools from schools;
  select count(*) into n_campuses from campuses;
  select count(*) into n_post_attr from posts where school_campus_id is not null;
  select count(*) into n_user_attr from users where school_campus_id is not null;

  raise notice 'seed: schools=% campuses=% posts_with_campus=% users_with_campus=%',
    n_schools, n_campuses, n_post_attr, n_user_attr;

  if n_post_attr <> 0 or n_user_attr <> 0 then
    raise exception '本迁移只许种实体，不得产生任何 campus 归属（posts=% users=%）',
      n_post_attr, n_user_attr;
  end if;
end $$;
