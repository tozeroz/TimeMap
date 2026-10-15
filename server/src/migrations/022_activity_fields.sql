-- Activity fields required by ACT-003 that the P0 schema (016) did not yet carry:
--   title / cover / description / time / place / organizer / source / "view place on map" / external link
-- 016 already had title / description / place / starts_at / ends_at / source.
-- This adds the remaining four: activity_type, organizer, external_link, cover_image_id.
--
-- Naming: the design document names the activity-kind field two ways -- `category` in the
-- 2.3.1 module class diagram, `activityType` in the combined diagram. We take `activityType`
-- because (a) it is the one drawn with this codebase's real API naming (ApiActivity), and
-- (b) `category` is already the PLACE-kind column (地标/食堂) in the same schema; two
-- different `category` meanings across tables invites the exact mixups this project keeps
-- fixing. The teammate reviewing the contract should confirm the choice.
--
-- ⚠️ `activity_type` deliberately has NO CHECK constraint. The value set is an open item:
--    ACT-002 lists 活动类型分类 under 待讨论, and the document's rule is that 待讨论 items
--    "尚未决定，不得由开发人员或 AI 自行补齐". So the column exists (structure per the class
--    diagram) but the enum and the corresponding filter wait on review. Free text now would
--    be a fabricated taxonomy; a filter over a fabricated taxonomy would be a fake filter.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS activity_type  text,
  ADD COLUMN IF NOT EXISTS organizer      text,
  ADD COLUMN IF NOT EXISTS external_link  text,
  ADD COLUMN IF NOT EXISTS cover_image_id uuid REFERENCES media(id) ON DELETE SET NULL;

-- Cover points at media(id) rather than holding a URL: every other image in this project
-- goes through the media pipeline (content sniffing, size/dimension limits, /media/ delivery).
-- A bare URL column would bypass all of that. ON DELETE SET NULL degrades the cover to
-- "none" instead of cascading into deleting the activity.
--
-- Note on cleanup: the unattached-media GC (cleanup-entry.ts) only targets scope='private'
-- media with no message reference. Cover media is uploaded with purpose='activity' -> public,
-- so it is not in that GC's class B. Cover rows are therefore never swept while referenced.

COMMENT ON COLUMN activities.cover_image_id  IS '封面图（ACT-003），指向 media(id)。';
COMMENT ON COLUMN activities.organizer       IS '主办方（ACT-003）。';
COMMENT ON COLUMN activities.external_link   IS '参与方式：外部链接（ACT-003，仅展示、不做站内报名）。打开方式与风险提示待讨论。';
COMMENT ON COLUMN activities.activity_type   IS '活动类型（ACT-002）。取值集**待讨论**，故无 CHECK 约束、暂无筛选。';
