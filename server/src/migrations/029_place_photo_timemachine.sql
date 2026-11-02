-- 029_place_photo_timemachine —— 地点「时光机」：同一机位的过去 vs 现在
--
-- 需求：地点详情里把同一机位的老照片与现照做成滑动/淡入对比，并按年代排成胶片带；
--       缺某个年代就如实写「该年代暂无影像」，不拿别的图凑。
--
-- 只加列，不改已有数据的含义：
--   media_id   照片字节走既有媒体管线（public 媒体），不再只能塞 data URI。
--              ON DELETE SET NULL：媒体没了，行还在（年代/来源这些史料信息不跟着丢）。
--   post_id    现照「从帖子图里挑」时记下出处帖子。帖子被删 → 这张现照随之消失
--              （CASCADE），帖子被下架 → 查询时过滤（见 GET /api/places/:id）。
--   view_key   同一机位的分组键。**只有确认是同一机位的照片才填同一个值**；
--              对比组只在同一 view_key 内取，绝不跨组拼。
--   year_sort  排序/分年代用的年份（整数）。year_label 仍是给人看的原文（可写「约1930年代」）；
--              year_sort 为 NULL 表示「年代不详」，前端单独归到「年代不详」一格，不猜。
--
-- 幂等：全部 IF NOT EXISTS / 条件更新，可重复执行。

ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS media_id  uuid REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS post_id   uuid REFERENCES posts(id) ON DELETE CASCADE;
ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS view_key  text;
ALTER TABLE place_photos ADD COLUMN IF NOT EXISTS year_sort integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_photos_year_sort_range') THEN
    ALTER TABLE place_photos ADD CONSTRAINT place_photos_year_sort_range
      CHECK (year_sort IS NULL OR year_sort BETWEEN 1800 AND 2100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_photos_view_key_shape') THEN
    ALTER TABLE place_photos ADD CONSTRAINT place_photos_view_key_shape
      CHECK (view_key IS NULL OR (length(btrim(view_key)) BETWEEN 1 AND 40));
  END IF;
  -- 现照来自帖子时，必须同时指明是帖子里的哪张图
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_photos_post_needs_media') THEN
    ALTER TABLE place_photos ADD CONSTRAINT place_photos_post_needs_media
      CHECK (post_id IS NULL OR media_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS place_photos_view_idx ON place_photos (place_id, view_key) WHERE view_key IS NOT NULL;

-- 已有行：year_sort 只从 year_label 里**原样抽出**一个四位年份（如「1990年代」→1990、「2005年」→2005）；
-- 抽不出就保持 NULL（= 年代不详）。不做任何推断。
UPDATE place_photos
   SET year_sort = substring(year_label from '(1[89][0-9][0-9]|20[0-9][0-9])')::integer
 WHERE year_sort IS NULL
   AND substring(year_label from '(1[89][0-9][0-9]|20[0-9][0-9])') IS NOT NULL;

COMMENT ON COLUMN place_photos.media_id  IS '照片字节（public 媒体）；为空时用 image_url。';
COMMENT ON COLUMN place_photos.post_id   IS '现照取自哪条帖子；帖子下架时不展示。';
COMMENT ON COLUMN place_photos.view_key  IS '同一机位分组键；对比只在同组内进行。';
COMMENT ON COLUMN place_photos.year_sort IS '排序用年份；NULL = 年代不详。year_label 才是展示原文。';
