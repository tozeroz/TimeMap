-- User-confirmed map parent for the nine places in 地图地标地点清单.md.
-- This is places hierarchy only, not users/posts.school_campus_id attribution.
-- School anchor uses the existing CAMPUS_CENTER; it is a display anchor, not a gate.
insert into places (id, name, address, latitude, longitude, category, enabled,
  description, sort_order, display_level, min_display_zoom, display_priority)
values ('aaaaaaaa-1111-4111-8111-000000000011', '北京交通大学', '北京市海淀区上园村3号',
  39.9503, 116.3396, '地标', true, '校园地图总览，汇总所属地点的帖子。',
  0, 'school', 4, 0);

update places set parent_place_id = 'aaaaaaaa-1111-4111-8111-000000000011'
where id in (
  'aaaaaaaa-1111-4111-8111-000000000001',
  'aaaaaaaa-1111-4111-8111-000000000002',
  'aaaaaaaa-1111-4111-8111-000000000003',
  'aaaaaaaa-1111-4111-8111-000000000004',
  'aaaaaaaa-1111-4111-8111-000000000005',
  'aaaaaaaa-1111-4111-8111-000000000006',
  'aaaaaaaa-1111-4111-8111-000000000007',
  'aaaaaaaa-1111-4111-8111-000000000008',
  'aaaaaaaa-1111-4111-8111-000000000009'
);
