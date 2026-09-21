-- ===========================================================================
-- 010_voice_media_strict —— 加严 MIME ↔ duration_ms 的一致性约束
--
-- 依据：审核记录 35（MIGRATION 009: APPROVED，但要求**加严**）
--
-- ---------------------------------------------------------------------------
-- 为什么需要 010 而不是直接改 009（如实记录时序，不掩饰）
-- ---------------------------------------------------------------------------
-- 009_voice_media 是我在**收到本轮裁定之前**编写并已应用上线的，
-- 它只包含两条较弱的约束：
--     media_duration_positive       CHECK (duration_ms IS NULL OR duration_ms > 0)
--     media_duration_only_for_audio CHECK (duration_ms IS NULL OR mime = 'audio/webm')
-- 这两条**允许 `audio/webm` 不带 duration**，也**允许其它 mime 带 duration 的边界情形**，
-- 正是审核禁止的"为未来留一个模糊洞"。
--
-- 而本项目规则是"**迁移一经应用即校验和锁定，只能追加不能修改**"（改 009 会让校验和不匹配
-- → 服务端进入 terminal 状态）。因此**只能追加 010** 来加严。
--
-- ⚠ 这确实是审核此前警告过的"别先 009=mime、一小时后又要 010"的形态；
--   但那次的建议是"等 capture probe 完成再冻结"，而本次"要求加严"的裁定
--   是在我应用 009 **之后**才到达的 —— 属**时序**造成的，不是没有采纳建议。
--
-- ---------------------------------------------------------------------------
-- 加严后的目标（审核给定）
-- ---------------------------------------------------------------------------
-- 当前世界只有四种 MIME：image/jpeg / image/png / image/webp / audio/webm
-- 因此可以机械保证：
--     image/*    → duration_ms **必须为 NULL**
--     audio/webm → duration_ms **必须非 NULL 且 > 0**
--
-- 将来若真的支持第二种音频格式，**再追加 migration 扩约束**，
-- 而不是现在留一个模糊的洞。
-- ===========================================================================

-- 把 009 的两条弱约束去掉
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_duration_positive;
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_duration_only_for_audio;

-- 用一条严格的、按 MIME 分支的一致性约束取代
-- （与 media_mime_allowed 用同一套显式枚举，不用 LIKE，避免"任意 audio/*"）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_mime_duration_consistent') THEN
    ALTER TABLE media ADD CONSTRAINT media_mime_duration_consistent
      CHECK (
        (mime IN ('image/jpeg', 'image/png', 'image/webp') AND duration_ms IS NULL)
        OR
        (mime = 'audio/webm' AND duration_ms IS NOT NULL AND duration_ms > 0)
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 说明：这条约束同时覆盖了原两条的全部意图，且更强
-- ---------------------------------------------------------------------------
-- · 原 media_duration_positive（> 0）           → 被 "duration_ms > 0" 覆盖
-- · 原 media_duration_only_for_audio（只有音频能有）→ 被 "image/* 必须 NULL" 覆盖，
--   且**新增**了反向要求："音频必须有 duration"
-- · 因此两条旧约束删除后不留缺口（不是"删了保护"，而是"换成更强的"）
--
-- 该约束是**机械可验证**的：DB 层直接拒绝
--   · audio/webm + duration NULL
--   · image/png  + duration = 12000
--   · 以及任何未在白名单内的 mime（由 media_mime_allowed 拦）
