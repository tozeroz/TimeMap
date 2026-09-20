-- M1 001：最小 schema（只有 posts 与迁移记录表）
-- 注意：M1 明确不做 users/likes/comments 等表（留给 M2）

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id          uuid PRIMARY KEY,
  author_name text NOT NULL,
  body        text NOT NULL,
  place       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT posts_body_max_len  CHECK (length(body) <= 500),
  CONSTRAINT posts_place_max_len CHECK (place IS NULL OR length(place) <= 60),
  CONSTRAINT posts_author_max_len CHECK (length(author_name) <= 40)
);

CREATE INDEX IF NOT EXISTS posts_created_at_desc_idx ON posts (created_at DESC, id DESC);
