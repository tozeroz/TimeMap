-- ===========================================================================
-- 009_voice_media —— 语音消息：媒体层放开 audio/webm + 持久化时长
--
-- 依据：审核记录 34（WO5_PHASE1 条件批准；MIGRATION_009: DESIGN APPROVED）
--       与 WO#5 第二轮探针实测结论（docs/m5/PROBE2-recording-capture.md）
--
-- ---------------------------------------------------------------------------
-- 为什么需要这次迁移（两条，都是实测驱动，不是预先假设）
-- ---------------------------------------------------------------------------
-- 1) media.mime 的白名单**结构性排除了音频**
--      006_media_scope.sql: CONSTRAINT media_mime_allowed
--                            CHECK (mime IN ('image/jpeg','image/png','image/webp'))
--    实测（本设备 WebView）：MediaRecorder 产出的
--      recorder.mimeType = "audio/webm"
--      Blob.type          = "audio/webm"
--    → 只加 audio/webm 这一项。**不写成 mime LIKE 'audio/%'**：
--      那会放开"任意 audio/*"，与本约束原本"显式枚举、拒绝 SVG 与任意 binary"的意图冲突。
--      也不把 ";codecs=opus" 写进枚举 —— codecs 是 MIME 参数，不是 MIME 类型本身，
--      实测产出的 mimeType 也不带它（P8 PASS）。
--
-- 2) 时长**必须自己存**（这是探针 P10 暴露的硬约束）
--    实测：<audio> 能成功 loadedmetadata，但 **audio.duration === null**。
--    原因：MediaRecorder 产出的是"live/流式"WebM，**文件头不含 duration**，
--          不 seek 时读到 null/Infinity（WebM 已知特性）。
--    → 因此时长远不可能"从音频文件解码出来"，必须在**录音时计时**并持久化。
--      否则语音气泡无法显示时长 → 无法满足 WO#5 验收 ④。
--
-- ---------------------------------------------------------------------------
-- 为什么这一次就把两件事一起做完（而不是先 009=mime、再 010=duration）
-- ---------------------------------------------------------------------------
-- 迁移**一经应用即校验和锁定，只能追加不能修改**（本项目规则）。
-- 审核明确建议："不要急着消耗 009 …… 等 capture probe 完成后，一次把本单真正需要的
-- schema 冻结"，并点名 duration_ms 应"在这时一起决定"。
-- 探针已完成且结论明确，故两条一起落，避免出现"一小时后再补 010"的碎片化。
--
-- ---------------------------------------------------------------------------
-- 顺带核对（本次**不需要**改的地方，写在这里以免后人误以为漏了）
-- ---------------------------------------------------------------------------
-- · messages.kind：006 已加 CONSTRAINT messages_kind_allowed
--                   CHECK (kind IN ('text','image','voice')) —— **已经允许 voice**，无需改。
-- · media.width / height：006 的 media_dimensions_positive 允许 NULL
--                   （width IS NULL OR width > 0），音频存 NULL 即可，无需改。
-- · media.scope：purpose='chat' → scope='private' 的映射已存在，语音复用即可，无需新增 purpose。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) 放开 media.mime 白名单：追加 audio/webm
-- ---------------------------------------------------------------------------
-- 用 DROP + ADD 的方式改约束（PostgreSQL 不支持直接修改 CHECK 的表达式）。
-- 先 DROP IF EXISTS 保证可重复执行；ADD 只在不存在时执行（沿用 006 的写法）。
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_mime_allowed;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_mime_allowed') THEN
    ALTER TABLE media ADD CONSTRAINT media_mime_allowed
      CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 新增 media.duration_ms：语音时长（毫秒），可空
-- ---------------------------------------------------------------------------
-- 为什么可空（NULL 而非 NOT NULL）：
--   · 图片/其它媒体**没有**时长概念 —— 强行 NOT NULL 会逼着图片也写一个假值，
--     那是"用数据撒谎"；
--   · 语音在**录音时就该有**时长，但历史数据/异常路径不应被 NOT NULL 卡死。
-- 为什么是 BIGINT：
--   毫秒整数；int4 上限约 24.8 天，BIGINT 富余且与 bytes 的 integer 不冲突（时长可能更大）。
ALTER TABLE media ADD COLUMN IF NOT EXISTS duration_ms BIGINT;

-- ---------------------------------------------------------------------------
-- 3) 时长的取值范围约束（与 media_bytes_positive 同风格）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_duration_positive') THEN
    ALTER TABLE media ADD CONSTRAINT media_duration_positive
      CHECK (duration_ms IS NULL OR duration_ms > 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) 一致性约束：只有音频才允许有 duration_ms
-- ---------------------------------------------------------------------------
-- 目的：把"duration 是音频的属性"这件事写进 schema，而不是只写在注释里。
-- 这样任何"给图片写 duration"的写入都会被数据库直接拒绝（服务层写错也拦得住）。
-- 用显式枚举（与 media_mime_allowed 一致），不用 LIKE 'audio/%'。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_duration_only_for_audio') THEN
    ALTER TABLE media ADD CONSTRAINT media_duration_only_for_audio
      CHECK (duration_ms IS NULL OR mime = 'audio/webm');
  END IF;
END $$;
