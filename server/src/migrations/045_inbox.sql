CREATE TABLE app_announcements (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_announcements_created_idx ON app_announcements(created_at DESC, id DESC);
CREATE TABLE inbox_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY(user_id, scope)
);
