# 审核记录 10：Slice 2 验收（CLOSED）与 Slice 3 批准

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 12:51（Asia/Shanghai）
> 提交物：`docs/archive/legacy-development/m3/SLICE2-REPORT.md` + Gate 输出 + 只读观察补充证据

## 正式状态

```
M3 Slice 2: CLOSED
M3 Slice 3: APPROVED TO START
```

## 一、冻结的可采信结论

审核原话（要点）：

```
原版可采信：0 赞 → 不渲染计数、非零点赞数为纯数字、0 评论 → 显示“评论”、不存在点赞用户列表；
自建系统可采信：POST/DELETE 幂等、跨用户隔离、likedByMe 与 likeCount 分离、
                服务端权威计数、重载后状态持久；
原版点赞/取消后的状态变化继续是 BLOCKED_BY_POLICY，
没有被自建实现反向冒充成 1:1 证据。
```

## 二、必须修正的证据措辞（不需要 reopen Slice 2）

审核原话（要点）：

```
like_animation_view 的存在只能直接证明原版存在点赞动画相关的 UI/view 结构，
不能仅凭这个节点断言“点击点赞时一定会播放某种动画”。
由于真正触发动作被政策禁止，建议文档写成：
  LIKE_ANIMATION_CAPABILITY: OBSERVED
  LIKE_ANIMATION_TRANSITION: BLOCKED_BY_POLICY
而不是直接写“原版点赞有动画”。
```

**已修正**：`supplements/slice2-likes-readonly.json` 与 `SLICE2-REPORT.md` 均改为上述两条双维度写法，
并在 JSON 里留了 `wording_note` 说明这是"把存在结构说成了存在行为"的典型过度断言。

> 这是一条通用教训：**观测到能力 ≠ 观测到行为**。
> 一个 view 节点的存在只能支撑"有这个能力"；要断言"某个交互会发生什么"，
> 必须有触发后的证据 —— 而触发被政策禁止时，就该记 BLOCKED_BY_POLICY。

另一个被接受的原则：**"解析失败必须直接 FAIL"** ——
不允许拿解析失败的垃圾数据继续往下判断（Slice 2 曾因引号被吃掉解析出 `likes=-c:`，
若不设这条自检，Gate 可能"带着垃圾数据碰巧通过"）。

## 三、Slice 3 工作单（审核批准）

审核要求的核心价值（不是"又能发一次帖子"）：

```
真实手机号 OTP 登录
→ session
→ PublishScreen
→ 请求体不含 author / authorId
→ backend 从 session 解析 author_id
→ 写入 PG
→ 返回校园页/刷新
→ UI 作者与登录身份一致
→ App 重启后仍存在
```

补充硬要求：

1. **必须再机械验证一个攻击用例**：客户端手工给 POST 塞入 `author` / `authorId`
   → strict 400，**且数据库不能产生任何行**。
2. **原版继续保持只读取证**：不要为了观察"发布成功后的反馈/跳转/动画"去真正发布内容；
   相关 transition 若没有现成只读证据，明确记为 `BLOCKED_BY_POLICY`。
3. **不要整段复用 `verify-device-login.ps1`** 来驱动 Slice 3 ——
   它包含 logout、cleanup 等 Slice 0B 的验收副作用，两个 Gate 会互相耦合。
   应把其中"冷启动 → OTP 登录 → 得到已登录设备状态"抽成**可复用 helper**，
   由 Slice 0B 与 Slice 3 各自调用。
