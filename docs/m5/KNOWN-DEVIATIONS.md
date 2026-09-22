# KNOWN_DEVIATION 登记册：**有意的、经批准的功能后撤**

> 时间：2026-09-22 04:55｜Round 261
> 依据：`docs/m5/FIDELITY-GAP-AUDIT-closed-screens-vs-baseline.md` §三 新增纪律 ③
>
> **为什么需要这本册子**
> 本项目目标是严格 1:1 复现。但在过程中，有些原版内容我们**主动没有实现** ——
> 原因是"我们这边没有权威数据/能力"，而不是"我们没做"。
> 这两者在报告里必须可区分：前者叫 **KNOWN_DEVIATION（有意后撤）**，
> 否则一句"WO#10 清理完成"会把**与原版的真实差距**掩盖掉。

## 〇、五条**互相独立**的状态轴（审核记录 52 冻结）

```
IMPLEMENTATION_STATUS     实现有没有做
FUNCTIONAL_VERIFICATION   功能验证过没有
ORIGINAL_CONFORMANCE      与原版是否一致
KNOWN_DEVIATION           有意的偏离（含批准记录与恢复条件）
EVIDENCE_LIMITATION       证据本身的边界（**不是**缺陷、也**不是**后撤）
```

**这五项不得互相代替**，尤其：
```
❌ "功能验证通过" 暗示 "与原版一致"
❌ "实现完成"     暗示 "已 conform"
✅ 每一项单独给状态；本册子管的是 KNOWN_DEVIATION，L 系列管的是 EVIDENCE_LIMITATION
```

## 一、格式约定

每条必须写清：
```
[编号] 屏 / 区域
  原版行为：    （引用基线或 dump 的原文，标注证据强度）
  我们的实现：  （如实描述，不美化）
  后撤理由：    （为什么不做 —— 通常是"无权威来源/无真实能力"）
  批准记录：    （审核记录编号）
  恢复条件：    （什么条件下可以补回来 —— 这才是可执行的 backlog）
```

---

## D-001 「更多同学」推荐区整块内容

```
屏 / 区域：MessageScreen → 「更多同学」
原版行为：  docs/original-baseline/screens/message/baseline.json（截图级 json，逐字记录）
            interactions[2] = 「「更多同学」列表：昵称 + 相同学校标签 + MBTI/星座 + 学院-专业 + 年级」
            （即：原版**确实**渲染这些资料字段）
我们的实现： 整块移除，仅保留区块结构壳 + 中性空态「暂无可显示的推荐」
后撤理由：   三类来源**都不存在**（实测）：
             · users 表无 avatar / college / grade / major / mbti / zodiac 列
             · 无推荐表、无推荐接口、无推荐规则证据
             · 「相同学校」链 users.school_campus_id → campuses → schools
               **两表存在但数据为空、三个用户该列全为 NULL**
            → 保留已是"假权威"，与 WO#10 判据（不得展示会被合理理解为真实业务状态的内容）冲突
批准记录：   审核记录 51（WO10_MESSAGESCREEN_MOCK_DECEPTION_CLEANUP: APPROVED；
            "REMOVE MOCK ROWS / FAKE REQUEST ACTIONS / SHOW NEUTRAL EMPTY STATE"）
恢复条件：   ① 有权威的"推荐集合"来源（推荐规则 + 接口）
             ② users 具备头像与资料字段，且这些字段有真实来源
             ③ 学校数据（schools/campuses）有内容且用户关联非 NULL
            → 属 WO#11+ 之后的新工作单，需先决策"推荐规则"与"学校数据从哪来"
```

## D-002 邀请分享面板（入口 + 面板）

```
屏 / 区域：MessageScreen → 邀请卡「邀请同学」按钮 → 分享面板
原版行为：  baseline.json：
            interactions[1] = 「邀请卡「分享我的校园卡 / 邀请同学一起加入 Campus! / 邀请同学」」
            navigation[1]   = 「邀请同学 → 分享面板」
            （原版**确实有**这个入口与面板）
我们的实现： **入口不再渲染**（连面板一起移除）
后撤理由：   没有任何真实分享能力（未接原生分享 / 无 SDK），
            原实现是 5 个写死的"分享目标"（微信好友/朋友圈/QQ/复制链接/二维码），点了只关面板。
            审核 51 明确要求：没有真实分享能力时「**入口本身必须隐藏/禁用并明确不可用**」，
            否则"点邀请 → 打开空面板"只是把 fake affordance 从第二层挪到第一层。
批准记录：   审核记录 51（"ALSO REMOVE/DISABLE FAKE ENTRY PATH IF NO REAL SHARE CAPABILITY"）
恢复条件：   实现**真实**分享能力（系统分享面板 / 平台 SDK），
            然后恢复入口与面板；届时需核对原版分享面板的结构证据
            （当前该面板结构**未取证** —— baseline 只证明"存在这个导航"）
```

## D-003 邀请卡的学校 / 学院 / 年级

```
屏 / 区域：MessageScreen → 邀请卡（校园卡）
原版行为：  基线未逐字列出校园卡内的字段（baseline 只描述卡片文案与按钮）；
            但 mock.ts 里曾按"学校/学院/年级"渲染 → 我们的**历史实现**是这样
我们的实现： **不渲染**（WO#8 已移除，只留注释说明 MOCK_NOT_WIRED）
后撤理由：   /api/auth/me 只返回 id/handle/displayName/phone；
            users 表无这些列；schools/campuses 为空且用户未关联
批准记录：   审核记录 44（"隐藏/禁用 或 另立接线单"）与 WO#8 的实现
恢复条件：   同 D-001 ③（学校数据 + 用户关联）
```

---

## D-004 校园广场页「校园广场 ▼」面板的**内容**（WO#16 层 A）

```
状态：      KNOWN_DEVIATION / **TEMPORARY**（登记于审核记录 61）
屏 / 区域：CampusScreen → 顶部副标题「校园广场 ▼」点开后的面板
原版行为：  点「校园广场 ▼」→ 出现**校区列表**（校本部 / 威海校区 / 东校区）
            + 「搜索其他学校」入口
            （依据：docs/original-baseline/supplements/schools.json 的 campus_picker；
              注：那份证据采自**地图页**的同类控件，见 WO16-PLAN §一之二 的两页区分）
我们的实现：
  ① 入口**保留**（基线证明「校园广场 ▼」本身存在 —— 审核 60 特别纠正过
     "FeedList 的 HIDE/DEFER 不能机械复制成整块控件消失"）
  ② 但点开后**不显示任何学校列表**，只显示明确状态：
     「学校与校区数据尚未接入」（data-school-picker="unavailable"）
后撤理由：  schools / campuses 两表为空；三个用户 school_campus_id 全为 NULL
            ⇒ 没有任何权威实体可渲染。按审核 60 的计数策略 A：
              "无法由权威归属计算时给 null，**不是 0**、不由 place 推断、不伪造"
我们的处置**优于**改前：
  改前渲染 mock 的 8 个学校 + region + members（如 '12,486'）——**全部无出处**
  （其中 '12,486' 正是 WO#11 从动态列表页判定为编造并移除的数字）
批准记录：  审核记录 61：`SCHOOL_PICKER_UNAVAILABLE: ACCEPTED AS TEMPORARY OUR_DESIGN_CHOICE`
            （并明确"它比展示 8 条编造学校和编造数字正确得多"）
对应 Gate： scripts/m5/gate-wo16a-campus-mock.mjs（5 键；含 CAMPUS_PICKER_ENTRY_PRESENT
            防"过度删除"、CAMPUS_PICKER_NO_MOCK_ON_OPEN 防"点开后仍是假数据"）
恢复条件：  **WO#16 层 B**（已 APPROVED TO IMPLEMENT）：
            seed 北交大 + 3 个基线观察到的校区；实现
            GET /api/schools 与 GET /api/schools/:id/campuses；
            面板改为渲染权威实体；count 不可计算时保持 null（不显示 0）
```

---

## 二、**范围限制**（不是后撤，而是"原版本身没观察到"）

这三条不属于 KNOWN_DEVIATION（我们没有主动少做），而是**基线里就是未知** ——
但它们同样会限制 1:1 主张，故一并登记。

### L-004 ~ L-007：Me 页四个条目的**目的地**未知（审核记录 54）

```
L-004 ORIGINAL_INTEREST_DESTINATION: NOT_EVALUATED
L-005 ORIGINAL_TAG_DESTINATION:      NOT_EVALUATED
L-006 ORIGINAL_BIO_DESTINATION:      NOT_EVALUATED
L-007 ORIGINAL_SCHOOL_DESTINATION:   NOT_EVALUATED
      屏：me（「我的」页）→ 四个条目的去向
      依据：**只**有证据证明"条目存在"与"「编辑资料」→ 资料编辑页"：
            docs/original-baseline/screens/trident-me/baseline.json:38（五个条目的文案与位置）
            :42（「编辑资料」→ 资料编辑页）
            docs/original-interaction-map.md:51
            **没有**证据说明兴趣/标签/介绍/学校各自进入什么页面。
      → 处置（审核 54 冻结）：
        · 「编辑资料」→ ProfileEditScreen      [MATCH, baseline-supported]
        · 其余四项**不得**再进入 ProfileEditScreen（改前五个条目**全部** navigate('profile-edit')，
          等于假装"我的兴趣 = 改昵称页面"），**也**不得接到 App.tsx 里那五个旧 mock 路由
        · 条目本身**保留**（有基线），但当前目的地记为 NOT_EVALUATED / DEFERRED，
          界面上渲染为**不可点的行 + 「待核对」标注**
      → 为什么这不算 KNOWN_DEVIATION：后撤需要有**原版事实**作参照；
        这里我们连原版去哪个页面都不知道，所以它是"范围限制"而不是"我们少做了"。

### L-008：资料编辑页自身的**页面结构**无基线（审核记录 54）

```
L-008 ORIGINAL_PROFILE_EDIT_PAGE_STRUCTURE: NOT_EVALUATED
      屏：profile-edit（资料编辑页）
      依据：docs/original-baseline/screens/ 下 **26 个屏目录里没有该页**
      附带更正：该文件原注释曾写"结构按原版实测：三张卡片…" ——
                这是**无落盘基线支撑的结构主张**，已按审核 54 降级为
                  ORIGINAL_PROFILE_EDIT_ENTRY:          SUPPORTED by trident-me baseline
                  ORIGINAL_PROFILE_EDIT_PAGE_STRUCTURE: NOT_EVALUATED
                  Current layout: OUR CURRENT IMPLEMENTATION / not a conformance claim
                审核 54 也确认没有另一份观察记录可供补证，
                因此**不为保住注释去推断"曾经存在过证据"**。
      → 后果：本页即使 Gate 全 PASS，也只能声称
              authoritative write wiring / data semantics / fake interactions removed 三项，
              不得声称本页"1:1 复现"。
```

```
L-001 ORIGINAL_NORMAL_LIST: NOT_EVALUATED
      屏：feed-list（动态列表）
      依据：baseline.json 的 states.loading/empty/**normal 全部 not_reproducible**；
            known_unknowns = ["有后端且已登录时的正常列表长什么样（**本机无法进入**）"]
      → 后果：我们接线后**不得声称"列表条目形态与原版一致"**，只能声称"数据来源是真实的"。

L-002 ORIGINAL_MESSAGE_LIST_WITH_CONVERSATIONS: NOT_EVALUATED
      屏：message（聊天列表）
      依据：known_unknowns = ["已存在会话时的列表样式（**本机为 0 会话**）"]
      → 后果：我们的会话列表样式（WO#8 后由真实 API 驱动）**没有原版对照物**。

L-003 ORIGINAL_GROUP_NORMAL_STATE_FULL_CONFORMANCE: NOT_EVALUATED
      屏：group（群聊）
      依据：baseline.json 的 states.normal = **unknown**；
            states.empty = observed（该目录下的 normal.png 实为空态截图）
      ⚠️ **审核记录 52 收紧**：**不得**笼统写成 `ORIGINAL_GROUP_NORMAL_STATE: NOT_EVALUATED` ——
         因为我们**确实有**原版群聊的 **XML dump**，能证明若干 normal-state 的局部属性。
         把"整体未评估"写成覆盖一切的结论，会**反过来抹掉已经取得的有效证据**。
      → 正确写法：整体一致性未评估，但保留已观察到的局部事实：

```
ORIGINAL_GROUP_NORMAL_STATE_FULL_CONFORMANCE: NOT_EVALUATED
GROUP_HEADER_STRUCTURE:            OBSERVED     （leftIcon(返回)/chatAvatar/title(群名)/rightIcon）
OWN_MESSAGE_ALIGNMENT:             OBSERVED
TIME_SEPARATOR_PRESENCE:           OBSERVED
PEER_GROUP_PRESENTATION:           NOT_EVALUATED
TIME_SEPARATOR_INSERTION_RULE:     NOT_EVALUATED
```

      → 后果：我们**可以**声称"群聊头部结构与 dump 一致"，
        但**不能**声称"群聊正常态整体与原版一致"。
```

## 三、与 1:1 目标的关系（如实陈述，不含糊）

```
本册子里的每一条都意味着：**当前 demo 与原版在这一处不一致**。
它们**不是**"已完成"的同义词，而是**已登记的差距**。

因此以下说法是**禁止**的：
  ❌ "WO#10 已完成 → MessageScreen 与原版一致"
  ✅ "WO#10 已完成 → 假数据/假成功已清除；与原版相比有 3 处 KNOWN_DEVIATION（D-001~D-003）"
  ❌ "WO#11 接线后 feed 与原版一致"
  ✅ "WO#11 接线后 feed 数据来源真实；但原版正常列表从未被观察到（L-001），故不做形态一致性主张"
```
