-- ===========================================================================
-- 007_media_link_ids —— 给 post_media / message_media 补 surrogate id
--
-- 为什么需要：seed 的 put(table, id, row) 助手按"每张表都有主键 id"的约定工作
-- （既有 join 表如 thread_members 也是 `id uuid PK` + `UNIQUE(thread_id,user_id)`）。
-- 006 里这两张关联表只定义了 (post_id/message_id, media_id) 与 UNIQUE(position)，
-- seed 一跑就报 `column "id" of relation "post_media" does not exist`。
--
-- 为什么不直接改 006：**迁移有 checksum 校验**，已经应用过的迁移被改动会被判为
-- terminal 错误（存量库与代码不一致），所以只能新增一个迁移来演进。
--
-- 注意：本迁移**不改变**跨 scope 防线 —— 复合外键 (media_id, media_scope) → media(id, scope)
-- 与 CHECK(media_scope='public'/'private') 原样保留。
-- ===========================================================================

ALTER TABLE post_media    ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE message_media ADD COLUMN IF NOT EXISTS id uuid;

-- 回填 + 设默认（用 gen_random_uuid 保证既有行也拿到值）
UPDATE post_media    SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE message_media SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE post_media    ALTER COLUMN id SET NOT NULL;
ALTER TABLE message_media ALTER COLUMN id SET NOT NULL;
ALTER TABLE post_media    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE message_media ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 主键（用 DO 块以便幂等：重复执行不会因为已存在主键而报错）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_pkey') THEN
    ALTER TABLE post_media ADD CONSTRAINT post_media_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_media_pkey') THEN
    ALTER TABLE message_media ADD CONSTRAINT message_media_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- 同一个 media 在同一帖/同一消息里只应出现一次（防重复挂载）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_post_media_uniq') THEN
    ALTER TABLE post_media ADD CONSTRAINT post_media_post_media_uniq UNIQUE (post_id, media_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_media_msg_media_uniq') THEN
    ALTER TABLE message_media ADD CONSTRAINT message_media_msg_media_uniq UNIQUE (message_id, media_id);
  END IF;
END $$;
