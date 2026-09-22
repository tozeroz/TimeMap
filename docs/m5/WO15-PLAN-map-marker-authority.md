# WO#15 计划：MapScreen 的标记数据来源（`WO15_MAP_MARKER_AUTHORITY`）

> 时间：2026-09-22 08:55｜Round 265｜依据：审核记录 55 的排序「做完 WO14 再做 MapScreen」
> 状态：**inventory 已完成；实施待批准**

## 〇、结论先行

```
① MapScreen 的 6 个标记**全部来自 mock**（`import { mapMarkers } from '../data/mock'`），
   而权威侧**确实存在可用的数据**：`posts.place_id` → `places`（2 行真实地点），
   且 `GET /api/posts` **已经返回 `place`（地名）**。
② 但**标记位置按经纬度渲染**（默认 provider=tencent），而 API **不返回坐标**
   ⇒ 要接权威数据，**必须新增一项 API 能力**（而不是前端自己改改就行）。
③ mock 的 6 个地点里，**只有「阳光操场」有原版基线证据**；其余 5 个**只在
   mock.ts / MapScreen.tsx 里出现**（自引用）；且 **6 个在 `places` 表里全部不存在**。
```

## 一、逐项 inventory（审核 55 要求的形式）

### 1.1 标记数据（WO14.5a）
| 地点 | 原版基线证据？ | 在 `places` 表？ | 结论 |
|---|---|---|---|
| 阳光操场 | ✅ `docs/original-interaction-map.md:38`（原版实测**红色图钉**） | ❌ 0 行 | **有基线**，但权威表里没有 |
| 达美乐比萨(广州萝岗万达广场) | ✅ 同上一行（原版实测**黄色图钉**） | ✅ **存在**（23.1776,113.4404） | **有基线 + 有权威数据** |
| 教育超市 | ❌ 仅 mock.ts / MapScreen.tsx | ❌ 0 行 | **无基线** |
| 图书馆 | ❌ 仅出现在 mock 与既有测试输出里 | ❌ 0 行 | **无基线** |
| 逸夫教学楼 | ❌ 仅 mock.ts / MapScreen.tsx:77（SVG 文字） | ❌ 0 行 | **无基线** |
| 思源楼 | ❌ 仅 mock.ts / MapScreen.tsx | ❌ 0 行 | **无基线** |
| 学苑公寓 | ❌ 仅 mock.ts | ❌ 0 行 | **无基线** |

⭐ **关键观察**：原版实测到的那两个图钉，**一个是校园建筑（阳光操场）、一个是
完全无关的真实商业 POI（广州的达美乐比萨）**。这说明原版的标记**不是"校园建筑清单"**，
而是**"帖子锚定在地图上某个地点"** —— 地点名来自地图服务/用户选择的 POI。

而我们的服务端**恰好就是这个模型**：
```
posts.place_id -> places(id, name, address, latitude, longitude)
实测：4 条 post 有 place_id，分别锚在「北京交通大学」(3 条) 与「达美乐比萨(广州萝岗万达广场)」(1 条)
```
⇒ **服务端的数据模型与原版一致**，落后的只是**前端仍在渲染一份硬编码的 mock 清单**。

### 1.2 地图实现（WO14.5c）
```
MapScreen.tsx:155  const [providerState] = useState<'tencent'|'amap'|'raster'>('tencent')
渲染优先级：offline 失败降级 → OfflineMap
            provider==='tencent' → TencentMap
            provider==='amap'    → AmapMap
            否则                  → RealMap
坐标用法：TencentMap 用 projectToContainer(LatLng)（**经纬度**）
          RealMap    L.marker([m.lat, m.lng])（**经纬度**）
          OfflineMap 用 x/y（SVG viewBox 1400×2000，**像素**）
```
✅ **默认 tencent 与原文一致**（基线文档记「左下角有**腾讯地图水印**」）。
⚠️ 但**默认用经纬度** ⇒ 标记数据**必须带坐标**才谈得上"权威"。

### 1.3 API 现状
```
GET /api/posts  → ApiPost { id, author, authorId, body, **place: string|null**, createdAt,
                            likeCount, commentCount, likedByMe, images }
                  ⇒ **有地名，没有坐标**
places 表        → id, name, address, latitude, longitude  ⇒ **有坐标，但无接口暴露**
posts 表         → 另有独立的 `place`(text) 与 `place_id`(uuid) 两列
```

## 二、需要裁定的一项**新增 API 能力**（本单的核心）

要"把 mock 换成权威"，**前端自己做不到** —— 因为坐标不在现有响应里。三个方案：

```
方案 A（推荐）：给帖子列表/详情**补两个只读字段** `placeLat` / `placeLng`
  · 由服务端 `left join places on places.id = posts.place_id` 得到；无地点时为 null
  · 优点：改动最小、复用既有端点与既有 CORS/鉴权路径、无需新路由
  · 与 WO#12/#13 的"只暴露必要字段"一致（只加两个数字，不暴露 address/内部 id）
方案 B：新增 `GET /api/map/markers` 专门返回标记数组
  · 优点：语义清晰、可只返回需要的字段
  · 缺点：新路由 + 新 CORS 覆盖 + 新契约面；当前只有 4 条 post，收益不明显
方案 C：不改后端，前端**继续用 mock 的坐标**
  · ❌ 但这等于保留"编造的位置数据"，与 WO#12/#14 已冻结的"不用 mock 冒充真实"冲突
```

**我倾向方案 A。** 请裁定。

## 三、方案（待批准）

```
层 1（数据来源）
  · MapScreen 的标记改由 `GET /api/posts` 派生：**只保留带地点的帖子**
  · 需要坐标时用新字段 placeLat/placeLng（方案 A）
  · 读不到 / 无地点的帖子 → **不出标记**（不回落 mock）
层 2（mock 的 6 个标记）
  · 「阳光操场」：**有原版基线证据**，但**权威表里没有** ⇒
    不删证据、也不当权威 → 记 `ORIGINAL_MAP_PIN_PLACE_OBSERVED: 阳光操场`，
    实现上**不再从 mock 渲染**（因为 mock 的位置/颜色都无出处）
  · 其余 5 个：**无任何基线证据** ⇒ 从渲染路径**移除**（保留在 mock.ts 里并加注释说明"未采用"，
    以免以后有人再把它当成真实数据）
层 3（颜色语义）
  · mock 每条带 color（红/黄/绿），原版实测也确实有红/黄图钉
  · 但**颜色的语义未知**（按类别？按用户？按时间？）⇒ 记 **NOT_EVALUATED**，
    实现上先用**单一确定色**并显式注明"原版颜色语义未评估"，不得声称一致
层 4（离线降级）
  · OfflineMap 用像素坐标，而权威数据只有经纬度 ⇒ 需要用现有 `map.projectToContainer`
    或**按 CAMPUS_CENTER 做线性换算**；这一步的正确性记 NOT_EVALUATED（无基线）
```

## 四、Gate（草案）

```
改前（当前状态，应 FAIL）
  MAP_MARKERS_FROM_AUTHORITY        FAIL（标记来自 mock）
  NO_FABRICATED_PLACE_DATA          FAIL（6 个地点里 5 个无出处、且都不在权威表里）

改后（新增/收紧）
  MAP_MARKERS_FROM_AUTHORITY        每个标记都能追溯到一条**真实 post**（postId 存在且可查）
  MARKER_COUNT_MATCHES_POSTS_WITH_PLACE   标记数 == 有地点的帖子数（不硬编码 6）
  NO_FABRICATED_PLACE_DATA          不得出现"无基线且不在 places 表"的地名
  MAP_NO_FALLBACK_ON_UNAVAILABLE    读到失败/未登录 → 明确不可用态，不回落 mock
  MAP_PIN_COLOR_SEMANTICS_CONFORMANCE      **NOT_EVALUATED**（原版颜色语义未知）
  ORIGINAL_MAP_MARKER_CONFORMANCE          **NOT_EVALUATED**（仅 2 个图钉有观察）
  OFFLINE_MAP_PROJECTION_CONFORMANCE       **NOT_EVALUATED**（无基线）

敏感度（REQUIRED）
  · 把标记源改回 mock → MAP_MARKERS_FROM_AUTHORITY 与 NO_FABRICATED_PLACE_DATA 必须 FAIL
  · 硬编码标记数（如 6）→ MARKER_COUNT_MATCHES_POSTS_WITH_PLACE 必须 FAIL

回归：WO#14／13／12／11／10／8／9A／9B层A／7 + server gate + CORS 契约
```

## 五、请裁定

```
1. 批准本计划？
2. ⭐ **是否批准新增 API 能力（方案 A：给帖子补 placeLat/placeLng 两个只读字段）**？
   这是"把 mock 换成权威"的**前置条件**（前端拿不到坐标就做不到）。
3. 方案选择：A（补字段）／B（新端点 /api/map/markers）／其它？
4. 层 2 的处置：mock 里保留那 6 条但**加注释说明未采用**（而不是物理删除）—— 认可吗？
   （理由是保留"曾观察到的原版图钉（阳光操场）"这条线索，避免以后又被误当真实数据）
5. 颜色语义记 NOT_EVALUATED、实现先用单一色 —— 认可吗？
6. 是否要先补一次**原版 Map 页的只读基线采集**（截图 + 控件树，纯只读浏览，不产生写入），
   以缩小颜色/标记语义的 NOT_EVALUATED 面？
```
