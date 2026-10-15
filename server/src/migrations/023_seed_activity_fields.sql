-- Backfill the six demo activities planted by 016 with the ACT-003 fields added in 022.
--
-- WHY A NEW MIGRATION INSTEAD OF EDITING 016:
--   schema_migrations stores a SHA-256 of every applied migration. Editing 016 would make
--   its checksum mismatch, and the server fails closed on that (all /api/* return 503).
--   So the backfill is appended -- same rule as 015 ("state that must hold long-term has to
--   be rebuildable from the repo"), rather than a one-off UPDATE run by hand on the server.
--
-- WHY THE VALUES LOOK LIKE DEMO DATA (they are):
--   016 already marks these six rows source='管理员录入（演示数据）'. The organizer names
--   below are *plausible campus bodies but not verified facts*, and every external_link
--   points at example.com (IANA-reserved -- it cannot be mistaken for a real signup page).
--   This is demo data filling demo rows; it is not a claim about the real 北交大.
--
-- WHY THERE IS NO COVER:
--   A migration cannot create the binary file behind a media row. Pointing cover_image_id
--   at a non-existent file would render a broken <img> on every seeded activity, which is
--   worse than no cover. Cover therefore stays NULL for seed rows, and the detail page
--   simply omits the cover block (it renders nothing when the value is absent).
--
-- IDEMPOTENT / NON-CLOBBERING: coalesce() only fills a field that is still empty, so if an
--   administrator has already set one of these on a given row, this migration leaves it alone.
UPDATE activities a SET
  organizer     = coalesce(a.organizer,     v.organizer),
  activity_type = coalesce(a.activity_type, v.activity_type),
  external_link = coalesce(a.external_link, v.external_link)
FROM (VALUES
  ('eeeeeeee-0001-4001-8001-000000000001'::uuid, '校史馆',        '展览',     'https://example.com/bjtu/timemap/exhibition'),
  ('eeeeeeee-0001-4001-8001-000000000002'::uuid, '校庆办公室',     '论坛',     'https://example.com/bjtu/timemap/forum'),
  ('eeeeeeee-0001-4001-8001-000000000003'::uuid, '学生艺术团',     '演出',     'https://example.com/bjtu/timemap/concert'),
  ('eeeeeeee-0001-4001-8001-000000000004'::uuid, '学生会生活部',    '市集',     'https://example.com/bjtu/timemap/market'),
  ('eeeeeeee-0001-4001-8001-000000000005'::uuid, '校友总会',       '校友活动',  'https://example.com/bjtu/timemap/homecoming'),
  ('eeeeeeee-0001-4001-8001-000000000006'::uuid, '校团委',        '晚会',     'https://example.com/bjtu/timemap/welcome')
) AS v(id, organizer, activity_type, external_link)
WHERE a.id = v.id;
