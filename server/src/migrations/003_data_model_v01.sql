-- 003_data_model_v01：数据模型 V0.1（M2.4）
--
-- **Scope Gate（审核记录 05）**：每张表都必须能追溯到 22 页 observed baseline 里
-- 实际观察到的实体/关系；"以后可能用得上"的表不建。
-- 追溯关系见 docs/m2/DATA-MODEL.md，这里只写结论对应的 DDL。
--
-- V0.1 不追求终态：只保证「关系有真约束、查询有索引」。
--
-- 约束一律带业务含义，而不是套模板：
--   likes         UNIQUE(user_id, post_id)      一人对一帖只有一个赞
--   thread_members UNIQUE(thread_id, user_id)   不重复进同一个会话
--   group_members  UNIQUE(group_id, user_id)    不重复入群

-- ---------------------------------------------------------------------------
-- media —— 配图（观察来源：trident-campus 瀑布流「图片 + 文案」、publish 快门入草稿）
-- DB 只存**逻辑 key**，不存完整 URL / 部署路径（PLAN 第六节冻结原则），
-- 未来从本地磁盘切到对象存储时数据库不用改。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media (
  id           uuid PRIMARY KEY,
  post_id      uuid REFERENCES posts(id) ON DELETE CASCADE,
  storage_key  text NOT NULL,                 -- 例如 2026/09/<uuid>.webp
  mime         text NOT NULL,
  bytes        integer NOT NULL,
  width        integer,
  height       integer,
  position     smallint NOT NULL DEFAULT 0,   -- 同一帖内的顺序
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_storage_key_not_blank CHECK (length(btrim(storage_key)) > 0),
  CONSTRAINT media_bytes_positive        CHECK (bytes > 0),
  CONSTRAINT media_mime_allowed          CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT media_position_nonneg       CHECK (position >= 0),
  -- 同一帖内顺序不重复
  CONSTRAINT media_post_position_uniq    UNIQUE (post_id, position)
);

CREATE INDEX IF NOT EXISTS media_post_idx ON media (post_id);

-- ---------------------------------------------------------------------------
-- places —— 地点/POI（观察来源：poi-search「地点名 + 地址」、「不添加地点」首项；
--            publish 的地点胶囊；trident-map 的地区选择）
-- 注意：帖子上的 place 文本仍保留为**快照**，引用 places 只是可选的关联。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS places (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  address     text,
  latitude    double precision,
  longitude   double precision,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT places_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT places_lat_range      CHECK (latitude  IS NULL OR (latitude  BETWEEN -90  AND 90)),
  CONSTRAINT places_lng_range      CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180))
);

CREATE INDEX IF NOT EXISTS places_name_idx ON places (name);

-- 帖子可选引用一个地点（publish 选点后带回），历史帖子保持 NULL
ALTER TABLE posts ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES places(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_place_idx ON posts (place_id);

-- ---------------------------------------------------------------------------
-- comments —— 评论（观察来源：trident-campus「点赞数/评论数」、comment-detail 评论详情页）
-- parent_id 说明：**嵌套结构在 baseline 里没有被观察到**（comment-detail 当时是空白页）。
-- 保留一个可空的自引用只是为了 M3 用真实 UI 校验结构时不至于要改表；
-- 如果 M3 确认没有回复层级，应删掉这一列（写在这里以免被当成"已完成的设计"）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id          uuid PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  parent_id   uuid REFERENCES comments(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS comments_post_created_idx ON comments (post_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- likes —— 点赞（观察来源：trident-campus 卡片上的点赞数）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS likes (
  id          uuid PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT likes_user_post_uniq UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS likes_post_idx ON likes (post_id);

-- ---------------------------------------------------------------------------
-- 会话与消息（观察来源：message 聊天列表「点会话 → 单聊」「新建会话」；chat 单聊「发消息…」）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_threads (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_threads_kind_allowed CHECK (kind IN ('direct','group'))
);

CREATE TABLE IF NOT EXISTS thread_members (
  id          uuid PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_members_uniq UNIQUE (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS thread_members_user_idx ON thread_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS messages_thread_created_idx ON messages (thread_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- board_notes —— 留言板（观察来源：message-board「留言 / 仅双方可见 / 彩色便签式留言列表」）
-- 为什么**不**复用 messages：观察到的语义不同 ——
--   留言板是「给某个同学留一条便签，仅双方可见」，不是会话里的一条消息，
--   也没有会话列表/未读这些概念。硬塞进 message_threads 会让"会话"这个模型变形。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_notes (
  id           uuid PRIMARY KEY,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         text NOT NULL,
  color        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT board_notes_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT board_notes_not_self       CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS board_notes_to_created_idx ON board_notes (to_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 群组与群公告（观察来源：group 群聊；announce 群公告「校园活动」）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groups_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS group_members (
  id          uuid PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member',
  joined_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_members_uniq         UNIQUE (group_id, user_id),
  CONSTRAINT group_members_role_allowed CHECK (role IN ('member','admin','owner'))
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY,
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT announcements_body_not_blank  CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS announcements_group_created_idx ON announcements (group_id, created_at DESC);

COMMENT ON TABLE board_notes IS
  '留言板：来源 message-board「仅双方可见」。与 messages 语义不同，故独立成表（见 docs/m2/DATA-MODEL.md）';
COMMENT ON COLUMN comments.parent_id IS
  '嵌套评论在 baseline 中未观察到（comment-detail 为空白页）；此列是给 M3 校验结构留的余地，不是已确认的设计';
