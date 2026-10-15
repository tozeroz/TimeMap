-- Activity favorites (F06 / US-04): a student can favorite or cancel an activity
-- and find it again under "my favorites".
--
-- Why a SEPARATE table instead of generalizing `favorites` (016):
--   `favorites` carries a NOT NULL post_id FK and already holds live production
--   rows. Turning it into (target_type, target_id) would mean migrating that data
--   and rewriting two endpoints that are already shipped and passing gates. A
--   sibling table leaves the post path byte-for-byte untouched.
--
-- UNIQUE(user_id, activity_id) is the idempotency guarantee: a repeated favorite
-- is a no-op, so the count can never double (same contract as the post path).
--
-- No "removed" concept: an activity is never deleted by a student, and a cancelled
-- activity must STAY in the favorites list (shown with its effectiveStatus badge)
-- rather than silently disappearing.
CREATE TABLE IF NOT EXISTS activity_favorites (
  id          uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_favorites_user_activity_uniq UNIQUE (user_id, activity_id)
);
-- Counting favorites for one activity (POST/DELETE return the count).
CREATE INDEX IF NOT EXISTS activity_favorites_activity_idx ON activity_favorites (activity_id);
-- Listing one user's favorites, newest first.
CREATE INDEX IF NOT EXISTS activity_favorites_user_idx ON activity_favorites (user_id);

COMMENT ON TABLE activity_favorites IS
  'F06/US-04 活动收藏。刻意独立于 016 的 favorites（后者只有 post_id 且线上已有真实数据）。UNIQUE(user_id, activity_id) 即幂等保证：重复收藏不重复计数。活动取消/结束后收藏**保留**，靠 effectiveStatus 标注状态。';
