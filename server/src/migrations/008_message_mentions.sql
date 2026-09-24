-- ===========================================================================
-- 008_message_mentions —— M4 的 @ 提及关系（最小闭环）
--
-- 依据：审核记录 16 —— @ mention 在冻结 M4 时就是明确范围
--       （"message kind + media reference + **mention relation**"），
--       不允许推到 M5，否则就是 milestone scope 偷偷漂移。
--
-- 范围**刻意保持最小**（审核要求"不要扩张"）：
--   · 只做"某条消息提到了某个用户"这一条关系
--   · **不做 @所有人**：若将来要做，必须单独明确它的语义，
--     绝不能伪造成某个 user id（那会让"提到全体"和"提到某人"在数据上无法区分）
--
-- 为什么要有这张表而不是把 @ 留在 body 文本里：
--   文本里的 "@某某" 是**展示**，不是**关系**。要判断"我被提到了吗"、
--   发通知、"这条消息提到了不在会话里的人吗"，都必须有结构化数据。
--   这与 comments.parent_id 的教训一致：展示形态 ≠ 模型关系。
--
-- 约束：
--   · (message_id, mentioned_user_id) 唯一 —— 同一条消息里重复提到同一人不产生第二行
--   · 外键级联：消息删了，mention 跟着走
--   · **不允许提到自己**（与 board_notes 的 from<>to 同理：自指没有语义）
--   · **不允许提到不在会话里的用户** —— 由应用层在写入时用
--     thread_members 校验（DB 层做不了跨表条件约束，除非用 trigger；
--     这里选择服务层校验 + Gate 机械验证"提到非成员必须被拒"）
-- ===========================================================================

CREATE TABLE IF NOT EXISTS message_mentions (
  id                uuid PRIMARY KEY,
  message_id        uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_mentions_uniq UNIQUE (message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS message_mentions_user_idx ON message_mentions (mentioned_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_mentions_message_idx ON message_mentions (message_id);

COMMENT ON TABLE message_mentions IS
  'M4：消息的 @ 提及关系（最小闭环）。不表示"原版内部就是这个模型"—— 原版侧证据已被判 INADMISSIBLE，不反向推断。';

-- ---------------------------------------------------------------------------
-- 记录"提到的人是否属于该会话"的判定函数。
--
-- 为什么做成函数而不直接写在接口里：与 can_read_message 同样的理由 ——
-- **会话成员关系只有一处权威定义**，避免"发送时按一套判断、读取时按另一套"的漂移。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_thread_member(p_thread uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM thread_members tm WHERE tm.thread_id = p_thread AND tm.user_id = p_user)
$$;

COMMENT ON FUNCTION is_thread_member(uuid, uuid) IS
  'M4：会话成员关系的唯一权威判定（发送校验与读取校验共用，防权限漂移）。';
