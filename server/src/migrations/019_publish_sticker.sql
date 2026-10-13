-- Pure-image posts are validated with their media inside the creation transaction.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_body_not_blank;
ALTER TABLE posts ADD COLUMN image_mode text NOT NULL DEFAULT 'photo'
  CHECK (image_mode IN ('photo', 'sticker'));

-- Reserve every provider attempt durably before calling it, including failed attempts.
CREATE TABLE cutout_jobs (
  request_id uuid PRIMARY KEY,
  -- Keep attempt accounting even if the source media/account is later cleaned up.
  owner_id uuid NOT NULL,
  media_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'done', 'failed')),
  result_base64 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cutout_jobs_owner_time ON cutout_jobs(owner_id, created_at);
