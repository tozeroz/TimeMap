ALTER TABLE training_projects ADD COLUMN IF NOT EXISTS description text CHECK (char_length(description) <= 4000);
ALTER TABLE training_projects ADD COLUMN IF NOT EXISTS category text CHECK (char_length(category) <= 24);
ALTER TABLE training_projects ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(features) = 'array' AND jsonb_array_length(features) <= 4);
ALTER TABLE training_projects ADD COLUMN IF NOT EXISTS experience_notes text CHECK (char_length(experience_notes) <= 1000);

-- Separate from cover_image_id. Reordering/removing screenshots never changes the logo.
CREATE TABLE IF NOT EXISTS training_project_images (
  project_id uuid NOT NULL REFERENCES training_projects(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 7),
  PRIMARY KEY(project_id, position), UNIQUE(project_id, media_id)
);
CREATE TABLE IF NOT EXISTS training_project_reviews (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES training_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS training_project_reviews_page ON training_project_reviews(project_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
