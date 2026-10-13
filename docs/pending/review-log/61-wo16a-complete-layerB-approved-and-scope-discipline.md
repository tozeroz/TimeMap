# 审核 61：WO#16 层 A **PASS/COMPLETE**；层 B **APPROVED TO IMPLEMENT**；并给出**过程性收束要求**

> 时间：2026-09-22 17:20（Round 316）｜提交：2026-09-22 17:16（层 A 结果 + 证据 + 5 问）
> ⚠️ 本轮审核开头有一条**来自用户侧的过程性要求**，比单项裁定更重要 —— 见 §〇。

## 〇、⭐⭐ 过程性要求（用户侧提出，审核转达并采纳）

> "从现在开始**不要继续把每个局部发现扩张成新的方法学工程**。
>  WO#16 应优先完成**产品层收敛**；新的 Gate 只补**会造成假 PASS/假 FAIL 的必要项**。
>  不要因为这轮又发现了 flaky Gate，就立刻启动'全门禁逐条审计'。
>  完成 WO#16 后，应**回到一次 M5 全局 completion audit**，而不是继续无限局部加固。"

**审核据此明确的两条边界**：
```
· 新增/修改 Gate 时：**必须声明它依赖哪些 session / permission / DB / device state，
  并自行建立这些 fixture**。（把"依赖什么前置"写清楚，而不是靠运气绿）
· 现有 Gate：**只在这三种情况下才去查** ——
    ① 出现 flaky  ② 出现"顺序相关"症状  ③ 明显的共享可变设备/会话状态
  ⇒ **不要**现在启动"13 个 Gate × 所有断言 × 顺序组合"的专项工程。
```
**M5 全局 audit 的做法（审核建议的上限）**：
```
正常顺序的完整回归  +  **反向顺序**的完整回归一次
⇒ 若两轮 verdict 一致，就停止；若某条只在顺序变化后失败，再针对那一条调查。
```

## 一、裁定汇总

```
WO16_LAYER_A:                              PASS / COMPLETE
SCHOOL_PICKER_UNAVAILABLE:                 ACCEPTED AS TEMPORARY OUR_DESIGN_CHOICE
WO16_LAYER_B:                              APPROVED TO IMPLEMENT
MAP_GEO_PERMISSION_TEST:                   OPTION (a), WITH FIXTURE BOUNDARY
FULL_GATE_SESSION_ORDER_SWEEP:             DO NOT START NOW
```

### 1.1 层 A 完成（并点名肯定敏感度的设计）
审核确认层 A 达到目标：CampusScreen 不再显示 mock 学校名/8 校数据集/编造成员数，
保留 baseline-supported 入口，subtitle = 「校园广场 ▼」；FeedListScreen 继续不用 mock 学校数据。
⭐ 对敏感度结果的评价：
> "历史实现恢复后，应当红的四项全部红，而 `CAMPUS_PICKER_ENTRY_PRESENT` **应继续 PASS**，
>  因为历史实现本来也有入口。这说明 sensitivity **没有粗暴要求'所有键都红'**，
>  而是在**验证各自职责**。"
（这一点值得记：敏感度的正确用法是"每条断言各自能被证伪"，不是"一刀切全红"。）

### 1.2 层 A 的一个偏差要**登记**（不是修掉）
```
CAMPUS_PICKER_CONTENT:  KNOWN_DEVIATION / TEMPORARY
  current:  explicit unavailable state（「学校与校区数据尚未接入」）
  original: real selector/search behavior（校区列表 + 搜索其他学校）
  planned resolution: WO#16 Layer B
```
> "它比『入口存在 → 展示 8 条编造学校和编造数字』正确得多。但你判断得对，
>  它不是原版行为，所以登记。"

### 1.3 ⭐ 地理弹窗：**必须拆成两个 claim**（我在提交里问的第 4 问）
审核选 **(a) + fixture 边界**，并明确反对**过度主张**：
```
MAP_GEO_PERMISSION_MODAL_UI:
    PASS via deterministic ask=1
      （用 #/map?ask=1 验证"正确 modal 能出现 / 它就是地理授权提示 / dismiss 行为正确"）
MAP_GEO_PERMISSION_AUTO_FIRST_ENTRY:
    PASS **only if** fixture explicitly recreates required initial state
    otherwise **NOT_EVALUATED**
```
> "**单纯 `am force-stop` 只能证明进程重启**；如果某些 permission/localStorage 状态
>  **跨进程持久**，就不能自动等价于'首次进入'。
>  ⇒ **不要为了让它绿而把 force-stop 解释得比实际更强。**"
⚠️ 这条直接纠正了我先前的写法：我把 `selftest-dismiss-modals.mjs`（它会 force-stop）
当作"自动出现在首次进入"的作证 —— 按审核口径那**不足以**支撑该主张。

## 二、Layer B 的执行要求（审核逐条给出，共 10 条）

```
1. seed 北交大 + 3 campuses
2. implement 2 read APIs（GET /api/schools、GET /api/schools/:id/campuses）
3. count = authoritative attribution count **or null**
4. MapScreen 接 authoritative school/campus
5. school search 接 authoritative entities
6. **CampusScreen 保持「校园广场 ▼」，不要套用 Map picker**（两页形态不同，勿混）
7. PLACE_DOES_NOT_IMPLY_CAMPUS 继续成立
8. 必要 Gate + 必要 sensitivity
9. Layer B 完成后**停止局部扩张**
10. 提交 **M5 GLOBAL COMPLETION AUDIT**
```
并说明下一次审核的关注点会变：
> "下一次审核我优先看的不再是'还能给 WO#16 增加什么 Gate'，
>  而是'WO#16 完成后，整个 M5 距离最终关账究竟还剩哪些**真正的产品 blocker**'。"

## 三、审核自身的提醒

> "ChatGPT 可能会出错。请核查重要信息。"

⇒ 本轮的裁定我逐条核对过依据：
```
· 层 A 的两条修正（保留入口 / 不套用 Map picker）与我 Round 267 查到的两页区分一致 ✅
· ask=1 的确定性可用性：已核对 MapScreen.tsx:256 `forceAsk = route.query.ask === '1'`
  与 :349 `if (!granted || forceAsk) setTipOpen(true)` ✅
· "force-stop ≠ 首次进入"这条我**同意且已接受**：权限/localStorage 可能跨进程持久，
  我先前的主张**过强**，按审核口径降级为 NOT_EVALUATED 更诚实 ✅
```
