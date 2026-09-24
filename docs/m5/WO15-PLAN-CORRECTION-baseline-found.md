# WO#15 计划 · **更正与增补**（`WO15-PLAN-map-marker-authority` 的勘误）

> 时间：2026-09-22 09:00｜Round 265
> 起因：我在计划里写"mock 6 个地点里只有阳光操场有基线证据"，那是**基于一次窄搜索**
> （只搜 6 个地名在 `docs/` 里的字符串命中）。随后我发现
> `docs/original-baseline/` 下有**结构化**基线，读了之后结论必须更正。

## 〇、⭐ 我犯的检索错误（值得记为方法教训）

```
我做的：在有 20+ 张表的 docs 里搜「阳光操场」等 6 个**地名串** → 命中很少 → 结论"基线稀少"
实际有：docs/original-baseline/ 下 **按屏** 存了 baseline.json（结构化）+ 截图，
        其中就有 trident-map / poi-search / poi-detail / supplements/schools.json
⇒ 又一次踩到同一条纪律：**零/稀缺命中只有在"搜索范围被证明完整"之后才有证据价值。**
   我只搜了"这些地名串出现在哪里"，**没有先确认"原版地图相关的基线一共存在哪些"**。
   （同族教训本会话已出现过：`Select-String -Path 'dir\**\*.tsx'` 不递归导致的假零命中。）
```

## 一、`trident-map/baseline.json`（原版地图页，**已存在**）

```json
screen_id: trident-map         title: 地图页（底部 tab 3）
activity:  com.kairuotu.trident.TridentActivity
entry:     deep link campusx://trident → 点底部第三个 tab（675,1810）
states:    normal = **observed**（normal.png）；loading/empty = not_reproducible；error = not_applicable
interactions:
  · 顶部：大标题 Map + 地区选择「北京交通大学（校本部）」+ 右上消息图标
  · 主体：地图 + **用户头像标记** + 深色气泡卡片
  · 右下：定位复位按钮 + 黑色圆形 +
navigation: 地区名 → 选点页（poi/search）；+ → 发布页
persistence: 无
known_unknowns:
  · 「授权地理位置」弹窗本次未出现（此前已授权/已选择过）
  · 地图底图为腾讯地图 SDK；**具体缩放级别与标记规则未记录**
```
另有 `trident-map/recovered-m3-map-pins.png`（一张**专名**为"地图图钉"的补采截图）。

**对我计划的更正**：
1. ✅ 我写"默认 provider=tencent 与原版一致"——**得到佐证**（基线明写"腾讯地图 SDK"）。
2. ⚠️ 我写"颜色语义未知/NOT_EVALUATED"——**方向对**，但应引用基线的原话
   「**具体缩放级别与标记规则未记录**」作为依据，而不是我自己推断的"未评估"。
3. ⭐ **我漏了一条：主体是「地图 + 用户头像标记 + 深色气泡卡片」** ——
   标记带**用户头像**与**气泡卡片**两项形态信息，我的 plan 完全没提。
4. ⚠️ `error = not_applicable`、`loading/empty = not_reproducible` ——
   所以**不能**声称"我们实现了 loading/empty/error 态与原版一致"（原版未观测到这些态）。

## 二、⭐ `poi-search/baseline.json`（原版**地点搜索/选点页**，**已存在**）

```json
screen_id: poi-search    title: 地点搜索 / 选点    route: campusx://poi/search
activity:  com.kairuotu.poi.CampusPoiSearchActivity
states:    normal = observed（normal.png）
interactions:
  · 左上关闭、右上「确认」
  · 搜索框提示「搜索地点」；**列表首项「不添加地点」**
  · 列表项：**地点名 + 地址**（如「北京交通大学 / 西直门外上园村3号」）
navigation: 选中 + 确认 → 回到来源页并**带上地点**
known_unknowns: 搜索结果排序规则；无结果时的空态
```

**⭐⭐ 这条直接改写了我对 `places` 的判断**：
```
基线列表行的形状 = 「地点名 + 地址」
我们的 places 列 = id, name, address, latitude, longitude
实测实例：北京交通大学 | 西直门外上园村3号 | 39.9519,116.3373
```
⇒ `places` 的 `(name, address)` **正是**原版选点页的行形状，**逐字对得上**（连"西直门外上园村3号"都一样）。
⇒ 并且原版首项是「**不添加地点**」⇒ 地点**可选**，与 `posts.place_id` **可空**一致。
⇒ 所以我原计划里"权威侧只有 2 行真实地点、不足以支撑"的说法要**收敛**：
  真正缺的不是"地点这个实体"，而是**地图页标记的可见形态（头像/气泡/图钉规则）**。

## 三、`poi-detail/baseline.json`（原版地点详情页）—— **BLOCKED**

```json
title: 地点详情    route: campusx://feed/poi/detail（实测回落到 trident，deep link 不生效）
states: 全部 not_reproducible
blocked_reason: "deep link 无法直达，且需要登录态下的真实地点数据才能进入"
known_unknowns: 真实入口应是地图/动态里的地点点击；真实结构需在有内容时才能观察
```
> ⚠️⚠️ **本小节已被我自己的第二次更正推翻**：`supplements/poi-detail.json` **明确 supersedes 它** ——
> `states.normal.status: not_reproducible → **observed**`（真实入口＝「动态详情 → 点地点区」）。
> 我在这里犯了本回合**第三次**同族错误：读了 `baseline.json` 就下 `BLOCKED`，
> **没有先查有没有更新的记录取代它**。正确状态见
> `docs/m5/WO15-PLAN-CORRECTION-2-poi-detail-not-blocked.md`。
> ⚠️ 另：`BLOCKED_BY_POLICY`（策略禁止）与"入口不可达造成的 blocked"**必须分开表述**。
⚠️ 注意这与 `BLOCKED_BY_POLICY` 不同：这是**入口不可达**造成的 blocked，不是策略禁止。

## 四、⭐⭐ `supplements/schools.json` —— 直接证实 **WO14.5d 是一处真实偏差**

原版实测（recovery_entry：地图页 → 地区选择器「北京交通大学（校本部）▼」(约 165,150)）：
```
下拉展开后：北京交通大学 ／ **校本部 ／ 威海校区 ／ 东校区** ／ 「搜索其他学校」
点「搜索其他学校」(约 207,550) → 学校搜索页（React Native，XhsReactActivity）
学校搜索页 observed_ui：
  · 搜索框 placeholder「搜索选择学校...」+ 取消
  · 分组标题「更多学校」
  · 行格式：「**学校名 (校区名)**」+ 右侧「**N条校园圈**」+ 可选「X小时前更新」
  · 实例：上海视觉艺术学院 (校本部) 15条校园圈
  · 实例：上海交通大学 (闵行校区) 6小时前更新 2502条校园圈
  · 实例：**北京交通大学 (校本部) 4条校园圈**
  · 实例：浙江师范大学 (金华校区) 329条校园圈
observations.interactions 原话：
  · 「校园页/地图页的顶部下拉**不是学校列表**，而是**当前学校的校区列表**」
  · 「学校搜索页每一行是「学校 (校区)」二元组」
  · 「每行右侧显示该「校园圈」的**动态数**」
model_verdicts: schools 独立成表 SUPPORTED；校区是子实体 SUPPORTED；校园圈粒度=学校×校区 SUPPORTED
```

### ⇒ 因此 CampusScreen 的 `SchoolSwitcher` 与原版有**两处实质偏差**
```
偏差①（结构）：我们把"8 个学校"直接放在**顶部下拉**里
   而原版顶部下拉是**当前学校的校区列表**（校本部/威海校区/东校区），
   **学校列表在另一个页面**（点「搜索其他学校」才进）
偏差②（内容语义）：我们每行显示「region · **{members} 位同学**」
   而原版每行是「**学校名 (校区名)**」+「**N条校园圈**」（**动态数**，不是成员数）
   ⇒ mock 里的 members:'12,486' 等 8 个数字**既无出处、语义也错**（我们说的是"同学数"，
     原版那个位置放的是"校园圈动态数"）
```
另：`FeedListScreen.tsx:132` 已按"学校名无权威来源"做了 HIDE/DEFER，
而 `CampusScreen` **仍在渲染**这份 mock 清单 —— **两屏对同一问题处置不一致**。

⚠️ 但**不能**由此推出"应当直接把 switcher 删掉"：原版**确实有**这条入口（只是形态不同）。
处置方向应是**对齐原版形态**（顶部=校区列表；学校搜索=另一页），而不是简单隐藏。
这需要一次独立的 WO（见 §六）。

## 五、数据侧实测（`scripts/m5/diagnose-map-vs-baseline.sh`）

```
posts 总数=4 ／ place_id 非空=**4** ／ place(text) 非空=4 ／ school_campus_id 非空=**0**
place(text) vs place_id→places.name：**一致 4 / 不一致 0**（两个来源未漂移）
逐条：**3 条** = 北京交通大学 ／ **1 条** = 达美乐比萨(广州萝岗万达广场)
schools 行数=0 ／ campuses 行数=0
```
⭐⭐ **一条需要如实记录的偏差**：
```
基线（原版实测）：北京交通大学 (校本部) **4条校园圈**
我们：锚在 places.name='北京交通大学' 的 post = **3 条**
⇒ **数量不同（3 vs 4）** —— 这本身是一条 ORIGINAL_CONFORMANCE 偏差事实，
   但它**不是**本 WO 的目标（本 WO 是"标记数据来源"），故：
     · 记入 KNOWN-DEVIATIONS 为待查项：`CAMPUS_CIRCLE_POST_COUNT: 3 vs 原版 4`
     · ⚠️ **不得**为了让数字相等去补造一条 post（那是伪造数据去凑观测值）
```
⚠️ 自查出的两个我方 bug（已修）：
① 脚本里在一个 `echo` 中用了反引号 → bash 当成**命令替换**，把那段输出吃掉了；
② 我打印了一句**硬编码的**断言"我们 4 条 post 全部锚在「北京交通大学」"，
   而紧邻上方的查询结果明明是 **3** —— 这正是"硬编码断言与派生结果混用"的坑，
   已改为由查询推导 + 显式指出"两侧数量不同"。

## 六、更正后的 WO15 范围与后续

```
WO15（本单，等 API 裁定）：MapScreen 的**标记数据来源**（mock → 权威）
  · places 的存在性与形状**已有基线支撑**（poi-search 行形状 + 「不添加地点」）⇒ 难度低于我原估
  · 仍缺：**标记的可见形态**（用户头像 / 深色气泡卡片 / 图钉颜色与规则）
    → 基线已明记 `known_unknowns: 具体缩放级别与标记规则未记录`，故 NOT_EVALUATED 是**继承既有结论**，
      不是我自己偷懒。

WO16（建议新开）：**校园/校区选择与原版形态对齐**
  · CampusScreen 顶部下拉应为**校区列表**（非学校列表）
  · 学校搜索应为**独立页面**，行格式「学校 (校区)」+「N条校园圈」
  · mock 的 schools(members) 语义错误，需按原版改为"校园圈动态数"
  · 需先验证原版「搜索其他学校」入口是否可**只读**到达（纯导航点击，不产生写入）
  · 与 WO14.5d 同源；`FeedListScreen` 与 `CampusScreen` 的处置需统一

WO15.x：`CAMPUS_CIRCLE_POST_COUNT: 3 vs 原版 4` 记入 KNOWN-DEVIATIONS（待查，不补造）
```

## 七、自证边界（不夸大）
- 本更正基于**读基线文件**（JSON），不是重新采集；所有字段均**逐字引用**。
- ⚠️ **视觉证据本次未核对**：`trident-map/normal.png`、`recovered-m3-map-pins.png`、
  `poi-search/normal.png` 我**没有**看过像素 —— 我的模型是纯文本的，
  而本会话的 `vision` 工具**两次调用都返回空**（疑似未配置）。
  ⇒ 凡涉及**视觉细节**（图钉颜色、头像形态、气泡卡片样式、水印位置）的结论，
    **一律仍记 `NOT_EVALUATED`**，不得因为"基线里有截图"就当作已核对。
  ⇒ 待办：需要一条**可用的图像核对通道**（配好 vision，或由人确认），
    才能把"标记的可见形态"从 NOT_EVALUATED 推进。
    这也解释了为什么我原计划的"颜色语义 NOT_EVALUATED"**不是偷懒**，
    而是**证据通道确实不可用**——但必须把这原因写出来，而不是含糊过去。
