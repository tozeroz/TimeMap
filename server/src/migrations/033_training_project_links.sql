-- Repository links are not playable experience links. Incomplete supplied data stays unknown.
ALTER TABLE training_projects ADD COLUMN IF NOT EXISTS project_url text
  CHECK (project_url IS NULL OR project_url ~* '^https?://');
ALTER TABLE training_projects ALTER COLUMN experience_url DROP NOT NULL;
ALTER TABLE training_projects ALTER COLUMN group_name DROP NOT NULL;
ALTER TABLE training_projects ALTER COLUMN member_count DROP NOT NULL;
ALTER TABLE training_projects DROP CONSTRAINT IF EXISTS training_projects_experience_url_check;
ALTER TABLE training_projects ADD CONSTRAINT training_projects_experience_url_check
  CHECK (experience_url IS NULL OR experience_url ~* '^https?://');
UPDATE training_projects SET experience_url = NULL WHERE btrim(experience_url) = '';
