# X4 自查（**更正版**）：`baseline.json` 过期快照的实际影响

> 时间：2026-09-22 09:10｜Round 265｜**本文件替换我先前的初版结论（初版被我自己推翻）**
> 起因：`baseline-inventory.mjs` 的 supersedes 追踪曾让我发出警报；
> 随后发现**是我的工具读错了权威来源**，警报被夸大。本文件是更正后的结论。

## 〇、我先前的两次错误（同一回合内，都必须记）

```
错误 A（初版自查）：我只检索了 5 个文件就写"影响面比担忧的小"。
   → 全仓扫描显示这 6 个屏名出现在 **32~65 个文件**里。**又一次窄搜索。**
错误 B（工具第一版）：`baseline-inventory.mjs` 只读 `screens/<id>/baseline.json`，
   把它们直接当"当前状态"汇报 → 报出 6 屏 blocked/未观测，
   并让我对审核说"6 屏 baseline.json 被取代 ⇒ **既有结论都可能过期**"。
   → 真相：**权威状态在 `docs/original-baseline/manifest.json`**，
     而 `docs/m3/EVIDENCE-PROVENANCE-AUDIT.md:98` 早已写明
     「baseline coverage：**22 observed / 0 evidence-blocked**，已由 Preflight 定案，不再变」。
   → 即：**项目没问题，是我的工具读错了文件。**
```

## 一、更正后的实际状态（以**权威索引**为准）

```
权威索引：docs/original-baseline/manifest.json   expected_screen_count = **22**
（与 M3 审计的 "22 observed / 0 evidence-blocked" 完全一致）

每屏权威 observed（节选）：
  trident-map      normal        ← 地图页：baseline 与快照一致，ok
  poi-search       normal        ← 地点选点页：ok
  poi-detail       **normal**    ← 权威索引里已是 normal；**旧快照**仍是 blocked → **MISMATCH**
  media-preview    **normal**    ← 同上 MISMATCH
  at-panel         **normal**    ← 同上 MISMATCH
  comment-detail   **empty**     ← 权威是 empty（不是"未知"）；快照 ok
  login-select     normal        ← ok
  login-sns        normal        ← ok

快照一致性小结：**只有 3 个屏**的 `baseline.json` 与权威索引不一致
  → poi-detail ／ media-preview ／ at-panel
目录 vs 索引：`original-chat`、`original-sweep` 只在目录里 —— 它们**不是 baseline 屏**
             （只有 INDEX.md），权威屏数口径就是 22。
```

## 二、所以真实影响是**小的、且已被项目记录过**

```
① **权威索引正确且最新**（22 屏、状态已更新）→ 项目侧没有"系统性证据时效问题"。
② 只有 **3 份旧快照**（at-panel / media-preview / poi-detail 的 screens/<id>/baseline.json）
   **没有回写**；但它们的被取代关系**已明确记录**在 supplements/*.json 的 `supersedes` 字段里。
③ 因此**引用"状态标签"会有风险，引用"具体证据"不会** —— 而本项目此前的做法正是后者：
   `scripts/m5/fixtures/baseline-manifest.json` 的 at-panel 块写着
     "baseline.json **内容为空**（所有 states not_reproducible…）；**另有 recovered-m3-ui.xml**"，
     并且 AT_PANEL_KIND 用的是「**换了证据来源**：APK 静态布局 res/XZ.xml」，
     搜索框那条用 recovered-m3-ui.xml 且**拒绝**把"dump 里没有"升级为"原版没有"。
   ⇒ 这套写法**对'快照过期'免疫**，因为它引用的是**具体证据**而不是状态标签。
```

## 三、仍然成立的**一个小提醒**（不是警报）

```
· 我此前的结论文档里，**只有 1 处**实质引用了这 3 个过期快照之一的状态标签：
    docs/m5/FIDELITY-GAP-AUDIT-closed-screens-vs-baseline.md 的 at-panel 小节
  其余大量出现（32~65 个文件）是**屏名作为标识符**（Gate 名、日志、计划标题），不是状态引用。
  ⇒ 建议该小节按权威索引复核一次（低成本）；其余无需动。
· 真正需要"看"的是那 3 屏恢复后的**截图**（at-panel / media-preview / poi-detail 的 recovered-m3.png）。
  它们能把若干 `NOT_EVALUATED` 升格为视觉直接证据 —— 但**需要可用的图像通道**：
  本会话 `vision` 工具**两次调用返回空**（疑似未配置）。这是**唯一的实质缺口**。
```

## 四、本轮真正学到的东西（比结论更重要）

```
**"读的是不是权威来源"**这一条，与本项目已有的 Target/Fixture/Origin/Artifact/Observation validity
是同一族，应补为 **Source validity（来源权威性）**：
    · 同一事实可能有**多个副本**（屏内快照 / 聚合索引 / 补采），并且**副本会过期**；
    · 引用前必须确认"我读的这一份是不是权威的那一份"；
    · 且**否定性结论**（没有/未知/BLOCKED）要求更高的证据门槛：
      必须先证明 搜索范围完整 ＋ 来源权威 ＋ 无更新记录取代。
落地形态：已把"权威索引优先 + 快照不一致即 MISMATCH"写进 `baseline-inventory.mjs`。
```

## 五、边界（不夸大）
- 本更正基于**读文件**；`vision` 不可用，故**未做任何视觉核对**。
- 我未修改任何既有结论或 manifest。若裁定要动 at-panel 那一节，应单独提交。
- 全仓扫描覆盖 `docs/` 与 `scripts/` 共 **497 个文件**（.md/.json/.mjs/.sh/.txt）；
  其余扩展名（如 .png 二进制）未在其中。
