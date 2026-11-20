-- 043_user_feedback —— 用户反馈（bug 报告 / 功能建议）
--
-- 为什么单独建表而不是复用 reports（举报）：
--   reports 的对象是**站内内容**（帖子/评论），处理动作是"下架/不处理"，
--   有 target_type + target_id 且必须指向一条内容。
--   用户反馈的对象是**产品本身**（一个 bug、一个想要的功能），没有可指认的内容行，
--   处理动作是"已读/已处理 + 备注"。把两者塞进一张表会让 target_id 变成"有时是内容、
--   有时是 null"，任何按 target 的查询都要先判断类型 —— 那是典型的假复用。
--
-- 谁可写：登录用户（侧边栏入口在「我的」页）。user_id 可空是为了保留"账号已注销"后的
--   历史反馈：删号时按 SET NULL 处理，反馈内容仍在，便于统计与排查。
--
-- 谁可读：只有管理员（GET /api/admin/feedback）。普通用户提交后不提供"我的反馈列表"，
--   这也与本轮需求一致（不要扩散范围）。
--
-- 幂等：IF NOT EXISTS，重复执行安全。

CREATE TABLE IF NOT EXISTS user_feedback (
  id            uuid PRIMARY KEY,
  -- 提交人；账号删除后置空，保留反馈内容
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  -- bug = 发现问题；feature = 希望增加的功能；other = 其他
  category      text NOT NULL DEFAULT 'bug',
  -- 反馈正文
  content       text NOT NULL,
  -- 可选联系方式（邮箱/微信/手机号，用户自愿填写）
  contact       text,
  -- 提交时所在页面（如 #/poidetail?id=…），便于复现 bug
  page_context  text,
  -- 提交时的前端版本号，便于判断问题属于哪个版本
  app_version   text,
  -- open = 待处理；resolved = 已处理（管理员处理后可回填 open 表示重新跟进）
  status        text NOT NULL DEFAULT 'open',
  -- 管理员备注（内部记录，不展示给用户）
  admin_note    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_feedback_category_allowed
    CHECK (category IN ('bug', 'feature', 'other')),
  CONSTRAINT user_feedback_status_allowed
    CHECK (status IN ('open', 'resolved')),
  -- 与服务端校验同口径：去掉首尾空白后 5–1000 字
  CONSTRAINT user_feedback_content_len
    CHECK (length(btrim(content)) BETWEEN 5 AND 1000)
);

-- 管理端默认按「待处理 + 时间倒序」看，这条索引直接服务该查询
CREATE INDEX IF NOT EXISTS user_feedback_status_idx
  ON user_feedback (status, created_at DESC, id DESC);

-- 按提交人排查（同一用户反复上报同类问题时有用）
CREATE INDEX IF NOT EXISTS user_feedback_user_idx
  ON user_feedback (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE user_feedback IS
  '用户反馈（bug/功能建议）。对象是产品本身，与 reports（针对站内内容）分开存储。';
COMMENT ON COLUMN user_feedback.status IS
  'open=待处理 resolved=已处理；与 reports.status(pending/resolved) 是两套流程，不复用。';
COMMENT ON COLUMN user_feedback.page_context IS
  '提交时所在的 hash 路由，用于复现问题；由前端读取 location.hash 传入，服务端只做长度校验。';
