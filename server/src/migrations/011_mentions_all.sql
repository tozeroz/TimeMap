-- ===========================================================================
-- 011_mentions_all —— 群聊里的"@所有人"（M5 WO#9B 层 B）
--
-- 审核依据：
--   · 记录 48 §3：`messages.mentions_all boolean NOT NULL DEFAULT false` **批准**，
--     迁移编号 011 与"只追加"的方式**正确**（001–010 已应用且校验和冻结）。
--   · 记录 48 §5：**必须明确这是 service transactional invariant，不是 DB CHECK invariant**。
--     因此本迁移**只加列**，不试图用 CHECK 表达"与逐人提及互斥"——
--     那需要跨表（message_mentions）判断，SQL CHECK 表达不了，
--     硬用 trigger 会把简单规则变成隐藏写路径（审核明确说：将来若出现**第二条**
--     数据库写路径，再重新决定是否需要 trigger）。
--
-- ## 为什么用**独立布尔列**而不是"逐人提及的一种特殊形式"
--   既有 message_mentions 的列是：
--       (id, message_id, mentioned_user_id → users(id), created_at)
--     且 UNIQUE (message_id, mentioned_user_id)。
--   `mentioned_user_id` 是**指向 users 的外键** → 要表达"全体"只能塞一个**假的 user 行**，
--   而那正是 AUDIT 里被明确否决的做法（"绝不能伪造成某个 user id：
--   那会让'提到全体'与'提到某人'在数据上无法区分"）。
--   → 因此用独立布尔，与逐人提及**并存但不混同**。
--
-- ## 权限与 direct 的处置（都是**我方设计选择**，不是原版 conformance）
--   · AT_ALL_PERMISSION_POLICY: group member → allowed ／ non-member → 404
--     PROVENANCE: OUR_DESIGN_CHOICE ／ ORIGINAL_AT_ALL_PERMISSION_MODEL: NOT_EVALUATED
--     （thread_members 无角色列；原版是否限制"谁能 @所有人"无证据 ——
--       要观察需触发原版的 @all，而那是写操作 → BLOCKED_BY_POLICY）
--   · MENTIONS_ALL_DIRECT_POLICY: REJECT
--     PROVENANCE: OUR_DESIGN_CHOICE ／ ORIGINAL_BEHAVIOR: NOT_EVALUATED
--     （⚠️ **不**声称"direct 里 @全体 逻辑上不可能" —— 该说法已被审核否决；
--        只是**我方产品选择**不提供该语义）
-- ===========================================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions_all boolean NOT NULL DEFAULT false;

-- 便于将来按"全体提及"筛选（与既有 message_mentions_user_idx 的取向一致：
-- 只为真实会出现的查询建索引，不预先堆索引）。
CREATE INDEX IF NOT EXISTS messages_mentions_all_idx
  ON messages (thread_id, created_at DESC)
  WHERE mentions_all;
