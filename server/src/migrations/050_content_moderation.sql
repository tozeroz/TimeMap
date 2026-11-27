-- 050：内容审核（A 档）——「发布即公开」改成「机审 → 可能的先审后发 → 人审队列」
--
-- 为什么需要迁移：
--   1) posts/comments 的 status 只有 published/removed 两档，装不下「审核中」；
--   2) 机审结论要留痕（谁、何时、哪条规则/哪个模型、理由），否则无法回答"为什么被拦"；
--   3) 相同文本重复调用大模型要花钱，缓存命中是主要成本控制手段。

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('published', 'removed', 'pending_review', 'rejected'));

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_status_check;
ALTER TABLE comments ADD CONSTRAINT comments_status_check
  CHECK (status IN ('published', 'removed', 'pending_review', 'rejected'));

-- 机审/人审给管理员的备注（机审理由、审核员意见）
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS review_note text;

CREATE TABLE IF NOT EXISTS moderation_decisions (
  id             uuid PRIMARY KEY,
  target_type    text NOT NULL CHECK (target_type IN ('post', 'comment', 'activity_submission', 'profile')),
  target_id      uuid,
  author_id      uuid,
  decision       text NOT NULL CHECK (decision IN ('allow', 'review', 'block')),
  action         text NOT NULL,                -- 最终处置：published / pending_review / rejected
  categories     jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason         text,
  source         text NOT NULL,                -- rule | cache | llm | human | failclosed | disabled
  model          text,
  prompt_version text,
  latency_ms     int,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_decisions_target_idx
  ON moderation_decisions (target_type, target_id);
CREATE INDEX IF NOT EXISTS moderation_decisions_created_idx
  ON moderation_decisions (created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_cache (
  text_hash      text PRIMARY KEY,
  decision       text NOT NULL,
  categories     jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason         text,
  model          text,
  prompt_version text NOT NULL,
  hits           int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_hit_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_pending_review_idx
  ON posts (created_at DESC) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS comments_pending_review_idx
  ON comments (created_at DESC) WHERE status = 'pending_review';

COMMENT ON COLUMN posts.status IS
  'published=公开展示 / pending_review=审核中（仅本人可见） / rejected=审核未通过 / removed=违规下架或作者删除';
COMMENT ON TABLE moderation_cache IS
  '文本审核缓存：同一段文本（归一化后）不重复调用大模型；hits 用于观察复用率';
