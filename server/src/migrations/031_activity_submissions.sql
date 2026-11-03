-- 031_activity_submissions —— 校园活动投稿与审核闭环（ACT-004 / ACT-005）
--
-- 为什么单独建表，而不是给 activities 加一列 status：
--   公开活动的状态是 **按时间推导** 的展示态（upcoming / ongoing / ended / cancelled，
--   见 timemap.ts 的 ACTIVITY_EFF_STATUS_SQL）。投稿状态是 **审核流程状态**
--   （pending / approved / rejected）。两者语义正交：一条已通过的活动会随时间为
--   "已结束"，但它的投稿仍然是"已通过"。混在一个字段里就必然要二选一，
--   所以这里独立成表（执行文档 §4 明确要求）。
--
-- 结构：
--   activity_submissions          投稿主记录：归属人、当前状态、当前版本、关联公开活动
--   activity_submission_revisions 版本快照：每一轮提交的完整业务字段（不可变）
--   activity_submission_reviews   审核记录：某一版本的终审结论（同一版本只有一次）
--   activity_submission_requests  幂等键：同一用户 + 同一 clientRequestId 只处理一次
--
-- 不变量：
--   ① 重提沿用同一 submission_id，revision + 1，历史版本与历史结论都保留；
--   ② 同一投稿最多关联一个公开活动（partial unique index）；
--   ③ 同一版本最多一条审核结论（unique + 事务内状态检查 ⇒ 并发只有一个成功）；
--   ④ 驳回必须写原因（CHECK）。
--
-- 幂等：全部 IF NOT EXISTS / CREATE OR REPLACE，可重复执行。

-- === ① 投稿主记录 ==========================================================
CREATE TABLE IF NOT EXISTS activity_submissions (
  id                     uuid PRIMARY KEY,
  submitter_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 审核流程状态；**不要**与 activities.status 混用（见文件头）
  status                 text NOT NULL DEFAULT 'pending',
  -- 指向 activity_submission_revisions.revision；提交/重提时递增
  current_revision       integer NOT NULL DEFAULT 1,
  -- 审核通过后生成的公开活动；唯一 ⇒ 一条投稿最多一个公开活动
  published_activity_id  uuid REFERENCES activities(id) ON DELETE SET NULL,
  -- 通过时为封面生成的 public 副本（见 server/src/submissionsRoutes.ts 的 promoteCover）
  published_cover_media_id uuid REFERENCES media(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT activity_submissions_status_allowed
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT activity_submissions_revision_positive
    CHECK (current_revision >= 1)
);

-- 一条公开活动最多被一条投稿关联（反过来：一条投稿最多一个公开活动）
CREATE UNIQUE INDEX IF NOT EXISTS activity_submissions_published_uniq
  ON activity_submissions (published_activity_id)
  WHERE published_activity_id IS NOT NULL;

-- 「我的提交」：本人 + 时间倒序（游标分页按 created_at, id 稳定排序）
CREATE INDEX IF NOT EXISTS activity_submissions_submitter_idx
  ON activity_submissions (submitter_id, created_at DESC, id DESC);

-- 管理端审核队列：按状态 + 时间倒序
CREATE INDEX IF NOT EXISTS activity_submissions_status_idx
  ON activity_submissions (status, created_at DESC, id DESC);

-- === ② 版本快照（不可变）====================================================
CREATE TABLE IF NOT EXISTS activity_submission_revisions (
  submission_id   uuid NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  revision        integer NOT NULL,
  title           text NOT NULL,
  place_id        uuid NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz,
  description     text,
  -- 投稿封面：private 媒体的 id（审核前只有本人与管理员可读，见 ④）
  cover_image_id  uuid REFERENCES media(id) ON DELETE SET NULL,
  organizer       text,
  source          text,
  external_link   text,
  activity_type   text,
  submitted_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT activity_submission_revisions_pkey PRIMARY KEY (submission_id, revision),
  CONSTRAINT activity_submission_revisions_revision_positive CHECK (revision >= 1),
  CONSTRAINT activity_submission_revisions_title_len
    CHECK (length(btrim(title)) BETWEEN 1 AND 60),
  -- 与前端/接口校验同一口径：结束时间必须晚于开始时间
  CONSTRAINT activity_submission_revisions_time_order
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- 媒体保留规则要看"这张图有没有被投稿版本引用"
CREATE INDEX IF NOT EXISTS activity_submission_revisions_cover_idx
  ON activity_submission_revisions (cover_image_id)
  WHERE cover_image_id IS NOT NULL;

-- === ③ 审核记录 =============================================================
CREATE TABLE IF NOT EXISTS activity_submission_reviews (
  id            uuid PRIMARY KEY,
  submission_id uuid NOT NULL,
  revision      integer NOT NULL,
  reviewer_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision      text NOT NULL,
  reason        text,
  reviewed_at   timestamptz NOT NULL DEFAULT now(),

  -- 版本必须真实存在
  CONSTRAINT activity_submission_reviews_revision_fk
    FOREIGN KEY (submission_id, revision)
    REFERENCES activity_submission_revisions (submission_id, revision) ON DELETE CASCADE,
  CONSTRAINT activity_submission_reviews_decision_allowed
    CHECK (decision IN ('approved', 'rejected')),
  -- 驳回必须给原因（执行文档 §4：管理员填写原因驳回）
  CONSTRAINT activity_submission_reviews_reject_reason
    CHECK (decision <> 'rejected' OR length(btrim(coalesce(reason, ''))) > 0),
  -- 同一版本只有一次终审（并发下第二个插入直接撞这个约束）
  CONSTRAINT activity_submission_reviews_version_uniq UNIQUE (submission_id, revision)
);

CREATE INDEX IF NOT EXISTS activity_submission_reviews_reviewer_idx
  ON activity_submission_reviews (reviewer_id, reviewed_at DESC);

-- === ④ 幂等键（创建 / 重提） ================================================
-- 执行文档 §5：同标识同内容重试返回同一结果；同标识不同内容拒绝。
-- ⇒ 存下 payload 摘要，重放时比对：一致就返回已有结果，不一致就 409。
CREATE TABLE IF NOT EXISTS activity_submission_requests (
  actor_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  submission_id     uuid NOT NULL REFERENCES activity_submissions(id) ON DELETE CASCADE,
  revision          integer NOT NULL,
  payload_sha256    text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT activity_submission_requests_pkey PRIMARY KEY (actor_id, client_request_id),
  CONSTRAINT activity_submission_requests_sha256_hex CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

-- === ⑤ 投稿封面的读取权限 ===================================================
-- 原 can_read_media：public 放行；private 只认"能读到的聊天消息引用"。
-- 现在多一类 private：**活动投稿封面**。规则：
--   · 投稿人本人可读（"我的提交"要能显示自己上传的海报）；
--   · role='admin' 可读（审核要看图）；
--   · 其他人（含匿名）一律不可读 —— 未审核内容不进公开链路。
-- 审核通过后公开链路用的是 **public 副本**（见 submissionsRoutes.promoteCover），
-- 所以这里不需要为"已通过"开口子。
CREATE OR REPLACE FUNCTION can_read_media(p_user uuid, p_media uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM media md
     WHERE md.id = p_media
       AND (
         md.scope = 'public'
         OR (md.scope = 'private' AND (
              EXISTS (
                SELECT 1
                  FROM message_media mm
                 WHERE mm.media_id = md.id
                   AND can_read_message(p_user, mm.message_id)
              )
              OR (
                p_user IS NOT NULL AND EXISTS (
                  SELECT 1
                    FROM activity_submission_revisions r
                    JOIN activity_submissions s ON s.id = r.submission_id
                   WHERE r.cover_image_id = md.id
                     AND (
                       s.submitter_id = p_user
                       OR EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.role = 'admin')
                     )
                )
              )
         ))
       )
  )
$$;

COMMENT ON FUNCTION can_read_media(uuid, uuid) IS
  'M4/031：媒体可读性。public 放行；private 复用 can_read_message，或投稿封面（本人/管理员）。';

COMMENT ON TABLE activity_submissions IS
  'ACT-004/005：校园活动投稿主记录。审核状态与公开活动展示态分开管理。';
COMMENT ON COLUMN activity_submissions.status IS
  'pending=待审核 approved=已通过 rejected=未通过（与 activities.status 的 upcoming/ongoing/ended/cancelled 无关）';
COMMENT ON COLUMN activity_submissions.published_cover_media_id IS
  '审核通过时由 private 投稿封面复制出的 public 副本，供匿名用户读取活动封面。';
COMMENT ON TABLE activity_submission_revisions IS
  'ACT-004：投稿版本快照，不可变；重提时新增一行，旧版本与旧结论保留。';
COMMENT ON TABLE activity_submission_reviews IS
  'ACT-005：审核结论，同一版本最多一条（并发由 UNIQUE 兜底）。';
COMMENT ON TABLE activity_submission_requests IS
  '幂等键：同一用户 + clientRequestId 只处理一次；摘要不同则拒绝。';
