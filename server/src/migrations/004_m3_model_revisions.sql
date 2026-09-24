-- 004_m3_model_revisions：M3 由真实入口观察反推出的模型修订
--
-- 依据：docs/m3/MODEL-VALIDATION.md 与 docs/original-baseline/supplements/{schools,at-panel}.json
--
-- **只包含已观察到证据的修订**（审核原则：Observed fact ≠ forward-compatible guess）。
-- 明确**不**在这里加的（登记在 MODEL-VALIDATION.md 2.6，等对应阶段）：
--   - messages.kind（text/image…）+ 媒体引用        → M4（媒体）
--   - 消息提及关系（@某人 / @所有人）               → M4（群聊写入）
--   - board_notes 的真实关系                        → 待观察留言板

-- ---------------------------------------------------------------------------
-- 学校 / 校区
--
-- 观察证据（supplements/schools.json）：
--   1) 校园页/地图页顶部下拉是**当前学校的校区列表**（校本部 / 威海校区 / 东校区）
--   2) 存在专门的「搜索选择学校」页，行格式为「学校名 (校区名)」+ 右侧「N条校园圈」
-- 结论：学校是实体（要建表）；校区是学校下的子实体；**「校园圈」的粒度是 学校 × 校区**。
-- 因此动态归属的不是"学校"，而是"某个校园圈"——本迁移用 school_campus_id 表达。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  region      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schools_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS schools_name_idx ON schools (name);

CREATE TABLE IF NOT EXISTS campuses (
  id          uuid PRIMARY KEY,
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campuses_name_not_blank CHECK (length(btrim(name)) > 0),
  -- 同一学校下校区名不重复（「校本部」在一所学校里只应有一个）
  CONSTRAINT campuses_school_name_uniq UNIQUE (school_id, name)
);

CREATE INDEX IF NOT EXISTS campuses_school_idx ON campuses (school_id);

-- 用户与动态归属到「校园圈」。
-- **可空**：M2 之前的历史数据没有这个信息，按 M2 对 posts.author_id 的同一原则处理 ——
-- 未知就表示未知，不伪造归属。展示层需要的 users.school_name 文本**保留不删**（作为快照）。
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_campus_id uuid
  REFERENCES campuses(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS school_campus_id uuid
  REFERENCES campuses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_school_campus_idx ON users (school_campus_id);
CREATE INDEX IF NOT EXISTS posts_school_campus_created_idx ON posts (school_campus_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 群名长度上限
--
-- 观察证据（supplements/at-panel.json）：创建群聊对话框右下角显示「0/24」
-- —— 即群名上限 24 字。原 M2 只加了非空 CHECK，这里补上长度约束。
-- ---------------------------------------------------------------------------
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_name_max_len;
ALTER TABLE groups ADD CONSTRAINT groups_name_max_len CHECK (length(name) <= 24);

COMMENT ON TABLE campuses IS
  '学校下的校区（如「校本部」「威海校区」「东校区」）。来源：地图页地区下拉 + 「搜索选择学校」页'
  ' 的「学校名 (校区名)」行格式；「校园圈」的粒度是 学校 × 校区（见 docs/m3/MODEL-VALIDATION.md 2.2）';
COMMENT ON COLUMN groups.name IS
  '群名，上限 24 字（来源：原版创建群聊对话框的「0/24」计数）。'
  '注意展示时「群名(N)」的 (N) 是成员数，属展示层拼接，不要存进本字段';
