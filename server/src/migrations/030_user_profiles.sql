-- User-authorized profile editor: optional self-reported information, never verification.
ALTER TABLE campuses ADD CONSTRAINT campuses_id_school_unique UNIQUE (id, school_id);
ALTER TABLE colleges ADD CONSTRAINT colleges_id_school_unique UNIQUE (id, school_id);

ALTER TABLE users
  ADD COLUMN bio text NOT NULL DEFAULT '',
  ADD COLUMN avatar_media_id uuid,
  ADD COLUMN avatar_media_scope text NOT NULL DEFAULT 'public',
  ADD COLUMN profile_school_id uuid REFERENCES schools(id),
  ADD COLUMN college_id uuid,
  ADD COLUMN enrollment_year integer;

-- Preserve existing explicit campus selections; never assign campus to unassociated users.
UPDATE users u SET profile_school_id = c.school_id
FROM campuses c WHERE c.id = u.school_campus_id;

ALTER TABLE users
  ADD CONSTRAINT users_bio_length CHECK (char_length(bio) <= 160),
  ADD CONSTRAINT users_avatar_public CHECK (avatar_media_scope = 'public'),
  ADD CONSTRAINT users_avatar_media_fk FOREIGN KEY (avatar_media_id, avatar_media_scope)
    REFERENCES media(id, scope),
  ADD CONSTRAINT users_profile_school_required CHECK (
    (school_campus_id IS NULL AND college_id IS NULL) OR profile_school_id IS NOT NULL),
  ADD CONSTRAINT users_profile_campus_fk FOREIGN KEY (school_campus_id, profile_school_id)
    REFERENCES campuses(id, school_id),
  ADD CONSTRAINT users_profile_college_fk FOREIGN KEY (college_id, profile_school_id)
    REFERENCES colleges(id, school_id),
  ADD CONSTRAINT users_enrollment_year_range CHECK (enrollment_year BETWEEN 1900 AND 2100);

CREATE INDEX users_avatar_media_idx ON users(avatar_media_id) WHERE avatar_media_id IS NOT NULL;
COMMENT ON COLUMN users.bio IS 'Optional self-reported biography, up to 160 characters.';
COMMENT ON COLUMN users.profile_school_id IS 'School context of self-reported campus/college, not identity verification.';
COMMENT ON COLUMN users.enrollment_year IS 'Optional admission year (年级), not age or date of birth.';
