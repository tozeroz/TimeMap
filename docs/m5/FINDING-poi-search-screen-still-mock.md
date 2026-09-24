# 新发现：`PoiSearchScreen` 仍在渲染 mock（与 WO#15 同类的**最后一个已知** mock 数据源）

> 时间：2026-09-22 10:25｜Round 266｜状态：**已取证，待裁定是否立单**
> 来源：本轮用 `baseline-inventory` / 结构化基线核对时顺带查出（WO15.6 排查的副产品）

## 〇、一句话

```
`PoiDetailScreen` **已经**走权威（`GET /api/places/:id`），
但 `PoiSearchScreen` **仍在渲染 `mock.pois`**，其中含**编造的动态数** `posts: 1284`。
服务端**有**地点**详情**接口，但**没有**地点**列表/搜索**接口 —— 所以这个修复
同样需要**新增 API 能力**（与 WO#15 的 placeLat/placeLng 同性质）。
```

## 一、逐项对照（基线 ↔ 我们的实现 ↔ 服务端）

### 1.1 `poi-search` 基线（`docs/original-baseline/screens/poi-search/baseline.json`）
```json
title: 地点搜索 / 选点     route: campusx://poi/search
activity: com.kairuotu.poi.CampusPoiSearchActivity
interactions:
  · 左上关闭、右上「确认」
  · 搜索框提示「搜索地点」；**列表首项「不添加地点」**
  · 列表项：**地点名 + 地址**（如「北京交通大学 / 西直门外上园村3号」）
navigation: 选中 + 确认 → 回到来源页并**带上地点**
known_unknowns: 搜索结果排序规则；无结果时的空态
```
⚠️ 注意：基线对该页 `states` 只记了 `normal = observed`；**没有**记录"行里是否显示计数"。

### 1.2 我们的 `PoiSearchScreen.tsx`（101 行）
```
✅ 左上关闭（IconClose + goBack）           ✅ 右上「确认」
✅ 搜索框 placeholder「搜索地点」           ✅ 列表首项「不添加地点」（清除选择）
✅ 点列表项=**选中**（selected state），不是跳新页 —— 与基线注释一致
❌ **数据来自 `import { pois } from '../data/mock'`**（第 4 行）
```
文件头注释明确写着"原版实测的关键行为：点列表项不会进新页面，而是『选中』…" ——
说明这一页**当时是按基线写的**，只是**数据源仍用 mock**。

### 1.3 服务端
```
✅ **已有** `GET /api/places/:id`（server/src/index.ts:1225）
   返回 { id, name, address, latitude, longitude, posts: [ …**真实**帖子 ] }
   校验：非 uuid → 400 invalid_id；查不到 → 404 not_found
❌ **没有** `GET /api/places`（列表/搜索）—— 客户端因此无处可取列表
```
`PoiDetailScreen.tsx` 已经用 `getPlace(...)` 并实现了 `loading | ready | error` 三态 ⇒ 详情侧是权威的。

## 二、⭐ mock 与权威/基线的**具体差异**（都是可核对的）

| 字段 | mock `pois[0]` | DB `places` 真实行 | 基线实例 | 判定 |
|---|---|---|---|---|
| `name` | 北京交通大学 | 北京交通大学 | 北京交通大学 | ✅ 一致 |
| `address` | **北京市海淀区**西直门外上园村3号 | **西直门外上园村3号** | **西直门外上园村3号** | ⚠️ mock **多了「北京市海淀区」**前缀；**DB 与基线逐字一致** |
| `posts` | **1284** | —（DB 无此列） | 基线**未提及**该字段 | ⚠️ **无出处的编造计数** |
| `category` | '学校' | —（DB 无此列） | 基线**未提及** | ⚠️ 无出处 |
| `distance` | '0m' | —（DB 无此列） | 基线提到 **poi-detail** 页有「距我4公里」 | ⚠️ 该字段属于**详情页**语义，出现在**搜索列表项**里缺乏依据 |
| 经纬度 | 无 | 有（39.9519,116.3373） | — | 列表项基线未提及 |

⭐ 一个值得强调的对照：**DB 的 `address` 与基线实例逐字相同**，而 mock 的多了一个前缀
⇒ 这又一次说明**权威行比 mock 更接近原版**（与 WO#15 的结论同向）。

## 三、为什么**不**在本轮直接修

```
要修就得让 `PoiSearchScreen` 取权威列表，而服务端**没有**列表接口
⇒ 属于**新增 API 能力**（`GET /api/places?q=`），与 WO#15 的 placeLat/placeLng 同性质。
   本项目对"新增 API 能力"的惯例是**先经审核批准**（WO#13 的 PATCH、WO#15 的坐标字段皆如此）。
⇒ 因此本轮只**取证 + 记档**，不擅自加接口。
```

## 四、若立单，建议范围（草案）

```
WO#17_POI_SEARCH_AUTHORITATIVE（暂命名；与 WO#14.5d 的"学校/校区"那条**不是同一单**）
 层1 服务端：新增 **只读** `GET /api/places`（可选 `?q=` 关键字过滤）
     返回 { items: [{ id, name, address, latitude, longitude }] }
     · 只暴露这 5 个字段（不暴露内部列）；与既有 `/api/places/:id` 同风格
     · 需要**新路由** ⇒ 按纪律要同步检查 **CORS 客户端方法覆盖**（已有门禁会自动管到）
 层2 前端：`PoiSearchScreen` 改取权威列表；三态 loading/ready/empty/unavailable；
     **无 mock 回落**；`不添加地点` 作为**本地特殊项**保留（它不是一个 place）
 层3 mock 的 `pois` 加注释说明**未采用**（保留"地址前缀"这条观察痕迹）
 层4 计数类字段（`posts`/`category`/`distance`）：
     基线**未记录**这些 ⇒ 先记 `NOT_EVALUATED`，**不要**因为"数据库能算"就顺手加上
     （本项目已有教训：把能算的东西显示出来，可能是在**加原版没有的东西**）

Gate（草案）：POI_LIST_FROM_AUTHORITY ／ POI_ROW_SHAPE_MATCHES_BASELINE（地点名+地址）／
             NO_FABRICATED_POI_COUNTS ／ POI_NO_FALLBACK_ON_UNAVAILABLE ／
             ORIGINAL_POI_LIST_ROW_FIELDS: NOT_EVALUATED（基线未记计数类字段）
 敏感度：数据源改回 mock → 前两条必须 FAIL
```

## 五、边界（不夸大）

```
· 本发现**只基于仓库内文件**（基线 JSON + 源码 + mock 数据），**未**重新采集原版。
· "mock 的 posts:1284 是编造的"这一判定依据是：**基线未记录该字段 + DB 无对应列 + 无其他出处**，
  即"**无出处**"，而**不是**"已证明原版不显示计数"。
  ⇒ 准确表述：`POI_ROW_POST_COUNT_SOURCELESS: YES`，而不是 `ORIGINAL_POI_ROW_HAS_NO_COUNT: YES`。
· 同理 mock 的 `category` / `distance` 也只判定为"无出处"。
· `PoiSearchScreen` 的**交互结构**（关闭/确认/搜索/首项/选中语义）**与基线一致**，
  这一点**不因数据源问题而作废**。
```
