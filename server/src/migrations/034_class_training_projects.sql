-- User-supplied class catalogue, verified against public GitHub READMEs on 2026-11-06.
-- Unknown group numbers, member counts and covers are deliberately left NULL.
-- Three public experience sites were confirmed (HTTP 200 and matching project page).
-- Do not reset likes or overwrite later administrator edits when replayed.
INSERT INTO training_projects
  (id, name, summary, group_name, member_count, project_url, experience_url, position, published)
SELECT s.id::uuid, s.name, s.summary, NULL, s.member_count, s.project_url, s.experience_url, s.position, true
FROM (VALUES
  ('c1a55000-2026-4000-8000-000000000001', '像素校园 · Pixel Campus', '用像素重现北交校园，探索地标、室内场景与校园向导。', NULL::integer, 'https://github.com/24301001/campus_game', NULL::text, 10),
  ('c1a55000-2026-4000-8000-000000000002', 'TimeMap 校园记忆地图', '把校园故事、照片与活动留在地图上。', NULL, 'https://github.com/tozeroz/TimeMap', NULL, 20),
  ('c1a55000-2026-4000-8000-000000000003', '交大四年：DDL战争', '以大学四年为主题的校园卡牌游戏。', NULL, 'https://github.com/g18809050728-design/kapai001', NULL, 30),
  ('c1a55000-2026-4000-8000-000000000004', '知行谜站 · BeiJiaoGame', '通过双视角线索与沟通，解开北交校园中的谜题。', 5, 'https://github.com/yaya11111111/BeiJiaoGame', NULL, 40),
  ('c1a55000-2026-4000-8000-000000000005', '交大摸金录 · 思源密码', '在校园中探索搜集物资，规划路线并完成撤离。', 5, 'https://github.com/sunchao213/bjtu_treasure_hunt', 'https://sunchao213.github.io/bjtu_treasure_hunt/', 50),
  ('c1a55000-2026-4000-8000-000000000006', '课后勇者：异次元校园', '利用课后零散时间，开启轻量化地牢闯关冒险。', NULL, 'https://github.com/LucidDream444/BJTUrogue', NULL, 60),
  ('c1a55000-2026-4000-8000-000000000007', '来学数学', '练习考研与数学竞赛真题，记录学习、交流题解。', NULL, 'https://github.com/fjw345/mathonline', 'https://www.mathonline.top/', 70),
  ('c1a55000-2026-4000-8000-000000000008', '交大课录智析', '用 AI 字幕、课程总结与思维导图辅助复习课程回放。', NULL, 'https://github.com/FSYShu/BJTU-lecture-analy', NULL, 80),
  ('c1a55000-2026-4000-8000-000000000009', 'FoodTime Neo', '用食堂手账发现校园美食，分享菜品点评与社区动态。', NULL, 'https://github.com/FoodtimeNeo/FoodtimeNeo-Web', 'https://bjtufoodtime.top/', 90),
  ('c1a55000-2026-4000-8000-000000000010', '北交人生 · BJTU Life Simulator', '在校园生活模拟中安排学习、社交、锻炼与成长。', NULL, 'https://github.com/zjr231/BJTU-Life-Simulator', NULL, 100)
) AS s(id, name, summary, member_count, project_url, experience_url, position)
WHERE NOT EXISTS (
  SELECT 1 FROM training_projects p WHERE p.project_url = s.project_url OR p.name = s.name
)
ON CONFLICT (id) DO NOTHING;
