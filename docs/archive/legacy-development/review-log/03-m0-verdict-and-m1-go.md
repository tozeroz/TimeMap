# 远程审核记录 03：M0 验收结论与 M1 准入

> 审核方：ChatGPT（网页版）
> 时间：2026-09-21 03:21
> 会话：https://chatgpt.com/c/6ab03177-7490-83e8-a514-a5795cfc6daa

---

思考了 22s
ChatGPT 说：
结论先给

M0：PASS。
M1：GO。

你这次补齐 22 页原生 1080×1920 无损证据后，我上一轮的 CONDITIONAL 已解除。按照你描述的最终 Gate 状态，我现在没有任何需要阻塞 M1 的 M0 缺项。

1. M0 是否接受？还有没有必须补的项？

接受，正式 PASS。

目前 M0 已经证明了四件真正重要的事情：

目标	审核结论
可重复的服务器基础环境	PASS
Git / scope / secret 治理	PASS
原版 22 页 scope 已建立	PASS
后续阶段有机械 Gate 可回归	PASS

尤其是现在 baseline 已经变成 22× native 1080×1920 lossless PNG + SHA256 + 环境 metadata，已经够资格作为后续视觉验收的原始证据层。

trident-campus 把“资源尚未加载完成”的误采样替换掉也是正确的。那属于采集缺陷修正，而不是篡改原版行为。login-sns 重新完整脱敏同样正确。

我不再要求任何 M0 blocker

但有两个 non-blocking carry-over，建议保留到治理清单：

第一是我上一轮提到的云安全组 expected exposure contract。现在你已经实测 22/80 的外部可达性和 PG loopback，所以运行状态没问题；欠缺的只是“云控制台状态不是 ops/ 可自动重建的一部分”。不用因此卡 M1。最迟在部署治理阶段明确：

expected public inbound = 22/tcp + 80/tcp
forbidden public inbound includes 5432/tcp and backend internal port

以后 Gate 检测实际暴露面即可，不一定现在就上 Terraform。

第二是脱敏截图以后如果要做自动 pixel diff，最好给 login-sns 留一个 ignore/mask region metadata。否则你自己的 [redacted] 会被错误地当成原版 UI。这也完全不阻塞 M1。

现在应该做的动作

冻结 M0，不要继续往 M0 塞东西。

把当前最终 commit SHA 作为 M0 anchor，并把这次：

clean tree → verify-m0.ps1 → server gate → baseline gate → M0_GATE_RESULT PASS

保留下来。

从这里以后任何 M1 变更，都应该能明确回答：

相对于 M0 anchor 改了什么？

这比继续优化 M0 更有价值。

2. 三个 not_reproducible 页面应该怎么办？

你提出的方案：

M3 做对应真实 vertical slice 时，从真实入口进入原版 App，再补采 baseline，而不是现在硬造。

我接受，而且我认为这就是正确处理方式。

但我建议把它正式定义成：

Deferred Evidence Acquisition

而不是简单地叫“以后补截图”。

这三页目前并不是 scope 缺失：

页面	当前事实	正确处理
poi-detail	deep link 不是真实入口	等地图/动态地点链路可复现
media-preview	依赖登录态 + 聊天/媒体数据	等真实聊天 vertical slice
at-panel	依赖登录态 + 聊天上下文	等真实聊天 vertical slice

这恰恰说明你现在不应该硬造。

M1 怎么处理

完全不要碰它们的验收状态。

M1 报告始终应当是类似：

total original screens: 22
observed baseline: 19
evidence-blocked: 3
out-of-scope: 0

不能因为 M1 不需要它们就变成“19/19”。

同时，它们也不应该被 M1 的实现偷偷“定型”。

即使当前 React 已经有 poi-detail.tsx，也只能理解成：

current implementation hypothesis

不能理解成：

confirmed reproduction of original behavior

到 M3 时，我建议按这个顺序

这是防止它们最后变成“无基线黑洞”的关键：

先恢复原版证据，再实现/验收对应功能。

例如 poi-detail：

原版地图/动态
→ 找到带地点的数据
→ 点击地点
→ 确认真实 navigation
→ capture 1080×1920
→ 记录 interaction/navigation/state
→ baseline supplement
→ 再拿你的实现与它比较

media-preview / at-panel 同理：

建立登录态
→ 建立聊天数据
→ 从真正的 message composer / media message 进入
→ capture original behavior
→ 才进入实现验收

这样就不存在“我们已经做好了，现在找一个基线证明自己对”的 confirmation bias。

不要覆盖 M0 历史记录

这一点我比较建议你现在就冻结。

不要在 M3 找到真实入口以后，直接悄悄把 M0 的：

not_reproducible

改成：

observed

然后让历史看起来好像 M0 当时就知道。

更好的证据结构是保留：

M0 observation：deep-link reproduction failed

再增加：

M3 evidence recovery：success via real UI entry

可以通过 revision / supersedes / recovered_at / recovery_entry，或者单独 supplements/ 实现。

这样最终审计能解释：

为什么 M0 没看到它？
M3 又是怎样恢复证据的？

这对你这个项目非常重要。

如果 M3 还是无法恢复呢？

那就不能让它自动变 PASS。

最终应该是：

IMPLEMENTED
ORIGINAL_EVIDENCE_BLOCKED
1:1 VERDICT = NOT_EVALUATED

而不是：

看起来差不多 → PASS

因此最终可能出现：

19/22 empirically verified 1:1
3/22 original evidence unavailable

这虽然没有“22/22 PASS”漂亮，但在证据意义上是正确的。

不过结合你现在已经知道的真实入口条件，我认为这三页不是“永久不可复现”，而更像是当前上下文不足。所以把 evidence recovery 放进 M3 非常合理。

3. 可以进入 M1 吗？

可以，现在就可以。

而且我不建议再为 M0 增加新的技术工作。

你定义的：

Fastify + PG pool + migration + health/readiness + systemd + Nginx + 一个真实 E2E vertical slice

非常适合作为 M1。

进入前我只要求看到两个东西
最终 M0 commit SHA
这个 exact commit 对应的一份最终 Gate transcript，结果为 M0_GATE_RESULT PASS

你实际上已经有后者了，因此本质上只需要把 M0 anchor freeze 掉。

我不要求再跑新的性能测试、不要求再安装软件、不要求提前建业务数据库、不要求为三个 blocked 页面补证据。

M1 有一个边界需要现在明确

你现有 Nginx：

/health → 固定 JSON

在 M0 是正确的，因为 backend 根本没启动。

到了 M1，要区分三种东西：

检查	它证明什么
Edge health	Nginx 活着
Backend liveness	Node/Fastify 进程活着
Backend readiness	Backend 能连接 PG，必要 migration 状态满足

不要让一个：

GET /health → 200

同时假装证明这三件事。

例如可以保持：

/health

为 Nginx edge health，同时使用：

/api/health
/api/ready

分别证明 Fastify liveness 与 PostgreSQL readiness。

具体 URI 名可以调整，语义隔离才是重点。

M1 vertical slice 我会怎么验

M1 最重要的 Gate 不是：

Fastify 能启动。

也不是：

/api/health 返回 200。

而是：

真实 UI → HTTP → Fastify → PG → 再读出来 → 真实 UI

并且至少发生一次真实持久化。

比如：

User action
  ↓
React
  ↓
Nginx /api
  ↓
Fastify
  ↓
PostgreSQL INSERT/UPDATE
  ↓
GET
  ↓
React renders persisted value

然后：

restart backend

甚至重新打开页面，数据还存在。

这样 M1 才真正证明：

localStorage/mock architecture 已经开始被真实 client-server architecture 替换。

否则很容易出现一个危险的假 M1：

Node ✓
PG ✓
Nginx proxy ✓
API health ✓
frontend ✓

但五个组件实际上没有形成业务闭环。

我建议冻结的 M1 Gate 核心

你后面写 M1 PLAN 时，我会重点审核这些：

fresh DB 能从 migration 创建 schema；
migration 可重复执行且版本可识别；
Fastify 使用受限 PG pool，而不是无限连接；
backend systemd enabled + active；
reboot 后自动恢复；
/health 和 /ready 语义明确；
readiness 在 PG 不可用时必须失败；
至少一个真实业务 E2E write/read；
该 slice 不再依赖 localStorage 作为业务真源；
backend restart 后数据仍然存在；
Nginx 是客户端唯一 HTTP 入口，不暴露 Node listen port；
M1 完成后重新测 396MB 机器的内存、swap activity、OOM；
M0 baseline Gate 仍然 PASS，证明没有因为全栈改造破坏原版证据资产。

最后一条很重要：

M1 Gate 应该包含 M0 regression Gate。

这样以后变成：

M1 PASS =
M0 invariants still PASS
+
M1 new invariants PASS

以后 M2、M3 可以继续用同一个模式。

最终审核状态

M0：PASS / CLOSED

3 个 blocked 页面：ACCEPTED DEFERRED EVIDENCE，M3 从真实入口恢复 baseline 的方案批准。

M1：GO。

现在最正确的动作不是继续完善 M0，而是冻结 M0 anchor，然后开始设计 M1 的 single vertical slice 和 Gate。这也是我下一轮审核最希望看到的内容。

ChatGPT 可能会出错。请核查重要信息。




高
