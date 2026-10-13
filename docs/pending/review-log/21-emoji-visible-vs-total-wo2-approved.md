# 审核记录 21：表情数量应"撤销 7 但不冻结为 6"；WO#2 批准（带两处修订）；新增一条 Gate 原则

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 17:45（Asia/Shanghai）

## 一、表情数量：**撤销"总数=7"，但也不要冻结成"总数=6"**

审核原话要点：

> 新入库的原始 uiautomator XML 是**可机械复核的一手产物**，优先级显著高于没有原始产物支撑的旧 supplement 摘要。因此：
> - 旧结论 `original emoji count = 7`：**撤销**
> - 据 7 修改产品：属于一次**真实 conformance regression**；回退正确
>
> 但你自己的边界判断也成立：RecyclerView dump 只保证**当前已附着/可见**节点。
> 因此当前最严谨的冻结应该是：

```
ORIGINAL_VISIBLE_EMOJI_ITEMS:    6
CURRENT_VISIBLE_EMOJI_ITEMS:     6
VISIBLE_EMOJI_COUNT_CONFORMANCE: PASS

ORIGINAL_TOTAL_EMOJI_COUNT: NOT_EVALUATED
EMOJI_CHARACTERS:           NOT_CAPTURED
EMOJI_SPACING:              NOT_EVALUATED
```

> 所以实现保持 6 是当前最符合证据的选择，但**不要再把"总数恰好 6"写成已证明事实**。
> 除非后续只读证据能证明 RecyclerView 不可横滚、且数据集确实只有 6 项。

**要点**：我上一轮把"视口内 6"当成"总数 6"了 —— 这仍是一次（较轻的）过度声明。
审核给了正确的拆分方式：**"可见项数量"与"总数"是两个不同的事实**。

## 二、纪律正式升级为**项目 Gate 原则**

> 你总结的纪律我完全同意，而且建议正式升级成项目 Gate 原则：
>
> **任何用于驱动 conformance 产品改动的事实，必须能追溯到可复核原始产物；
> 只有摘要、没有原始产物的内容只能作为线索，不能单独触发实现变更。**
>
> 最好今后让每个 conformance finding 都具有
> `raw_evidence → extraction/observation → conclusion → implementation impact` 这条链。

**这条已作为 Gate 原则记入本项目**（见 PLAN.md 相应章节）。

## 三、底部 tab：新 dump **supersede** 旧结论，且是一个必须登记的 M5 deviation

> 新 raw dump 得到的四个底部 tab 也是一次**实质性的证据升级**。
> 此前"只有 <昵称>/校园/地图 三项"的旧结论应被 **supersede**。
> 现在可以冻结的是当前观察到的：
> ```
> 校园广场 / <当前账号昵称> / 校园 / 地图
> ```
> 其中第二项**动态跟随账号昵称**。
> **如果当前实现不是四项，这应该作为 `AUDIT-M0-M4.md` 的一个明确 M5 deviation**，
> 而不是继续沿用旧摘要。

**待办**：核对我们的 `TabBar` 实现是否为 4 项；不是就登记为 M5 deviation。

## 四、M5 工作单 #2：**批准**，但 board_notes 要先完成最后两个 closeout

> 设计上 **APPROVED**。执行顺序仍建议：
> **board_notes：from_user_id 等身份字段 strict 400 + 第三账号真机隔离验证
> → Slice 1 CLOSED → 再开 WO#2。**

状态：
- 身份字段 strict 400 —— **已完成**（`c2effd4` + 端到端 `BOARD_NOTES_RESULT PASS`）
- **第三账号真机隔离验证 —— 未完成**（用第三个账号在设备上验证"读不到他人之间的留言"）

### WO#2 的两处修订（必须遵守）

> WO#2 本身继续按我上一轮的两个修订冻结：
> 1. **API 用单数 `mediaId`，不是 `mediaIds[]`** —— 因为**当前没有证据支持一条消息多图**
> 2. **上传成功、消息发送失败留下的 unattached media 必须有 TTL GC 生命周期**，
>    不能永久吃磁盘

**第 1 条对我上一轮的计划是直接修正**：我写的是 `mediaIds[]`，理由是"为将来多图留余地"——
但那属于**没有证据的扩张**，与"不做多图"的决定自相矛盾。改成单数 `mediaId`。

## 五、"是否限制只能挂本次上传的 media"：**不限制**（我原判断正确）

> 你原来的判断正确。发送图片消息时应满足：
> ```
> current user 是 thread member
> media exists
> media.scope = private
> media.owner_user_id = current session user
> media 当前有效
> kind = image
> ```
> 就足够。**不要求** media 必须刚刚由这一次 composer 上传。
> 额外做"本次上传绑定"反而会引入 upload session/correlation token 等**没有证据价值的状态**。
>
> 若同一个 media 被引用到多个会话，读取授权仍沿用 M4 已冻结规则：
> **请求者只要能读取至少一条引用该 media 的 live message，才可以读取该 media。**

## 六、"不做多图"：可以，但**不能说它符合原版**

> 目前没有 admissible evidence ……（原文在此截断）

即：实现上不做多图可以，但**措辞必须是"未评估/无证据"**，不能写成"原版也是单图"。

## 七、下一步（按裁定顺序）

1. **完成 board_notes 的第二个 closeout：第三账号真机隔离验证** → Slice 1 CLOSED
2. 把上述冻结的 key 写进文档（`ORIGINAL_VISIBLE_EMOJI_ITEMS` 等 6 个），
   **不再声称总数**
3. 核对 TabBar 是否 4 项；不是则登记为 M5 deviation（含旧结论被 supersede 的说明）
4. 启用 Gate 原则：给 conformance finding 建 `raw_evidence → observation → conclusion → impact` 链
5. 然后开 WO#2（**单数 `mediaId`** + **unattached media TTL GC**）
