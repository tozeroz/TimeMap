# 审核记录 06：M2 结果验收（Gate + 证据）

> 提交物：`docs/pending/m2/REPORT.md` + `docs/pending/m2/DATA-MODEL.md` + `docs/pending/m2/evidence/`
> 审核方：ChatGPT web（远程独立审核）
> 提交时间：2026-09-21 05:50（Asia/Shanghai）

## 结论：M2 ACCEPTED / CLOSED

```
M2: ACCEPTED
AUTH_FUNCTIONAL: PASS
TRANSPORT_SECURITY: PASS
DATA_MODEL_V0.1: ACCEPTED WITH TWO DEFERRED VALIDATION POINTS
  - comments.parent_id
  - schools entity
BACKUP_RESTORE: PASS
SEED_CONVERGENCE: PASS
M2_GATE_RESULT: PASS
```

## 本轮唯一的收尾修改要求

**删除 `POST /api/auth/dev-register`，把造账号能力移出业务 API。**

理由（原文）：技术上并不危险（默认关闭），但会产生长期问题 ——
生产二进制里永久存在一个「条件开启的注册能力」，以后环境变量配置失误就可能
把本来不存在的产品能力暴露出来；而本项目明确没有产品注册需求。
核心原则：**测试夹具能力不要伪装成业务 API**。
改法建议：`scripts/dev/create-user.*`，或 `node dist/index.mjs create-user ...`，或让 seed 创建固定用户。

## 其他裁定（均已采纳）

1. **计时断言的结论强度**：认可我把它降为「只判断不存在分支是否真的执行了 scrypt」，
   并明确要求**名字要诚实** —— 建议叫 `DUMMY_SCRYPT_EXECUTION`，不要叫 `TIMING_ATTACK_SAFE`
   （后者是过度声明）。预热的 dummy hash 也认可。
2. **`comments.parent_id` 已成为「待证假设」**：M3 必须对它产生明确结果 ——
   `SUPPORTED` 或 `NOT_SUPPORTED → 删除 parent_id`，不允许长期停留成"先留着也没事"。
   `schools` 同理。原则：**Observed fact ≠ forward-compatible guess**。
3. **Gate 分层方向正确**：M2 再次暴露"M1 阶段事实被当成永久不变量"（posts 恰好 5 列、
   迁移恰好 1 个、无 token 能写）。真正该长期验证的是
   「必需的历史列仍存在」「必需的迁移基线仍存在」「原有持久化语义仍成立」，
   而不是「schema 永远等于 M1 那一天」。
   `nginx -T` 检查生效配置优于 grep 具体文件路径 —— 原则：**Gate 验证 externally meaningful state，
   而不是 implementation location**（除非该 location 本身就是 contract）。
4. **TLS 闭环认可**：正确 CA + 错误 IP → FAIL 这一对照，证明了自定义 CA 生效、
   hostname/IP 校验仍然生效、且没有用危险的 TrustManager/HostnameVerifier 绕过。
   未要求整改；只需把 leaf rotation + nginx reload、以及 M6 换公共 CA 留在计划里。
5. **80 端口保留认可**：M0 的历史 acceptance contract 依赖 `http://IP/health == 200`，
   不为"看起来更生产化"提前改 301；M6 再统一迁移，历史 Gate 用 `-Stage M0` 保留原语义。
6. **Gate 缺陷分类补第 4 类**（已采纳到 PLAN 第十节）：

```
Gate failure
├─ PRODUCT_DEFECT
├─ GATE_DEFECT
├─ ENVIRONMENT_DEFECT
└─ EXTERNAL_BLOCKER   ← 新增：云安全组未开放 / DNS 未配置 / 第三方不可用 / 用户控制台动作未完成
```
   这样"443 没开放"不会被错误归到 environment 或 product defect。

## M3 的方向指引

不要把 M3 定义成"把剩余页面接 API"，而应保持证据驱动：
**逐页恢复真实行为语义，并据此验证/修订 M2 Data Model V0.1**。
特别是 `login-sns`、`comments.parent_id`、`schools`、`message / group / board_note` 的真实关系，
都应由真实入口观察**反推 schema**，而不是让 schema 驱动 UI。

因此 M3 应产出两条并行结果：

```
UI/API integration evidence
+
Data Model V0.1 validation / revision evidence
```

---

## 审核原文（完整）
（gate-*.txt 含全部子脚本原始输出）；分支 fullstack 已推送（476131c）。

…
结论：M2 接受

我判定：

M2 — ACCEPTED / CLOSED

这次不仅是“功能跑通”，而且你把 M2 最容易出现的几类假通过都补掉了：认证身份来源、token 存储、legacy 数据迁移、seed 假幂等、restore 假验证、TLS trust 与 hostname verification 混淆、Gate 自身失真，证据链已经足够完整。

尤其这几条我认为可以正式冻结：

AUTH_FUNCTIONAL: PASS
TRANSPORT_SECURITY: PASS
M1 legacy posts 的 author_id = NULL
M2+ 新帖作者只能来自 session
convergent seed
pg_dump -Fc → fresh DB → pg_restore
private CA → IP-SAN leaf → Android trust anchor
cleartext exception / allowMixedContent 已收回
1. dev-register：我建议删除生产代码路径，只保留测试/运维造用户机制

这是本轮唯一一个我建议真正改掉的地方。

你现在：

POST /api/auth/dev-register
仅 ENABLE_DEV_REGISTER=1 时存在

技术上并不危险，只要默认关闭。但它会产生一个长期问题：

生产 backend binary 内永久存在一个“条件开启的注册能力”。

以后环境变量配置失误，就可能把本来不存在的产品能力暴露出来。

而你现在明确又没有产品注册需求。

所以我更偏向：

删除 HTTP dev-register endpoint。

测试账号/本地账号创建改成独立入口，例如：

scripts/dev/create-user.*

或者：

node dist/index.mjs create-user ...

更简单地，也可以让 seed 创建固定测试用户。

核心原则是：

测试夹具能力不要伪装成业务 API。

这不会 reopen M2 的架构，只算收尾。

2. scrypt timing Gate：你现在的处理可以接受

你已经正确降低了它的结论强度：

只判断 nonexistent-user path 是否真的执行了 scrypt，而不是证明 constant-time authentication。

这是对的。

0.92 这种结果足够说明两条路径现在都经过了主要 KDF 成本。

我建议以后这个 Gate 名字也保持诚实，例如：

DUMMY_SCRYPT_EXECUTION

而不要叫：

TIMING_ATTACK_SAFE

因为后者会过度声明。

预热 dummy hash 也合理。

3. 14 张表：接受，但 comments.parent_id 现在已经成为明确的“待证假设”

这个处理方式很好。

你没有把它包装成已观察需求，而是明确写：

M3 如果真实观察不支持层级评论，则删除。

这正符合你现在项目里应该坚持的原则：

Observed fact
≠
forward-compatible guess

因此 M3 对它必须产生一个明确结果：

SUPPORTED
或
NOT_SUPPORTED → migration remove parent_id

不要让它长期停留成“先留着也没事”。

schools 也是同理。

4. M0/M1 Gate 被 M2 揭示出的几个问题，说明新的 Gate 分层方向是对的

你这次再次遇到：

posts 恰好 5 列
migration 恰好 1 个
无 token POST 成功

这些都证明：

结构形态不等于永久 invariant。

真正长期应验证的是：

required historical columns still exist
required migration baseline exists
original M1 persistence semantics still exist

而不是：

schema 永远恰好等于 M1 那一天

nginx -T 检查生效配置，而不是 grep 某个特定文件路径，这个修正尤其正确。

以后尽量贯彻：

Gate 验证 externally meaningful state，而不是 implementation location。

除非那个 location 本身就是 contract。

5. TLS 这轮可以认为真正完成了“最小安全传输闭环”

你做的对照比单纯：

HTTPS 200

强很多。

尤其：

正确 CA + 错 IP → FAIL

说明：

custom CA 生效；
hostname/IP verification 仍然生效；
没有用危险 TrustManager/HostnameVerifier 绕过。

再加：

HTTP → Failed to fetch
HTTPS → 200

以及两项 Android 临时债已收回，这一块我没有额外整改要求。

唯一需要保留在未来计划里的就是你已经记下的：

leaf rotation + nginx reload

以及 M6：

private CA → public CA/domain

6. 80 端口暂时保留：接受

现在没必要为了“看起来更生产化”提前改：

80 → 301 HTTPS

因为 M0 的历史 acceptance contract 明确依赖：

http://IP/health == 200

只要你已经把 80 保留的原因写清楚，就没有问题。

M6 再统一迁移到：

80 → 301
443 → production endpoint

同时修改当前阶段 Gate。

历史 M0 Gate 则继续用 -Stage M0 保留原语义即可。

7. 有一个我建议现在补进项目原则的小规则

这次你已经连续两轮遇到 Gate 自身缺陷，所以建议把一个正式分类写进 Gate 方法论：

Gate failure
├─ PRODUCT_DEFECT
├─ GATE_DEFECT
├─ ENVIRONMENT_DEFECT
└─ EXTERNAL_BLOCKER

你前三类已经有了。

建议再补 EXTERNAL_BLOCKER，用于：

云安全组未开放；
DNS 尚未配置；
第三方服务不可用；
用户控制台动作尚未完成。

这样以后不会把：

443 没开放

错误归到 environment defect 或 product defect。

8. 对 M3 的结转判断

你现在非常适合进入 M3。

但我建议 M3 的核心不要定义成：

“把剩余页面接 API。”

而应继续保持你之前的证据驱动方式：

逐页恢复真实行为语义，并据此验证/修订 M2 Data Model V0.1。

特别是：

login-sns
comments.parent_id
schools
message / group / board_note 的真实关系

这些都应该由真实入口观察反推 schema，而不是反过来让 schema 驱动 UI。

所以 M3 可以形成两条并行结果：

UI/API integration evidence
+
Data Model V0.1 validation / revision evidence

这会比单纯“页面接完了”更有价值。

最终判定

正式记录我建议写成：

M2: ACCEPTED

AUTH_FUNCTIONAL: PASS
TRANSPORT_SECURITY: PASS
DATA_MODEL_V0.1: ACCEPTED WITH TWO DEFERRED VALIDATION POINTS
  - comments.parent_id
  - schools entity

BACKUP_RESTORE: PASS
SEED_CONVERGENCE: PASS
M2_GATE_RESULT: PASS

唯一建议的收尾修改：

删除 HTTP POST /api/auth/dev-register，把造账号能力移出业务 API。

除此之外，我没有认为需要 reopen M2 的问题。

M2 已经可以冻结，进入 M3。

ChatGPT 可能会出错。请核查重要信息。




高
开始语音

