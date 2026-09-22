-- 清理 WO#16 层 A 的 PLACE_DOES_NOT_IMPLY_CAMPUS 敏感度实验残留
--
-- 背景（如实记录我自己的疏漏）：
--   selftest-place-not-campus.sh 的 revoke 只删了 campuses 行，**没删 schools 行**
--   ⇒ 实验后 `schools = 1` 残留。
--   ⚠️ 而主基线脚本 check-server-baseline.sh 只核对
--      users/threads/messages/media/board_notes/places —— **不含 schools/campuses**
--      ⇒ 所以那个残留**没有被基线检查报出来**（和之前 `places` 22 行残留同一类问题：
--        **清理不完整 + 检查未覆盖该表**）。
--
-- 本文件按实验用的固定 UUID 精确删除，不用模糊条件。
-- 只读约束只针对原版 app；这里是我们自己的库，允许写。

delete from campuses where school_id = '99999999-0000-4000-8000-000000000001';
delete from schools  where id       = '99999999-0000-4000-8000-000000000001';

-- 复核
select 'schools='   || (select count(*) from schools)
    || ' campuses=' || (select count(*) from campuses)
    || ' posts_with_campus=' || (select count(*) from posts where school_campus_id is not null)
    || ' users_with_campus=' || (select count(*) from users where school_campus_id is not null)
    as baseline_after_cleanup;
