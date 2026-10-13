# WO#15 计划 · **第二次更正**：`poi-detail` 不是 BLOCKED，而是**已被补采恢复到 observed**

> 时间：2026-09-22 09:05｜Round 265
> 触发：新建 `scripts/m5/baseline-inventory.mjs`（基线全貌清单）后用 `--grep 达美乐` 搜到
> `docs/test/original-baseline/supplements/poi-detail.json` —— 一份我先前**从未读过**的**结构化补采**。

## 〇、我又犯了同一类错误（本回合第三次）

```
我在上一封信里写：`ORIGINAL_POI_DETAIL_STRUCTURE: **BLOCKED**`
依据：只读了 `screens/poi-detail/baseline.json`，它写 states 全部 not_reproducible + blocked_reason。
错在：`supplements/poi-detail.json` **明确写着自己 supersedes 那份**：
      supersedes.field  = states.normal.status
      supersedes.from   = not_reproducible
      supersedes.to     = **observed**
      why_m0_missed     = M0 只用 deep link；而 campusx:// scheme 只注册了 MainActivity 与
                          DeepLinkActivity，PoiDetailActivity 外部不可达 → deep link 必然回落。
                          真实入口是「动态详情 → 点地点区」。
⇒ **第三次**同族错误（同一回合内）：
  ① 窄搜索（只搜地名串）→ 误判"基线稀少"
  ② `--grep` 才发现 supplements 下的结构化补采
  ③ 读了 baseline.json 就下 BLOCKED，**没查有没有 supersedes**
  统一纪律（应机械前置）：**下"BLOCKED/未知/没有"这类否定结论之前，
  必须先证明（a）搜索范围完整、（b）没有更新的记录取代它。**
  → 已把它做进 `baseline-inventory.mjs` 的输出（显式提示"清单里没有 ≠ 全仓库没有"），
    并会继续把"supersedes 追踪"加进去。
```

## 一、`poi-detail` 的真实状态（原版**地点详情页**，已观测）

```json
title: 地点详情      activity: com.kairuotu.feed.poi.detail.PoiDetailActivity
method: 真实 UI 入口进入 + adb screencap(1080x1920 无损 PNG) + uiautomator 控件树
recovery_entry:
  1. 启动原版 app（com.kairuotu.campus）
  2. 底部导航 → 地图（tab 3，坐标 675,1810）
  3. 地图上点「用户发布的照片图钉」的**照片缩略图**（**不是地名文字**）→ 进入 FeedDetailActivity
  4. 在动态详情页点 **地点区**（resource-id: id/location_section）→ 进入 PoiDetailActivity
observed 结构（interactions）:
  · 顶部：地点名（大号加粗）+ 右上分享（content-desc: 分享，id: id/iv_poi_detail_share）
  · 地点名下方一行：**距离（如「距我4公里」）+ 完整地址**
  · 主体：**该地点关联的用户动态图片**（一张大图，**带作者标签叠加**）
  · 左上返回（id: id/iv_poi_detail_dynamic_back）
ui_ids（含 bounds）:
  tv_poi_name [28,500][978,566] ／ iv_poi_detail_share [992,500][1059,567]
  tv_distance [28,580][124,637] ／ tv_address [138,580][1052,637]
  view_user_tag（clickable）[21,696][187,721] ／ iv_poi_detail_dynamic_back [14,88][112,186]
observed_content:
  poi_name = **达美乐比萨(广州萝岗万达广场)**
  distance = 距我4公里
  address  = 联和街道科丰路89号开创大道2707号万达广场负一层商场B1006铺
  user_tag = 食物语
model_facts（全部 SUPPORTED）:
  · places 需要坐标（用于「距我 N 公里」）→ 保留 latitude/longitude，无需新增字段
  · places.address 需容纳长中文地址（实测 30 字，街道+门牌+楼栋+楼层+铺位）→ 不要加长度上限
  · 地点与动态是**一对多**（poi 详情页主体就是"该地点的动态图片"）→ posts.place_id 方向正确
  · 需要 **places → posts** 的聚合查询与索引 → M2 已有 posts_place_idx
known_unknowns_still_open:
  · 多张图片时的排布（本次只有一张）
  · 「距我」是服务端算还是客户端算（未验证）
```

## 二、⭐ 这些事实如何**收紧**我 WO#15 的 NOT_EVALUATED 面

我原计划把"标记的可见形态"整体记为 NOT_EVALUATED。现在有据可依的部分：

```
✅ 标记的**内容形态**（有据）：
   「地图上点『用户发布的照片图钉』的**照片缩略图**（不是地名文字）」
   ＋ trident-map/baseline.json:38「主体：地图 + **用户头像标记** + 深色气泡卡片」
   ＋ docs/test/original-interaction-map.md:38「**照片卡片 + 彩色图钉 + 地点名**」
   ⇒ 三者一致地指向：标记 = **照片/头像 + 彩色图钉 + 地点名**，点击照片进动态详情。
     且「地点名」**不是**点击目标、**照片缩略图**才是 —— 这是一个**交互细节**，我原计划完全没提。
✅ 点击后的去向（有据）：照片 → FeedDetailActivity；动态详情页的地点区 → PoiDetailActivity。
   ⇒ 所以地图页的**导航图**是：地图 →（点照片）动态详情 →（点地点区）地点详情。
✅ 地点实体需要坐标与长地址、且与动态是一对多（全部 SUPPORTED，来自原版实测）
⚠️ 仍 NOT_EVALUATED：
   · 图钉**配色规则**（红/黄/绿分别代表什么）
   · 气泡卡片的**内容与出现条件**
   · 缩放级别
   · 头像标记与照片标记的分工（两处描述措辞不同：一处"用户头像标记"、一处"照片图钉"）
```

## 三、⚠️ 同一文件里记着一段**已结案**的策略越界

`supplements/poi-detail.json` 的 `policy_violation` 与 `docs/pending/POLICY-VIOLATION-2026-09-21.md` 记录：
前一轮（M3 Evidence Preflight）**在原版第三方 app 内执行过写操作**（建群／发消息／发图片／发布回复），
用户于 2026-09-21 12:04 指出违规；**该案已登记、用户已裁定 A（不补救）、2026-09-21 20:47 结案**。

**对本轮的意义（我只陈述现状，不重开案件）**：
```
· 该证据的**结构性结论仍有效**（来自 DOM/控件树结构，不依赖"是谁发的"），
  但取证手段违规 → 该文件自身标注 `EVIDENCE_OBTAINED_BY_POLICY_VIOLATION`。
⇒ 我在 WO#15 里引用 poi-detail 的结构时，**必须同时带这个标注**，
  不能只引用结构而不说明取证方式。这是"引用证据要带上它的效力边界"的要求。
· 我本轮（Round 264-265）**没有**对原版 app 做任何写操作：
  只读了仓库内的基线文件与 JSON；设备侧只跑了我们自己 APK 的门禁。
  ⚠️ 但我要如实说明：**我也没有重新采集原版基线**，所以本轮所有原版结论都来自**既有文件**。
```

## 四、新增的机械工具（防止同族错误再犯）

`scripts/m5/baseline-inventory.mjs` —— **基线全貌清单 + 带分母的全文检索**：
```
· 枚举 docs/test/original-baseline/screens/*（本轮实测 **24 个屏幕目录**）与 supplements/*.json（**10 个补采**）
· 每个屏幕列出：title ／ 已观测态 ／ 证据文件数 ／ 是否有 blocked_reason
· --grep <词>：在**全部 32 个 JSON** 里全文检索，并**打印分母**
   （例：--grep 达美乐 → 命中 supplements/poi-detail.json:55；--grep 阳光操场 → **0/32**）
· 显式声明边界：只覆盖 docs/test/original-baseline/**，"清单里没有 ≠ 全仓库没有"；
  且**不做视觉核对**（截图存在 ≠ 看过）
```
它当场就产出了价值：**是它让我找到 `supplements/poi-detail.json` 的**。

### 顺带发现的证据缺口（记录下来，不在本单修）
```
feed-list  ：states 里 observed 的是 **error** 态（不是 normal）
feed-detail：同上（observed = error）
announce / chat / comment-detail / group ：observed 的是 **empty** 态
⇒ 即：这几屏的"正常态"基线**并未采集**。凡引用它们做一致性主张时，
  必须说明"基线观测到的是 error/empty 态"，**不得**当作"原版正常态已知"。
（这解释了为什么此前几单在这些屏上都标了不少 NOT_EVALUATED —— 是证据面本身有限。）
```
