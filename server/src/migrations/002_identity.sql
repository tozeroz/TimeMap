-- 002_identity：最小身份/会话模型（M2.2）
--
-- 设计约束来自审核记录 04 与 05：
--  - 身份只能来自服务端；数据库与 API 都不相信客户端传来的 userId
--  - session token 只存 hash（token 本身是 256-bit 随机数，用 SHA-256 即可，不需要 scrypt）
--  - session 必须有 expires_at：不允许"永不过期"的会话
--  - logout 只置 revoked_at，不物理删除（保留审计痕迹）
--  - M1 的历史帖子没有可信身份：author_id 允许为 NULL，**不伪造**归属

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  handle        text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_handle_not_blank   CHECK (length(btrim(handle)) > 0),
  CONSTRAINT users_display_not_blank  CHECK (length(btrim(display_name)) > 0)
);

-- handle 用大小写不敏感的唯一索引：Alice 与 alice 视为同一个账号，
-- 否则会出现"看起来重名"的两个账号（登录时还可能撞车）
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_uniq ON users (lower(handle));

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  -- 撤销时间不能早于创建时间（明显的逻辑错误应当在写入时就被拒绝）
  CONSTRAINT sessions_revoked_after_created CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at)
);

-- 按用户查会话（logout 全部设备、审计）用
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- 帖子归属：M1 的帖子保持 NULL（未知就是未知），M2 之后的新帖必须非 NULL，
-- 但"必须非 NULL"由 API 层强制，而不是加 NOT NULL 约束 —— 因为库里已经存在合法地为 NULL 的历史行。
ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id);

COMMENT ON COLUMN posts.author_id IS
  'M2 起由服务端 session 解析得到；M1 历史帖子为 NULL（当时作者名来自客户端，不可信，不伪造归属）';
COMMENT ON COLUMN posts.author_name IS
  '展示用快照。M1 为客户端提交值；M2 起由服务端用 users.display_name 生成，便于用户改名后保留当时展示名';
