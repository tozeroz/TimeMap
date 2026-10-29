-- ---------------------------------------------------------------------------
-- 028：录入 2026 年 10–11 月的 7 条校园活动（含外部链接），并修正一次重复造轮子
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 背景（如实记录，含我制造的问题）
-- ═══════════════════════════════════════════════════════════════════════════
-- 需求：把用户给的 7 条活动录进系统，且每条能点超链接跳转。
--
-- ⚠️ 我先是在 new-mvp（1.2）上做的，加了新列 `activities.link_url` 和一个新前端入口。
--    但 main 分支**早就有了**这个能力：022_activity_fields 已加 `activities.external_link`
--    （注释写明"参与方式：外部链接，仅展示、不做站内报名"），接口返回 `externalLink`，
--    活动详情页也早已渲染成 <a target="_blank">。⇒ 我那份是**重复造轮子**。
--
--    更糟的是：我用的锚定地点 id `aaaaaaaa-1111-4111-8111-000000000011` 与
--    main 的 027_bjtu_parent_place 撞了（那边用它当「北京交通大学」学校父地点）。
--    在生产库上，我的迁移先跑、把该 id 写成了「线上活动」；一旦部署 main 的 027，
--    它会 `insert` 同一主键 ⇒ 迁移失败 ⇒ 服务 fail-closed 503。
--
-- 本迁移因此做四件事：
--   ① 把「线上活动」从 ...011 挪到 ...091，并把指向它的活动改过去 —— 把 ...011 腾出来；
--   ② 幂等地补齐 3 个锚定地点（线上活动 / 威海校区 / 香山公园）；
--   ③ 幂等地写入 7 条活动，链接填进**既有**的 external_link（不是新列）；
--   ④ 删掉我多加的 activities.link_url（没有任何代码读它）。
--
-- ⚠️ 执行顺序的坑（重要）：在本迁移之前，main 的 026/027 会先跑。
--    所以对于"已经跑过我那份 020 的库"，①必须在 026/027 之前完成，
--    否则 027 会先撞主键。生产库是**先手工执行了 ①那段 DO 块**再部署的
--    （见 docs/TIMEMAP-P0-WORKLOG.md 的记录）；本迁移里的 ① 仍然保留，
--    是为了让"还原自快照的库"也能自愈。
--
-- 幂等：全部 IF EXISTS / ON CONFLICT DO UPDATE，重复执行安全。
-- ---------------------------------------------------------------------------

-- === ① 四个锚定地点（**必须先建 ...091**，下面才能把活动改过去）==============
-- 北京交通大学（cccccccc-…）原本只由 server/src/seed.ts 创建，**不在迁移里**；
-- 全新库只跑迁移时它不存在 ⇒ 下面挂 place_id 会撞外键。这里兜底保证存在（不改已有数据）。
INSERT INTO places (id, name, category, enabled, sort_order)
VALUES ('cccccccc-0001-4001-8001-000000000001', '北京交通大学', '地标', true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO places (id, name, category, enabled, description, sort_order)
VALUES
  ('aaaaaaaa-1111-4111-8111-000000000091', '线上活动', '地标', true,
   '线上举行的讲座/分享/直播（腾讯会议、视频号直播等），没有固定坐标，因此在校园地图上不显示图标。', 90),
  ('aaaaaaaa-1111-4111-8111-000000000012', '北京交通大学威海校区', '地标', true,
   '威海校区（思东一层文化交流中心等场地在此）。距校本部较远，校园地图上不显示图标。', 91),
  ('aaaaaaaa-1111-4111-8111-000000000013', '香山公园', '地标', true,
   '校外地点：香山公园（红叶节志愿服务等活动在此集合）。校园地图上不显示图标。', 92)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  enabled = EXCLUDED.enabled,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- === ② 把「线上活动」从 ...011 挪到 ...091，腾出学校父地点的主键 ============
-- ⚠️ 顺序不能颠倒：**先建新地点（①）→ 再改活动指向 → 最后删旧行**。
--    第一版把 DELETE 写在建新点之前/之后顺序错，实测报
--    `insert or update on table "activities" violates foreign key constraint`。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM places
     WHERE id = 'aaaaaaaa-1111-4111-8111-000000000011' AND name = '线上活动'
  ) THEN
    UPDATE activities
       SET place_id = 'aaaaaaaa-1111-4111-8111-000000000091'
     WHERE place_id = 'aaaaaaaa-1111-4111-8111-000000000011';
    DELETE FROM places WHERE id = 'aaaaaaaa-1111-4111-8111-000000000011';
    RAISE NOTICE '028: 已把「线上活动」从 ...011 移到 ...091（腾出学校父地点 id）';
  END IF;
END $$;

-- === ③ 七条活动（链接写进 external_link）===================================
-- created_by 用手机号解析，不硬编码 UUID（016 踩过：演示号登录过后管理员 id 并不是固定值）。
INSERT INTO activities (id, title, description, place_id, starts_at, ends_at, external_link, source, status, created_by)
VALUES
  -- 1) 研究生阶段规划 & 求职准备分享 —— 线上（腾讯会议）
  ('eeeeeeee-0002-4001-8001-000000000001',
   '研究生阶段规划 & 求职准备分享',
   '研究生阶段怎么规划、求职怎么提前准备。腾讯会议：910-434-035。扫码报名并完成签到，可获得研究生综合素质 1 积分。',
   'aaaaaaaa-1111-4111-8111-000000000091',
   timestamptz '2026-10-30 19:00:00+08', NULL,
   'https://mp.weixin.qq.com/s/xYr75TKyRRanyhhp_zKlGA',
   '公众号（转自微信推文）', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),

  -- 2) Color walking —— 北交校园（来源只给了截止时间，按"进行中直到截止"表达）
  ('eeeeeeee-0002-4001-8001-000000000002',
   'Color walking｜用你的专属颜色打造校园九宫格',
   '在北交校园里用你的专属颜色拍出九宫格。11 月 20 日 20:00 截止，审核通过可获得一小时心理实践学时。',
   'cccccccc-0001-4001-8001-000000000001',
   timestamptz '2026-10-10 00:00:00+08', timestamptz '2026-11-20 20:00:00+08',
   'https://mp.weixin.qq.com/s/ysrfUDfMYu7oksezjy0fgg',
   '公众号（转自微信推文）', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),

  -- 3) 通信技术与信息科技国际学术会议 —— 地点见官网，挂"北京交通大学"
  ('eeeeeeee-0002-4001-8001-000000000003',
   '第六届通信技术与信息科技国际学术会议',
   '2026 年 11 月 6–8 日举行。具体场地、日程与报名方式见官网通知。',
   'cccccccc-0001-4001-8001-000000000001',
   timestamptz '2026-11-06 00:00:00+08', timestamptz '2026-11-08 23:59:00+08',
   'http://cs.bjtu.edu.cn//jdxw/ca64f6eebd054519b04084de618a37cd.htm',
   '学校/学院官网', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),

  -- 4) TIK TALK —— 威海校区思东一层文化交流中心
  ('eeeeeeee-0002-4001-8001-000000000004',
   'TIK TALK · The POP MARKET of the Year',
   '2026 年 11 月 14–15 日，北京交通大学威海校区思东一层文化交流中心。',
   'aaaaaaaa-1111-4111-8111-000000000012',
   timestamptz '2026-11-14 00:00:00+08', timestamptz '2026-11-15 23:59:00+08',
   'https://wk.bjtuwh.cn/fenlei/info-1-146447.html',
   '威海校区官网', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),

  -- 5) 博士生国际招生面试交流会 —— 地点见后续通知
  ('eeeeeeee-0002-4001-8001-000000000005',
   '第十八届「2026 博士生国际招生面试交流会」',
   '2026 年 11 月 21 日举行，具体地点见后续通知。',
   'cccccccc-0001-4001-8001-000000000001',
   timestamptz '2026-11-21 00:00:00+08', NULL,
   'https://sem.bjtu.edu.cn/show-301-23712.html',
   '学校/学院官网', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),

  -- 6) 香山公园红叶节志愿者
  ('eeeeeeee-0002-4001-8001-000000000006',
   '香山公园「红叶节」志愿者招募',
   '10 月 31 日–11 月 1 日，香山公园红叶节志愿服务。报名方式与集合时间见推文。',
   'aaaaaaaa-1111-4111-8111-000000000013',
   timestamptz '2026-10-31 00:00:00+08', timestamptz '2026-11-01 23:59:00+08',
   'https://mp.weixin.qq.com/s/1nUBpqvzqk2ZHgg6twDHZQ',
   '公众号（转自微信推文）', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001')),

  -- 7) 四六级备考直播 —— 线上
  ('eeeeeeee-0002-4001-8001-000000000007',
   '四六级考前强化备考指南直播',
   '11 月 4 日线上直播，具体开播时间见推文。',
   'aaaaaaaa-1111-4111-8111-000000000091',
   timestamptz '2026-11-04 00:00:00+08', NULL,
   'https://mp.weixin.qq.com/s/1zgiBXqGNsJcSzNuZJauUw',
   '公众号（转自微信推文）', 'scheduled',
   (SELECT id FROM users WHERE phone_e164 = '+8613800000001'))
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  place_id = EXCLUDED.place_id,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  external_link = EXCLUDED.external_link,
  source = EXCLUDED.source,
  status = EXCLUDED.status,
  updated_at = now();

-- === ④ 清掉重复的 link_url（我加的那一列，没有代码读它）====================
ALTER TABLE activities DROP COLUMN IF EXISTS link_url;

COMMENT ON COLUMN activities.external_link IS
  '参与方式：外部链接（ACT-003，仅展示、不做站内报名）。'
  '前端渲染为 <a target="_blank" rel="noreferrer noopener">；库层不限制 scheme，'
  '由服务端 parseActivityPayload 校验必须是 http(s) 且不含账号密码。';
