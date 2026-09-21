# WO#10 计划（修订版）：MessageScreen 剩余 mock —— **字段级 inventory 先行**

> 时间：2026-09-22 04:16｜Round 261｜依据：审核记录 50（要求先做字段级 inventory）
> 状态：**待审核批准**
>
> ⚠️ **本版修正了上一版的一处事实错误**：上一版把「邀请卡」列为待做项，但**实际核实**发现
> 邀请卡在 WO#8 就已经处理完了（姓名接真实 session、头像改首字占位、学院/年级已移除）。
> 这正是"先核实再写"的价值 —— 我差点基于记忆而非源码写计划。

## 〇、审核 50 的方法与硬边界（逐条遵守）

```
inventory 五列：field → 当前来源 → **是否有权威来源** → 可写/只读 → 若无来源：hide / defer / 显式 redesign

⚠️ 硬边界：**不得**因为工作单叫"去 mock"就临时制造数据库字段
   （尤其学校 / 学院 / 年级 / 头像没有权威来源时）
```

## 一、✅ 字段级 inventory（**逐条实测**）

### 1.1 权威来源的实测事实

`scripts/m5/probe-users-schema-for-wo10.sh` + `probe-school-source.sh`（只读）：
```
users 列：id / handle / display_name / created_at / updated_at / school_campus_id / phone_e164
   → **没有** avatar / college / grade / major / mbti / zodiac
public 全表清单：无 profile 表、**无好友关系表、无推荐表**
接口清单：**无**任何 suggest / recommend / friend 接口（源码 grep 确认）
学校链：users.school_campus_id → campuses(id) → schools(id)
   campuses(id, school_id, name) ／ schools(id, name, region)  —— **两表都存在但数据为空**
   三个种子用户的 school_campus_id **全部 NULL**
```

### 1.2 ⚠️ 邀请卡：**已经处理完了**（不是待做项）

源码核查（`MessageScreen.tsx` 行 162-187）：
| field | 当前来源 | 权威来源 | 状态 |
|---|---|---|---|
| 姓名 | `getSession().user.displayName` | ✅ 有 | **已接真实**（WO#8） |
| 头像 | 首字占位（`invite__avatar--ph`） | ❌ 无 avatar 列 | **已改占位**（WO#8） |
| 学院 / 年级 | **已移除**（只留注释说明 MOCK_NOT_WIRED） | ❌ 无来源 | **已移除**（WO#8） |
| 卡片其余文本（"分享我的校园卡"等） | 写死文案 | —— | 属 UI 文案，非数据 |

→ **本单不再动邀请卡**。

### 1.3 ✅ 真正剩余的 mock（**本单范围**）

#### A. 「更多同学」推荐区（`section.suggest`）

| field | 当前来源 | 权威来源存在？ | 处置 |
|---|---|---|---|
| 「推荐谁」这个集合本身 | **写死 9 个 mock 用户**（`users.u5…u11, u1, u2`，行 67-75） | ❌ **无推荐接口、无推荐规则证据** | **defer / redesign** |
| 昵称 | mock | ✅ `users.display_name`（但要有"推荐集合"才有意义） | 依赖上面 |
| 头像 | mock（`avatar()` 生成 SVG） | ❌ 无 avatar 列 | hide / redesign |
| 「相同学校」标签 | **写死** | ⚠️ 链条完整但**数据全空**（school_campus_id 全 NULL、schools/campuses 无数据） | **当前不可得** |
| MBTI / 星座 | mock | ❌ 无列 | hide |
| 学院 / 专业 / 年级 | mock | ❌ 无列 | hide |
| 「添加」好友申请 | **本地 state 假成功**（点了显示"已申请"，什么都没发生） | ❌ 无好友关系表、无申请接口 | **必须处理** |
| 「移除」（从推荐表移除） | 本地 state | —— | 随推荐集合 defer |

#### B. 邀请分享面板（`dialog__sheet`）

| item | 当前来源 | 权威来源 | 处置 |
|---|---|---|---|
| 微信好友 / 朋友圈 / QQ / 复制链接 / 二维码 | **写死的 5 个字符串**（行 335），点了只关面板 | ❌ 无分享能力、未接原生分享 | **必须处理** |

#### C. 与"原版"的关系（避免把"去 mock"当"复刻"）

```
原版**确实有**这些区块（M0/M1 只读观察已记录）。
→ 这些 UI 的存在**不是** mock 错误，而是**当时没有后端支撑**。
→ 本单目标是：
     ① 界面**不再把假数据当真实业务数据展示**（审核记录 44 硬要求）；
     ② 为每个字段明确处置，**不发明字段**、不声称"原版就是这样"。
```

## 二、处置方案（逐区块明确）

审核 44 给的二选一：**隐藏/禁用** 或 **另立接线单**。

```
✅ A1（本单做）：「添加」好友申请的**假成功**必须消除
   现状：点击后显示"已申请"，但没有任何写入、没有接口 —— 用户以为申请发出去了。
   这正是 WO#8 修掉的"mock id 漏进真实 API"同一类问题：**假成功**。
   处置：随 A2 一起处理（见下），不留"看起来成功"的路径。

✅ A2（本单做）：「更多同学」区块改为**明确未接线**
   做法（在"加可见 mock 标签"与"继续安静展示假数据"两个极端之间）：
     移除那些"既无来源、又会被当成真实业务数据"的内容：
       · 写死的 9 个 mock 用户行（头像/昵称/标签/资料/添加/移除）
       · 好友申请弹窗（它只为假推荐服务）
   保留区块本身的壳与标题（不制造新的 1:1 偏差），显示**明确空态**：
       （空态文案属我方选择，标注 OUR_DESIGN_CHOICE —— 原版空态文案无证据）
   并在 ledger 登记 MOCK_NOT_WIRED + WO#11 前置条件。

✅ B（本单做）：邀请分享面板的**假按钮**移除
   理由：它比"显示假数据"更糟 —— 用户会以为分享成功了。
   处置：移除 5 个写死目标；"邀请同学"按钮随之不可用（或一并移除）。
   在 ledger 登记 MOCK_NOT_WIRED（分享能力属原生能力，需独立工作单）。

⏳ C（本单**不做**，另立 WO#11）：推荐 + 好友关系
   它需要三样现在都没有的东西：
     ① **推荐规则**（谁算"可能认识"）—— 无证据、无来源
     ② **好友关系模型**（表结构不存在）
     ③ **好友申请接口**（不存在）
   且「相同学校」依赖 schools/campuses 的**数据**（现在为空）→ 先要决定学校数据从哪来。
   → 这三样都不是"接线"，而是**新能力 + 新决策**。
```

**"明确未接线"的具体形态（避免两个极端）**：
```
❌ 不要：给正式 UI 到处加"这是 mock"的可见标签 —— 那本身制造新的 1:1 偏差（审核 44 禁止）
❌ 不要：继续安静地展示假数据
✅ 而是：**移除**"无来源且会被当成真实业务数据"的内容 → 留下"空着但没撒谎"的界面
```

## 三、Gate（须可失败；沿用 REQUIRED 口径）

```
改前（当前状态，应 FAIL）：
  · "「更多同学」不把 mock 用户渲染成真实推荐" → **FAIL**（当前渲染 9 个）
  · "不存在无行为的假分享目标" → **FAIL**（当前 5 个）
  · "UI 里不出现 mock 用户 id" → **FAIL**
  · "「添加」不产生假成功状态" → **FAIL**

改后：
  SUGGEST_NO_MOCK_ROWS          区块内不渲染任何 mock 用户行（无 data-suggest-user）
  SUGGEST_EMPTY_STATE_EXPLICIT  显示明确空态（文案 OUR_DESIGN_CHOICE，不声称与原版一致）
  NO_FAKE_SHARE_TARGETS         邀请面板不再出现"点了没反应"的分享目标
  NO_FAKE_SUCCESS_PATH          「添加」不再能进入"已申请"假成功状态（或该路径已不存在）
反向断言（防悄悄回退）：
  NO_MOCK_USER_IDS_IN_DOM       DOM 里不得出现 mock 用户 id（u1…u11 形态）
  NO_MOCK_USER_NAMES_IN_DOM     DOM 里不得出现 mock 专有昵称（清单化：蒸柿煮捞呆 / 又又 / eveee …）
  SESSION_NAME_CONSISTENCY      同一屏内 tab 栏 与 邀请卡 对当前用户的显示名**必须一致**
回归：
  THREAD_LIST_REGRESSION（WO#8）／GROUP_REGRESSION（WO#9A）／COMPOSER_REGRESSION（WO#7）／
  SERVER_REGRESSION（M5 gate，先部署 + sha256 校验 + 看账本行）
SENSITIVITY：
  · 临时把 mock 推荐行渲染回来 → SUGGEST_NO_MOCK_ROWS 必须 FAIL；恢复 → PASS
  · 临时在 DOM 里塞一个 u5 → NO_MOCK_USER_IDS_IN_DOM 必须 FAIL；恢复 → PASS
前置（新版 runner 自动执行，任一不过则结论不可引用）：
  VISUAL_TARGET_VALIDITY / **ARTIFACT_PROVENANCE** / API_E2E_ORIGIN_VALIDITY
```

## 四、明确**不做**

```
❌ 不给 users 加 avatar / college / grade / major / mbti / zodiac 列（审核 50 硬边界）
❌ 不实现好友关系 / 好友申请 / 推荐算法（WO#11，且需先定推荐规则）
❌ 不决定 schools / campuses 的数据从哪来（独立决策）
❌ 不声称原版这些区块的行为 —— 只读范围内**只有 UI 存在性**证据，
   其数据来源、是否也允许"添加"、是否也接服务端，**未取证**
❌ 不动邀请卡（已处理完，见 §1.2）
```

## 五、需要审核裁定

```
1. 是否批准 WO#10（范围：§1.3 的 A、B 两处）？
2. §二 A2 的形态：**移除 mock 行 + 保留区块壳与明确空态** —— 可以吗？
   还是你更希望整块移除（不留壳）？我倾向保留壳，因为原版有这一区块，
   整块移除会制造一处新的"与原版不同"。
3. 空态文案是我方选择（原版无证据）—— 这样标注可以吗？
4. §三 的 Gate 是否够？特别是 NO_MOCK_USER_NAMES_IN_DOM 的"清单化"要不要固化成一份
   mock 词表文件（便于机械检查，也便于将来 mock 变化时更新）？
```
