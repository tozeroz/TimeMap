-- Class training catalogue, maintained only by administrators. No demo votes/data.
CREATE TABLE IF NOT EXISTS training_projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 160),
  group_name text NOT NULL CHECK (char_length(group_name) BETWEEN 1 AND 60),
  member_count integer NOT NULL CHECK (member_count BETWEEN 1 AND 100),
  experience_url text NOT NULL CHECK (experience_url ~ '^https?://'),
  cover_image_id uuid REFERENCES media(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS training_project_likes (
  project_id uuid NOT NULL REFERENCES training_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS training_project_likes_user_idx ON training_project_likes(user_id);
