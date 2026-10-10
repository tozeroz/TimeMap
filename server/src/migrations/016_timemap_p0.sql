-- 016_timemap_p0：BJTU TimeMap P0（F01–F07）数据模型与种子
--
-- 依据：《BJTU TimeMap需求分析与产品设计文档》3.1/3.2（P0 = F01 账号资料、F02 地图地点、
--       F03 地点详情、F04 发布、F05 互动、F06 活动、F07 举报管理）。
--
-- 核心业务规则在本迁移里的落点：
--   · 所有帖子必须关联**管理员启用的**预设地点   → places.enabled；发帖时服务端强校验
--   · 首版帖子和评论直接发布（举报 + 事后下架）  → posts/comments 只有 status，
--                                                  没有"待审核"态；下架是 removed
--   · 点赞/评论/收藏可撤销，重复请求不重复计数   → favorites 表 + 唯一约束（与 likes 同型）
--   · 活动由管理员录入，无报名/支付/投稿         → activities 只有管理员写路由；无报名字段
--   · 举报后**不自动下架**，管理员处理必须留原因 → reports.status/resolution/handle_reason
--   · 操作记录包含管理员、对象、时间和动作       → audit_log
--
-- ⚠️ 种子数据的来源登记（合规要求）：
--   · 地点清单与坐标：团队人工整理的**演示值**（围绕 CAMPUS_CENTER 39.9503,116.3396 布点），
--     非测绘值；正式使用前须逐点核对。
--   · 地点简介/校史文案：团队撰写的演示文案，非校方授权史料。
--   · 老照片：**内嵌 SVG 占位图**（data URL），来源如实标注"演示素材，待替换"；
--     不爬取、不复制任何第三方照片。
--   · 活动：演示数据，时间用 now()+interval，保证任何时间灌库后状态分布合理。

-- ---------------------------------------------------------------------------
-- F01：账号角色（学生管理员）
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'student';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'admin'));
COMMENT ON COLUMN users.role IS 'F07：student=普通学生；admin=学生管理员（管理端仅此角色可用，服务端强校验）';

-- 种子管理员（固定 UUID + 演示手机号）。登录仍走手机验证码（dev sink / 短信），无密码后门。
--
-- ⚠️⚠️ 为什么不能只写 `ON CONFLICT (id) DO UPDATE`（2026-09-26 线上真实事故）：
--   users 上有**两个**唯一约束 —— 主键 id，以及 users_phone_e164_uniq(phone_e164)。
--   `ON CONFLICT (id)` 只处理前者。若库里已经存在一个**手机号相同但 UUID 不同**的用户
--   （例如 P0 之前试用期用这个演示号登录过，登录即注册会建一个随机 UUID 的账号），
--   这条 INSERT 就会撞 phone 唯一约束 ⇒ **整个 016 迁移失败** ⇒ 服务端 fail-closed 503。
--   线上实际报错就是：duplicate key value violates unique constraint "users_phone_e164_uniq"。
--
--   ⇒ 正确做法是**先按手机号认领**：号码已存在就把它提升为管理员（保留它原来的 id，
--     因为那个 id 可能已经关联了历史帖子/会话，改 id 会破坏引用），否则再按 id 插入。
--     这样既幂等，也不会因为"演示号被人用过"而让迁移挂掉。
UPDATE users
   SET role = 'admin',
       handle = COALESCE(NULLIF(btrim(handle), ''), 'admin'),
       display_name = COALESCE(NULLIF(btrim(display_name), ''), '管理员')
 WHERE phone_e164 = '+8613800000001';

INSERT INTO users (id, handle, display_name, phone_e164, role)
SELECT 'bbbbbbbb-0000-4000-8000-000000000001', 'admin', '管理员', '+8613800000001', 'admin'
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE phone_e164 = '+8613800000001')
    ON CONFLICT (id) DO UPDATE SET role = 'admin';

-- 兜底：万一上面的 id 行存在但手机号是空的（历史数据），补上演示号。
-- 单独一条，避免与"按手机号认领"互相干扰。
UPDATE users SET phone_e164 = '+8613800000001'
 WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001' AND phone_e164 IS NULL
   AND NOT EXISTS (SELECT 1 FROM users WHERE phone_e164 = '+8613800000001');

-- ---------------------------------------------------------------------------
-- F02：地点（分类 / 启用 / 简介 / 校史）
-- ---------------------------------------------------------------------------
ALTER TABLE places ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '地标';
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_category_check;
ALTER TABLE places ADD CONSTRAINT places_category_check CHECK (category IN ('地标', '食堂'));
ALTER TABLE places ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE places ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS history text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN places.enabled IS 'F02/US-01：停用地点不能再关联新帖子（发帖服务端强校验）；地图与地点列表只显示启用地点';

-- 北交大校内首批地点（10 个：7 地标 + 3 食堂，符合需求"8–12 个、含 1–2+ 食堂"）
INSERT INTO places (id, name, address, latitude, longitude, category, enabled, description, history, sort_order) VALUES
  ('aaaaaaaa-1111-4111-8111-000000000001', '南门', '海淀区上园村3号 北京交通大学南门',
   39.9468, 116.3404, '地标', true,
   '北京交通大学正门，校内学生日常进出与合影留念的主要入口。',
   '南门沿用了老校门的中轴意象，是历代学生毕业合影的固定取景地。', 1),
  ('aaaaaaaa-1111-4111-8111-000000000002', '思源碑', '校内中轴路北侧',
   39.9489, 116.3391, '地标', true,
   '位于校园中轴路上的纪念石碑，寓意"饮水思源"。',
   '思源碑是校园纪念活动的常用场地，校庆期间常在此设置主题装置。', 2),
  ('aaaaaaaa-1111-4111-8111-000000000003', '明湖', '校园东北部',
   39.9521, 116.3415, '地标', true,
   '校园内的人工湖，环湖步道是日常散步与晨读的热门去处。',
   '明湖建成后逐渐成为校园景观核心，湖边四季景色是学生照片里最常见的背景。', 3),
  ('aaaaaaaa-1111-4111-8111-000000000004', '图书馆', '校园中部',
   39.9508, 116.3382, '地标', true,
   '主图书馆，考试周与毕业季人气的"顶流"地点。',
   '图书馆经历过多次扩建，老馆照片记录了几代交大人的自习记忆。', 4),
  ('aaaaaaaa-1111-4111-8111-000000000005', '逸夫教学楼', '校园西侧教学区',
   39.9498, 116.3369, '地标', true,
   '主要教学楼群，日常上课与自习的核心区域。',
   NULL, 5),
  ('aaaaaaaa-1111-4111-8111-000000000006', '天佑会堂', '校园南部',
   39.9477, 116.3376, '地标', true,
   '大型礼堂，开学典礼、晚会与讲座的主要举办场地。',
   '以詹天佑先生命名，承载了学校最重要的仪式与文艺演出记忆。', 6),
  ('aaaaaaaa-1111-4111-8111-000000000007', '学生活动中心', '校园东部',
   39.9512, 116.3428, '地标', true,
   '社团活动、讲座与小型演出的集中场地。',
   NULL, 7),
  ('aaaaaaaa-1111-4111-8111-000000000008', '学苑餐厅', '校园北部生活区',
   39.9530, 116.3389, '食堂', true,
   '综合食堂，早午晚三餐全时段营业，二层有风味窗口。',
   NULL, 8),
  ('aaaaaaaa-1111-4111-8111-000000000009', '第二食堂', '校园中部生活区',
   39.9501, 116.3409, '食堂', true,
   '距离教学区最近的食堂，课间人流最密集。',
   NULL, 9),
  ('aaaaaaaa-1111-4111-8111-000000000010', '清真食堂', '校园生活区西侧',
   39.9493, 116.3359, '食堂', true,
   '提供清真餐食的食堂。',
   NULL, 10)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, address = EXCLUDED.address, latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude, category = EXCLUDED.category, enabled = EXCLUDED.enabled,
  description = EXCLUDED.description, history = EXCLUDED.history, sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- F04：帖子状态 + 幂等键（防连续点击重复发帖）
-- ---------------------------------------------------------------------------
ALTER TABLE posts ADD COLUMN IF NOT EXISTS client_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS posts_client_request_id_uniq ON posts (client_request_id)
  WHERE client_request_id IS NOT NULL;
COMMENT ON COLUMN posts.client_request_id IS
  'F04/US-02：客户端为一次逻辑发布生成的幂等键；同一键重放返回原帖，不产生第二条';

ALTER TABLE posts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (status IN ('published', 'removed'));
ALTER TABLE posts ADD COLUMN IF NOT EXISTS removed_reason text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS removed_at timestamptz;
COMMENT ON COLUMN posts.status IS
  'F07/US-08：published=正常；removed=已下架/作者删除。所有公开面（列表/详情/地点/地图/热门）同步排除';

CREATE INDEX IF NOT EXISTS posts_status_idx ON posts (status);

-- ---------------------------------------------------------------------------
-- F05：收藏（与 likes 同型：唯一约束保证重复请求不重复计数，删除即撤销）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  id          uuid PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_user_post_uniq UNIQUE (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS favorites_post_idx ON favorites (post_id);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites (user_id);

-- ---------------------------------------------------------------------------
-- 评论状态（作者可删自己的评论；删除后不计入有效评论量）
-- ---------------------------------------------------------------------------
ALTER TABLE comments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_status_check;
ALTER TABLE comments ADD CONSTRAINT comments_status_check CHECK (status IN ('published', 'removed'));
ALTER TABLE comments ADD COLUMN IF NOT EXISTS removed_reason text;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS comments_status_idx ON comments (status);

-- ---------------------------------------------------------------------------
-- F03：地点老照片（年代 + 来源可追溯；图片为 data URL，来源如实标注演示素材）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS place_photos (
  id          uuid PRIMARY KEY,
  place_id    uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  title       text NOT NULL,
  year_label  text NOT NULL,
  source      text NOT NULL,
  image_url   text,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_photos_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT place_photos_source_not_blank CHECK (length(btrim(source)) > 0)
);
CREATE INDEX IF NOT EXISTS place_photos_place_idx ON place_photos (place_id, position);

INSERT INTO place_photos (id, place_id, title, year_label, source, image_url, position) VALUES
  ('dddddddd-0001-4001-8001-000000000001', 'aaaaaaaa-1111-4111-8111-000000000003',
   '明湖旧景', '1990年代', '演示素材（待替换为授权校史照片）',
   'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27640%27%20height%3D%27420%27%3E%3Crect%20width%3D%27640%27%20height%3D%27420%27%20fill%3D%27%23d8cfc0%27%2F%3E%3Crect%20x%3D%2736%27%20y%3D%2736%27%20width%3D%27568%27%20height%3D%27348%27%20fill%3D%27%23c9bda9%27%2F%3E%3Ctext%20x%3D%27320%27%20y%3D%27215%27%20font-size%3D%2738%27%20text-anchor%3D%27middle%27%20fill%3D%27%23554e42%27%20font-family%3D%27serif%27%3E%E6%98%8E%E6%B9%96%20%C2%B7%201990%E5%B9%B4%E4%BB%A3%3C%2Ftext%3E%3C%2Fsvg%3E', 1),
  ('dddddddd-0001-4001-8001-000000000002', 'aaaaaaaa-1111-4111-8111-000000000004',
   '老馆一角', '1980年代', '演示素材（待替换为授权校史照片）',
   'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27640%27%20height%3D%27420%27%3E%3Crect%20width%3D%27640%27%20height%3D%27420%27%20fill%3D%27%23d3c8b4%27%2F%3E%3Crect%20x%3D%2736%27%20y%3D%2736%27%20width%3D%27568%27%20height%3D%27348%27%20fill%3D%27%23bfb19a%27%2F%3E%3Ctext%20x%3D%27320%27%20y%3D%27215%27%20font-size%3D%2738%27%20text-anchor%3D%27middle%27%20fill%3D%27%23504a3e%27%20font-family%3D%27serif%27%3E%E5%9B%BE%E4%B9%A6%E9%A6%86%20%C2%B7%201980%E5%B9%B4%E4%BB%A3%3C%2Ftext%3E%3C%2Fsvg%3E', 1),
  ('dddddddd-0001-4001-8001-000000000003', 'aaaaaaaa-1111-4111-8111-000000000001',
   '南门旧貌', '2005年', '演示素材（待替换为授权校史照片）',
   'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27640%27%20height%3D%27420%27%3E%3Crect%20width%3D%27640%27%20height%3D%27420%27%20fill%3D%27%23d9d2c3%27%2F%3E%3Crect%20x%3D%2736%27%20y%3D%2736%27%20width%3D%27568%27%20height%3D%27348%27%20fill%3D%27%23c6bca6%27%2F%3E%3Ctext%20x%3D%27320%27%20y%3D%27215%27%20font-size%3D%2738%27%20text-anchor%3D%27middle%27%20fill%3D%27%23555044%27%20font-family%3D%27serif%27%3E%E5%8D%97%E9%97%A8%20%C2%B7%202005%E5%B9%B4%3C%2Ftext%3E%3C%2Fsvg%3E', 1)
ON CONFLICT (id) DO UPDATE SET
  place_id = EXCLUDED.place_id, title = EXCLUDED.title, year_label = EXCLUDED.year_label,
  source = EXCLUDED.source, image_url = EXCLUDED.image_url, position = EXCLUDED.position;

-- ---------------------------------------------------------------------------
-- F06：近期活动（管理员录入；状态 = 库存状态 + 时间推导，取消为人工覆盖）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activities (
  id          uuid PRIMARY KEY,
  title       text NOT NULL,
  description text,
  place_id    uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  source      text NOT NULL DEFAULT '管理员录入',
  -- 库存状态只有两个：scheduled（按时间自动推导展示态）/ cancelled（人工取消，醒目标注）
  status      text NOT NULL DEFAULT 'scheduled',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT activities_status_check CHECK (status IN ('scheduled', 'cancelled')),
  CONSTRAINT activities_ends_after_start CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS activities_starts_idx ON activities (starts_at);
COMMENT ON TABLE activities IS
  'F06：展示态由服务端推导——cancelled → 已取消；now<starts_at → 即将开始；starts_at..ends_at → 进行中；其余 → 已结束。无报名/支付/字段';

-- ⚠️ created_by 用**子查询解析真正持有演示号的账号**，不要硬编码 'bbbbbbbb-…'。
--   理由（与上面 users 种子同一个根因的第二处表现，2026-09-26 线上实测）：
--     activities.created_by → users(id) 是外键。如果演示号在 P0 之前就被人用过
--     （登录即注册 ⇒ 那个账号是随机 UUID），管理员账号的 id 就**不是** bbbbbbbb-…，
--     硬编码会让这条插入撞 activities_created_by_fkey ⇒ 整个 016 失败。
--     实测报错：insert or update on table "activities" violates foreign key constraint
--               "activities_created_by_fkey"
--   ⇒ 按手机号取真实 id；子查询无匹配时给 NULL（created_by 可空），迁移不会因此挂掉。
INSERT INTO activities (id, title, description, place_id, starts_at, ends_at, source, status, created_by) VALUES
  ('eeeeeeee-0001-4001-8001-000000000001', '「图纸上的交大」校史展', '从建校图纸到今日校园，一张图一个故事。展览期间凭学生卡入场。',
   'aaaaaaaa-1111-4111-8111-000000000004', now() - interval '1 day', now() + interval '7 day', '管理员录入（演示数据）', 'scheduled', (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),
  ('eeeeeeee-0001-4001-8001-000000000002', '130周年校庆主论坛', '校庆系列主论坛，校友与师生共话交大未来。',
   'aaaaaaaa-1111-4111-8111-000000000006', now() + interval '3 day', now() + interval '3 day' + interval '3 hour', '管理员录入（演示数据）', 'scheduled', (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),
  ('eeeeeeee-0001-4001-8001-000000000003', '明湖夏夜音乐会', '学生乐团环湖演出，欢迎围观。',
   'aaaaaaaa-1111-4111-8111-000000000003', now() + interval '5 day', now() + interval '5 day' + interval '2 hour', '管理员录入（演示数据）', 'scheduled', (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),
  ('eeeeeeee-0001-4001-8001-000000000004', '毕业季跳蚤市场', '学长学姐的宝贝大甩卖，摊位先到先得。',
   'aaaaaaaa-1111-4111-8111-000000000007', now() + interval '10 day', now() + interval '10 day' + interval '6 hour', '管理员录入（演示数据）', 'scheduled', (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),
  ('eeeeeeee-0001-4001-8001-000000000005', '校友返校日', '各届校友重返校园，从南门出发重走求学路。',
   'aaaaaaaa-1111-4111-8111-000000000001', now() - interval '10 day', now() - interval '10 day' + interval '5 hour', '管理员录入（演示数据）', 'scheduled', (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),
  ('eeeeeeee-0001-4001-8001-000000000006', '迎新联欢晚会（已取消）', '因场地安排调整取消，后续安排另行通知。',
   'aaaaaaaa-1111-4111-8111-000000000006', now() + interval '14 day', now() + interval '14 day' + interval '3 hour', '管理员录入（演示数据）', 'cancelled', (SELECT id FROM users WHERE phone_e164 = '+8613800000001'))
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, description = EXCLUDED.description, place_id = EXCLUDED.place_id,
  starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, source = EXCLUDED.source,
  status = EXCLUDED.status, created_by = EXCLUDED.created_by, updated_at = now();

-- ---------------------------------------------------------------------------
-- F07：举报 + 操作记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id            uuid PRIMARY KEY,
  target_type   text NOT NULL,
  target_id     uuid NOT NULL,
  reporter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_code   text NOT NULL DEFAULT 'other',
  reason_text   text,
  -- pending = 待处理（举报后**不**自动下架）；resolved = 管理员已处理
  status        text NOT NULL DEFAULT 'pending',
  -- 管理员的处置：no_action=不处理；removed=下架内容。两者都**必须**记录原因
  resolution    text,
  handle_reason text,
  handled_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'comment')),
  CONSTRAINT reports_status_check CHECK (status IN ('pending', 'resolved')),
  CONSTRAINT reports_resolution_check CHECK (resolution IS NULL OR resolution IN ('no_action', 'removed'))
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_id);
COMMENT ON TABLE reports IS
  'F07/US-08：举报进入待处理列表但**不自动下架**；管理员不处理或下架都必须记录原因；同一用户对同一目标的重复举报按唯一约束去重';

-- 同一用户对同一目标只保留一条未处理举报（防止刷举报；已处理的可再次举报）
CREATE UNIQUE INDEX IF NOT EXISTS reports_pending_dedup
  ON reports (reporter_id, target_type, target_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY,
  actor_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   uuid,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_not_blank CHECK (length(btrim(action)) > 0)
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
COMMENT ON TABLE audit_log IS 'F07：操作记录 = 管理员（actor）、动作（action）、对象（target）、原因与时间';
