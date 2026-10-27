# 审核记录 53：WO#12 批准（插队）+ identity 安全原则 + 三处只读扩展的边界

> 时间：2026-09-22 06:12｜Round 263｜来源：网页版 ChatGPT 独立审核
> 对应提交：本轮 WO#12 实施

## 一、状态更正（审核 53 明确指出）

```
WO#11: **PASS / CLOSED**（上一轮已裁定）
未定位的间歇登录失败: 裁定为"**记录并观察 + 下次失败自动抓现场**"，
                      **不要求**现在盲跑 10 次统计失败率
```

→ 我此前多等了一轮（把已裁定的项当"待裁定"），属流程判断偏差。

## 二、WO#12 裁定

```
WO12_USER_PROFILE_AUTHORITATIVE_IDENTITY: APPROVED
PRIORITY: **PREEMPTS NORMAL MOCK-CLEANUP ORDER**（插队）
不拆 P0 小单 —— 要闭合的是一条完整链路：
  Feed/Post authorId → user route identity → authoritative user lookup
  → displayed identity → author-scoped posts → private-message destination
只删 fallback 会立刻留下一个不可用页面。
```

### ⭐ 冻结的 identity 安全原则（适用于**以后所有** identity surface）

```
unknown / malformed user id → **明确的不可用态**
**NEVER** → 回落到另一个用户
即：禁止"查不到 A 就展示 B"。
```

### `GET /api/users/:id`（批准）

```
200: { "id": "<uuid>", "displayName": "Lemy" }
unknown: 404
当前阶段**只允许这两个字段** —— 不要顺手把 phone / campus / 学院 放进来。
```
理由：displayName 已经通过 post author、thread members 等 surface 向用户展示过，
该接口只是提供"按 user identity 稳定查询"的权威读模型，不引入新数据类别。

**`u:<uuid>` 的处理**：保留兼容解析，但**内部立刻 normalize 成真实 UUID**；
以后新生成的 profile link 尽量直接携带 canonical UUID，**不要让 `u:` 成为另一个永久隐式协议**。

### 「TA 的动态」：**不要**默认客户端过滤

```
若 GET /api/posts 已支持 ?authorId=<uuid> → 直接用
若没有 → 本单**给现有 endpoint 增加这个只读 filter**，而不是 client.filter(...)
理由：客户端过滤只在 /api/posts 永远返回完整全集、无分页/limit 时才能代表"TA 的全部动态"；
      一旦分页，它会**静默变成**"不完整但看起来完整"。
USER_POSTS_SOURCE: prefer authoritative server-side author filter
```

### `GET /api/threads` 增加 `peerId`（批准，仅 direct）

```
direct: { id, kind:"direct", peerId, peerName, ... }
group:  peerId: null, peerName: null（或省略，schema 明确即可）
机械验证：direct.peerId == thread_members 中**除当前用户外**的另一成员 id
```
**重要边界**：`peerId` 只回答"已有 direct 会话中对方是谁"，
**不**回答"从没聊过的人点私信该怎样创建会话"。

```
私信行为分两种：
  · 恰好 1 个 direct thread 且 peerId == profileUserId → #/chat?id=<真实 thread UUID>（可验证）
  · 0 个匹配 且 没有经过验证的"创建/获取 direct conversation"能力
      → **不得制造 t1、不得猜一个 thread、不得假成功**
      → hide 或显式 unavailable，标 OUR_DESIGN_CHOICE
Gate 不要只叫模糊的 MSGDEST_REACHABLE，至少区分：
  PROFILE_DM_EXISTING_THREAD_IDENTITY
  PROFILE_DM_NO_MOCK_THREAD_ID
  PROFILE_DM_NO_DESTINATION_NO_FAKE_ACTION
```

### 「关注」：直接去掉 fake action（批准）

```
FOLLOW_CAPABILITY: NOT_IMPLEMENTED
→ no clickable fake follow control
不要为了保留视觉结构做一个 inert button。
```

### 无原版基线（认可我的处理）

```
ORIGINAL_USER_PROFILE_BASELINE:      UNAVAILABLE
ORIGINAL_USER_PROFILE_CONFORMANCE:   NOT_EVALUATED
→ WO#12 即使全部 PASS，也只能声称：
    authoritative identity wiring: PASS
    authoritative data semantics:  PASS
    fake interactions removed:     PASS
  **不能**声称 "UserProfile 1:1 reproduced"
```

## 三、审核 53 给出的最终 Gate 清单（本单已全部实现）

```
USER_PROFILE_IDENTITY_FROM_ROUTE
USER_PROFILE_DISPLAY_IDENTITY
NO_MOCK_IDENTITY
INVALID_PROFILE_ID_NO_FALLBACK

USER_POSTS_FROM_AUTHORITATIVE_SOURCE
USER_POST_IDENTITY_SET_CONTINUITY

USER_PROFILE_AVATAR_PLACEHOLDER
USER_PROFILE_NO_SOURCELESS_FIELDS

NO_FAKE_FOLLOW

PROFILE_DM_EXISTING_THREAD_IDENTITY
PROFILE_DM_NO_MOCK_THREAD_ID
PROFILE_DM_NO_DESTINATION_NO_FAKE_ACTION

ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED
```
敏感度（审核 53 指定）：
```
restore mock fallback        → NO_MOCK_IDENTITY / INVALID_PROFILE_ID_NO_FALLBACK 必须 FAIL
restore #/chat?id=t1         → PROFILE_DM_NO_MOCK_THREAD_ID 必须 FAIL
```

## 四、后续优先级（审核 53）

```
WO#12 完成后，正常优先级回到此前被这次身份缺陷插队的 **ProfileEditScreen**，
因为它那里仍可能存在 **fake write-success** 风险。
```

## 五、本轮我自查出的问题（已记入提交信息）

```
① 擅自把 sess.user.userId 改成 sess.user.id → 会静默破坏 likedByMe（已当场核实并改回）
② gate-wo12 漏定义 API_ORIGIN → 三段探针运行时 ReferenceError（语法检查抓不到，因为不是语法错误）
③ 门禁顺序错误：4d/4e 放在 4b（非法 id 用例）之后，读到的是"不可用态"那一页 → 假 FAIL
④ 头像断言口径错：用"整页 imgCount===0"当判据 → 在"TA 有带图动态"时必假 FAIL
   （正确判据是"**头像元素本身**是首字占位"）
⑤ **/^t\d+$/ 写在模板字符串内部** → `\d` 被解析成 `d`，正则变成 /^td+$/、**永不匹配** →
   断言恒 true、完全失去判别力。**是敏感度测试把它暴露出来的**
   （注入 mock thread id 后 noMockThreadId 竟然是 true）
⑥ 修 ⑤ 的注释时**又用了反引号**（第 7 次）→ 提前闭合外层模板 → SyntaxError
   → 被 check-gate-syntax.sh 当场抓到（那条机械检查正是为这类问题建的）
```
