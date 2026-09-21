-- ===========================================================================
-- 006_media_scope —— M4：媒体从"帖子附属"升级为带 scope 的一等资源
--
-- 依据：审核记录 13（7 条媒体存储边界）+ 审核记录 15（4 条补充，含两条 P0）
--
-- 本迁移解决三件事：
--   1. 公共动态图与私有聊天图**分开命名空间**（缺口 C）
--   2. 跨 scope 引用在**数据库层结构上不可能**（P0-B）
--   3. 消息可见性抽成**唯一权威函数**，媒体授权复用它（P0-A 防权限漂移）
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) 重建 media
--
-- 旧的 media 是"帖子附属"形态（post_id 必填；无 scope/owner/sha256/幂等键；
-- UNIQUE(post_id,position) 只服务于"同一帖内顺序"）。
-- **安全性说明**：该表此前**没有任何写入路径**（M4 才引入上传接口），
-- 因此不存在需要迁移的数据；DROP 是重建而不是丢数据。
-- （seed 的 canonical 覆盖范围不含 media；清理/校验脚本也不引用它。）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS media CASCADE;

CREATE TABLE media (
  id                 uuid PRIMARY KEY,
  owner_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- public  = 动态图片：Nginx 静态下发，公开可见
  -- private = 聊天/群聊图片：**没有静态入口**，必须经应用层鉴权
  scope              text NOT NULL,
  -- 只存**逻辑 key**（如 2026/09/<uuid>.webp）；不存 URL、不存部署绝对路径
  -- → 将来切对象存储时 DB 不用改（PLAN §6）
  storage_key        text NOT NULL,
  mime               text NOT NULL,
  bytes              integer NOT NULL,
  width              integer,
  height             integer,
  sha256             text NOT NULL,
  -- 幂等键（审核记录 15）：客户端为一次逻辑上传生成一个 UUID；
  -- 响应丢失后重试 → 命中同一条 media，不产生第二份文件
  upload_request_id  uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT media_scope_allowed        CHECK (scope IN ('public','private')),
  CONSTRAINT media_storage_key_not_blank CHECK (length(btrim(storage_key)) > 0),
  CONSTRAINT media_bytes_positive       CHECK (bytes > 0),
  -- 只允许这三种；SVG 被结构性排除（PLAN §6：拒绝 SVG 与任意 binary）
  CONSTRAINT media_mime_allowed         CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT media_sha256_hex           CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_dimensions_positive  CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),

  -- 幂等：同一用户 + 同一 upload_request_id 只能有一条
  CONSTRAINT media_upload_idem_uniq     UNIQUE (owner_user_id, upload_request_id),
  -- 同一 scope 内 storage_key 唯一（防止两个 DB 行指向同一物理文件）
  CONSTRAINT media_storage_key_uniq     UNIQUE (scope, storage_key),
  -- **供复合外键使用**：让 post_media / message_media 能"钉死" scope（见下）
  CONSTRAINT media_id_scope_uniq        UNIQUE (id, scope)
);

CREATE INDEX media_owner_idx ON media (owner_user_id, created_at DESC);
CREATE INDEX media_scope_idx ON media (scope);

-- ---------------------------------------------------------------------------
-- 2) 帖子 ↔ 媒体：**只能 public**
--
-- P0-B 的做法：不是"应用层记得校验"，而是用**复合外键 + 常量 CHECK** 让
-- 非法状态在结构上无法表达：
--   post_media.media_scope 被 CHECK 钉死为 'public'
--   FK (media_id, media_scope) → media(id, scope)
-- 于是一条 private media **不可能**被任何 post_media 行引用 ——
-- 数据库会直接报外键错误，而不是依赖某个 endpoint 记得检查。
-- message_media 同理（钉死 'private'）。
-- ---------------------------------------------------------------------------
CREATE TABLE post_media (
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id    uuid NOT NULL,
  media_scope text NOT NULL DEFAULT 'public',
  position    smallint NOT NULL DEFAULT 0,
  CONSTRAINT post_media_scope_public CHECK (media_scope = 'public'),
  CONSTRAINT post_media_position_nonneg CHECK (position >= 0),
  CONSTRAINT post_media_uniq UNIQUE (post_id, position),
  CONSTRAINT post_media_media_fk FOREIGN KEY (media_id, media_scope)
    REFERENCES media(id, scope) ON DELETE CASCADE
);

CREATE INDEX post_media_media_idx ON post_media (media_id);

-- ---------------------------------------------------------------------------
-- 3) 消息 ↔ 媒体：**只能 private**
-- ---------------------------------------------------------------------------
CREATE TABLE message_media (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_id    uuid NOT NULL,
  media_scope text NOT NULL DEFAULT 'private',
  position    smallint NOT NULL DEFAULT 0,
  CONSTRAINT message_media_scope_private CHECK (media_scope = 'private'),
  CONSTRAINT message_media_position_nonneg CHECK (position >= 0),
  CONSTRAINT message_media_uniq UNIQUE (message_id, position),
  CONSTRAINT message_media_media_fk FOREIGN KEY (media_id, media_scope)
    REFERENCES media(id, scope) ON DELETE CASCADE
);

CREATE INDEX message_media_media_idx ON message_media (media_id);

-- ---------------------------------------------------------------------------
-- 4) 消息补两个字段（M4 主线 B：message kind + media reference）
--    - kind：文本/图片/语音（撤回后仍保留 kind，界面上显示"消息已撤回"）
--    - deleted_at：撤回。**可见性判定必须看它**，否则撤回后图片仍可读
-- ---------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_kind_allowed') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_kind_allowed CHECK (kind IN ('text','image','voice'));
  END IF;
END $$;

-- 未撤回消息的索引（会话列表按时间读）
CREATE INDEX IF NOT EXISTS messages_thread_live_idx
  ON messages (thread_id, created_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5) **消息可见性的唯一权威定义**（P0-A 的核心）
--
-- 审核记录 15 要求：媒体授权**必须复用消息可见性的同一个 predicate**，
-- 否则会出现权限漂移：
--     GET /messages/:id        → 404
--     GET /api/media/:mediaId  → 200     ← 同一用户、同一条消息，结论不一致
--
-- 所以这里把"用户能否读某条消息"写成一个 SQL 函数；
-- 消息接口与媒体接口都调用它。**以后成员退群、被移除、
-- 历史消息可见性等规则只在这里定义一次。**
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_read_message(p_user uuid, p_message uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM messages m
      JOIN thread_members tm
        ON tm.thread_id = m.thread_id
       AND tm.user_id   = p_user
     WHERE m.id = p_message
       AND m.deleted_at IS NULL        -- 已撤回 → 任何人都读不到
  )
$$;

COMMENT ON FUNCTION can_read_message(uuid, uuid) IS
  'M4：消息可见性的唯一权威判定。媒体授权必须复用它（审核记录 15 P0-A），不得另写一套。';

-- ---------------------------------------------------------------------------
-- 6) 媒体可见性：**复用** can_read_message
--
--    public  → 公开内容，无需鉴权（由 Nginx 静态下发；应用层接口也放行）
--    private → 必须存在一条"引用该 media 且当前用户读得到"的消息
--
-- 注意：这里刻意**没有**单独判断"请求者是不是发送者"或"是不是群成员" ——
-- 那些判断全部在 can_read_message 里。媒体侧只问一句"有没有一条我能读的引用消息"。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_read_media(p_user uuid, p_media uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM media md
     WHERE md.id = p_media
       AND (
         md.scope = 'public'
         OR (md.scope = 'private' AND EXISTS (
               SELECT 1
                 FROM message_media mm
                WHERE mm.media_id = md.id
                  AND can_read_message(p_user, mm.message_id)
             ))
       )
  )
$$;

COMMENT ON FUNCTION can_read_media(uuid, uuid) IS
  'M4：媒体可读性。public 放行；private 复用 can_read_message（防权限漂移）。';

-- ---------------------------------------------------------------------------
-- 7) 一致性约束：一条 media 不能被**两种 scope**同时引用
--    结构上已由复合外键保证（post_media 只能 public、message_media 只能 private），
--    这里再补一条运行期断言函数，供 Gate 直接调用做"尝试突破"的负向测试。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION media_scope_conflicts(p_media uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT (SELECT count(*) FROM post_media    WHERE media_id = p_media)
       + (SELECT count(*) FROM message_media WHERE media_id = p_media)
$$;
