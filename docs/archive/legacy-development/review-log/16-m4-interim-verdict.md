# 审核记录 16：M4 中期裁定（改名 + A/B/C 三项指示）

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 15:17（Asia/Shanghai）

## 一、最重要的一条：key 命名纠正（过度声明）

> 我不会把当前这个 `M4_GATE_RESULT: PASS` 视为 M4 阶段 PASS。
> 它更准确应叫：`M4_STORAGE_GATE_RESULT: PASS` 或 `M4_INTERIM_GATE_RESULT: PASS`。
> 因为：A 消息消费端没完成；C @ mention 还是 M4 已冻结范围内的未完成项；
> REGRESSION = NOT_RUN；还有几项我之前点名的 storage closeout 在这份摘要里没有被证明覆盖。

```
M4 storage subsystem：主体 ACCEPTED
M4 overall：IN PROGRESS
```

**已改**：`gate-server.sh` 现在输出 `M4_STORAGE_GATE_RESULT`，并显式打印
`M4_OVERALL: IN_PROGRESS`。阶段最终结果留给未来的 `M4_FINAL_GATE_RESULT`。

> 这是一次真实的过度声明：我把"一个子系统过了"写成了"阶段过了"。
> 与本项目此前"页面可以 PASS 而某些 transition BLOCKED"的教训同源 ——
> **结论的作用域必须和证据的作用域一样大**，不能更大。

## 二、A：优先做消息/图片前端（同意）

> 现在最明显的缺口就是：后端已经支持 private media / message_media，
> 但用户侧没有任何消费路径。
> A1 message kind → A2 conversation/message list 接真实 API → A3 image message rendering
> → A4 revoked message presentation → A5 private-media authorization E2E

### ⚠️ A 开工前的前端技术点（这条很关键，我原本会踩）

> 你现在私有媒体要求 `Authorization: Bearer ...` + `GET /api/media/:id`。
> 而普通的 `<img src="/api/media/:id">` **不能像 fetch() 那样主动附加 Bearer header**。
> 所以私有聊天图片**不能机械复制公共 feed 图片的加载方式**。

推荐做法：

```
authenticated fetch(/api/media/:id, Authorization)
        ↓
response.blob()
        ↓
URL.createObjectURL(blob)
        ↓
<img src="blob:...">
        ↓
组件卸载时 revokeObjectURL()
```

> 这样仍然经过 session → can_read_message → can_read_media → X-Accel → file，
> 而不会为了让 `<img>` 好用，退化成"只要知道 URL 就能访问"。

**Slice A 的 Gate 必须专门证明**：

1. 群成员能 render；
2. 非成员拿同一 media id 仍 404；
3. logout 后重新加载不能取得私图；
4. message revoke 后重新 fetch 404；
5. **不把 bearer 写进 URL/query**；
6. blob URL 在组件销毁后 revoke。

## 三、B：中间 gate 不必每次跑全 M3；**M4 Final 必须跑**

> 日常 / 每个 M4 slice：不用每次花约 5 分钟重跑完整 M3。
> 可以：PERSISTENT fast checks + 当前 M4 slice + 相关 targeted regression
> （做聊天图片时重点回归 auth/session、TLS、private authorization、message membership、media storage）。
>
> M4 Final Gate：**必须在当前 HEAD 执行完整 regression**。可以调用 M3 final regression harness
> （复用脚本），但 M4 必须拥有最终结果：
> ```
> M4_FINAL_GATE_LAYERS:
>   PERSISTENT: PASS
>   STAGE:      PASS
>   REGRESSION: PASS
> ```
> "由 M3 gate 负责"只能理解成**复用 M3 脚本**，不能理解成"以前 M3 PASS 过，所以 M4 不再重跑"。

## 四、C：**不要**把 @ mention 推到 M5

> 这是这轮我和你倾向唯一明显不同的地方。
> @ mention 在我们冻结 M4 时就是明确范围：message kind + media reference + **mention relation**。
> 如果现在写 `NOT_EVALUATED → M5`，会再次出现 milestone scope 偷偷漂移。

推荐顺序：**A → C → storage closeouts → M4 Final Gate**

C 本身**不需要**做原版 conformance，可以明确：

```
SELF_OWNED_MENTION_FUNCTIONAL: PASS
ORIGINAL_MENTION_MODEL_CONFORMANCE: NOT_EVALUATED
  reason=original evidence inadmissible
```

> 实现自己的 mention relation ≠ 声称原版内部就是这个模型。

C 的范围不要扩张，最小闭环：

```
message_mentions
----------------
message_id
mentioned_user_id
```

若支持 @所有人，**单独明确其语义，不要伪造成某个 user id**。

Gate 验证：

- 发送消息 + mention A → 产生 mention row
- mention 一个**不属于会话**的用户 B → reject
