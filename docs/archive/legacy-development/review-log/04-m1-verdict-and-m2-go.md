# 审核记录 04：M1 结果验收（Gate + 证据）

> 提交物：`docs/archive/legacy-development/m1/REPORT.md` + `docs/archive/legacy-development/m1/evidence/`（分支 `fullstack`）
> 审核方：ChatGPT web（远程独立审核）
> 提交时间：2026-09-21 04:38（Asia/Shanghai）
> 结论：**M1 ACCEPTED / CLOSED**；M2 顺序与认证方案已确认

---

## 审核原文（完整）
结论：M1 接受

基于你提交的 Gate 结果和证据链，我判定：

M1 — ACCEPTED / CLOSED。

你已经证明了 M1 真正需要证明的事情：

设备真实操作 → Nginx → backend → PostgreSQL → API read-back → UI → App 数据清空后恢复 → backend/整机重启后仍持久。

尤其 pm clear → localStorage 空 → 帖子仍出现 → PG count=1 这条证据很强，已经把“其实还是 localStorage 在起作用”的可能性排除了。

资源结果也足以支持 M1：20 并发下没有 OOM/5xx，backend RSS 约 74–78 MB。它不是容量证明，但作为这一阶段的 resource evidence 足够。

1. 关于 M0 Gate 加 Stage：接受，而且这里应修正原方法论

你的处理是正确的。

更准确地说，我之前说的：

M1 PASS = M0 invariants PASS + M1 new invariants PASS

这里的 “M0 invariants”分类过粗。

你抓出来的这些：

no business database
backend disabled/inactive
reboot 后 backend inactive
no business API source
no migration
no frontend source changes
M0 diff whitelist

根本不是永久 invariant。

它们是：

M0 milestone-specific acceptance conditions

它们只用于证明：

“在 M0 这个时间点，系统仍然处于基础设施阶段，没有提前进入业务实现。”

到了 M1，它们本来就应该被 supersede。

因此正确模型应该改成：

纯文本
Milestone PASS
=
Persistent invariants
+
Current-stage invariants
+
Regression checks for behavior that should remain unchanged

而不是：

纯文本
previous milestone 所有断言
+
new milestone 断言

这一点建议直接写进项目的 Gate 方法论。

你的 -Stage M0|M1 当前实现可以保留

我不要求你回退成“完全不准改 M0 Gate 文件”。

应该冻结的是：

M0 的历史验收语义必须可复现

而不是：

scripts/m0/*.ps1 的每一个字节从此永远不得修改。

所以：

powershell
verify-m0.ps1 -Stage M0

只要仍能复现原来的 M0 acceptance contract，而且默认还是 M0，就满足历史可复现性。

BOM 修复这种执行环境修复更不应该因为“文件冻结”而禁止。

但从 M2 开始不要继续这样扩张

如果未来变成：

powershell
if Stage M0 ...
elseif Stage M1 ...
elseif Stage M2 ...
elseif Stage M3 ...

并继续堆在 scripts/m0/，最终会很难审核。

我建议下一步逐渐形成：

纯文本
scripts/gates/
    common/
        environment
        security
        baseline
        network
        encoding
    m0/
        milestone.ps1
    m1/
        milestone.ps1
    m2/
        milestone.ps1

然后保留历史入口：

纯文本
scripts/m0/verify-m0.ps1

作为 wrapper。

也就是：

历史 Gate 行为冻结，公共 invariant 实现可以演化。

不需要为了 M1 再返工；从 M2 开始按这个结构收束即可。

2. 你披露的几个实现偏差，我都不认为阻塞 M1
PowerShell BOM：处理正确

这个不是“小乱码问题”，而是部署正确性风险。

你已经实际观察到：

纯文本
UTF-8 无 BOM
→ PowerShell 5.1 错误解码
→ here-string 结构被破坏
→ 部署逻辑跳过
→ unit 写成 __UNIT__
→ 旧进程掩盖故障
→ reboot 后才真正暴露

这已经是非常好的 failure evidence。

所以：

fix-ps1-bom.ps1：保留；
Gate ENC：保留；
缺 BOM 直接 FAIL：接受。

一个小要求：

fixer 不要成为 Gate 自动修复步骤。

Gate 应该只检查然后 FAIL；修复是显式动作。否则 Gate 会改变被测试对象。

固定 sleep 3 → readiness polling：这是修复，不是偏离

应该保留轮询。

但轮询必须有：

纯文本
明确 timeout
失败时打印最后状态
失败时输出 journal/systemctl diagnostics
非无限等待

你的实测已经证明固定时间假设错误：

实际启动需要 4–8 秒。

而 reboot 时 PostgreSQL 甚至需要约 29 秒。

因此以后任何：

纯文本
sleep N
然后假定服务 ready

都应该高度警惕。

VITE_API_BASE 语义差异：不阻塞，但建议现在统一命名

目前：

纯文本
VITE_API_BASE=http://host
代码拼 /api/posts

而工作单写的是：

纯文本
VITE_API_BASE=http://host/api

功能确实等价。

但这是一个会让未来开发者写出：

纯文本
/api/api/posts

的典型 contract drift。

建议二选一冻结：

纯文本
VITE_API_ORIGIN=http://host

然后代码负责 /api/...

或者：

纯文本
VITE_API_BASE=http://host/api

然后代码负责 /posts。

我略偏向第一种，因为以后同一 origin 可能还有非 /api 资源。

这属于 M2 前顺手收口即可，不是 M1 reopen。

Android cleartext + mixed content：作为过渡态接受

你现在的实际链路是：

纯文本
WebView document:
https://localhost

API:
http://8.148.156.146

因此除了 Android Network Security Config，还碰到了 WebView mixed-content policy，这个判断成立。

目前：

纯文本
usesCleartextTraffic = false
specific NSC exception
allowMixedContent temporary

作为 M1/M2 过渡方案可以接受。

但报告里最好把它明确写成：

temporary transport-security exception

M6 上 HTTPS 后必须同时收回：

纯文本
cleartext exception
allowMixedContent

不能只改 API URL 就认为债务已经消失。

Gate 抓到自身 3 个 bug + 真实 scope violation：反而增强了 Gate 可信度

这类情况应该保留在报告里。

尤其要区分：

纯文本
PRODUCT_DEFECT
GATE_DEFECT
ENVIRONMENT_DEFECT

最终 PASS 必须来自：

修正后的 Gate + 修正后的实现 + clean rerun

而不是把第一次失败覆盖掉。

你现在这个证据过程是合理的。

3. M2 顺序：基本确认，但稍微调整一下

你说：

先 auth/authz
→ 数据模型 V0.1 + seed
→ pg_dump + restore

总体方向正确。

但“认证实现”本身依赖 identity/session schema，所以更准确的顺序是：

纯文本
M2.1 先冻结 Authentication / Authorization contract
      ↓
M2.2 定最小 identity/session schema
      ↓
M2.3 实现 auth，并彻底取消 client-author trust
      ↓
M2.4 完成其余 Data Model V0.1
      ↓
M2.5 deterministic/repeatable seed
      ↓
M2.6 pg_dump → fresh DB restore
      ↓
M2 Gate

也就是说：

auth 语义先于完整数据模型设计；但最小 user/session schema 必须先于 auth 实现。

4. 极简认证：我明确选择「服务器签发不透明 session token」

在你给出的两个方案之间：

opaque session token > device binding + request signing

我不建议 M2 上设备绑定签名。

设备签名会马上引入：

device key provisioning；
私钥存储；
enrollment；
key rotation；
device replacement；
replay protection；
nonce / timestamp；
clock skew；
lost-device recovery；
多设备账户语义；
签名 canonicalization。

而且它回答的是：

“是不是持有这个设备私钥的人发的请求？”

它并不能自动回答：

“这个人究竟是谁？”

所以对你的 campus app 来说复杂度收益比很差。

M2 最小模型可以非常小

例如：

纯文本
users
-----
id
display_name
...credential fields

sessions
--------
id
user_id
token_hash
created_at
expires_at
revoked_at

登录成功后：

纯文本
server:
random 256-bit token

client:
Authorization: Bearer <token>

database:
只存 token hash

退出登录：

纯文本
revoke session

不用 JWT。

JWT 在你这个规模目前没有明显收益，还会增加：

signing key；
claim/version；
revocation；
stale authorization data；

等问题。

opaque token 反而更适合你现在的单 backend + PostgreSQL。

5. M2 对 posts 最关键的变化

M1：

JSON
{
  "body": "...",
  "author": "Alice"
}

M2 之后这个接口不应该再允许客户端决定作者。

应该变成：

http
Authorization: Bearer SESSION_TOKEN

POST /api/posts
{
  "body": "...",
  "place": "..."
}

服务器：

纯文本
session token
→ session
→ user_id
→ posts.author_id

作者完全来自服务端身份。

我建议 Gate 专门加入一个 forged author test。

例如客户端尝试：

JSON
{
  "body": "test",
  "author": "管理员"
}

应该：

因 strict schema 被 400 拒绝；或者
明确忽略这个字段。

我更偏向 strict reject。

这样可以机械证明：

client cannot choose post ownership.

6. M1 现有 author_name 不必因此推翻 schema

可以在 M2 migration 中加：

纯文本
posts.author_id → FK users.id

而现有：

纯文本
author_name

暂时保留为 snapshot / legacy display field。

不要急着 destructive drop。

未来再决定是：

纯文本
join users.display_name

还是：

纯文本
author_name_snapshot

保留历史发帖时姓名。

这是 Data Model V0.1 再决定的事情。

7. 唯一一个我希望你在 M2 auth 开始前明确处理的安全问题

Bearer token 不能把公网 HTTP 当成最终安全传输。

现在链路还是：

纯文本
http://8.148.156.146

如果 M2 开始真正发送 session token，那么：

纯文本
Authorization: Bearer ...

在 HTTP 上传输没有机密性保障。

所以我会区分两个判据：

M2 可以证明

Authentication / authorization application semantics 正确。

但不能在公网 HTTP 状态下声称

authentication security is production-ready.

设备请求签名也不是解决这个问题的正确捷径，因为它不提供整个通信内容的机密性。

因此最理想的做法是：

如果成本允许，把最小 TLS transport prerequisite 前移到 M2。

不一定要把整个 M6 部署/域名工作都前移，但在真实 bearer credential 开始出现之前，最好已经有受保护传输。

如果由于域名/证书条件确实暂时做不到，那么报告和 Gate 必须明确：

纯文本
AUTH_FUNCTIONAL_PASS
TRANSPORT_SECURITY_DEFERRED_TO_M6

不要把两者混为一个 AUTH PASS。

最后冻结

我给这一轮的正式结论是：

M1: ACCEPTED

同时将 Gate 方法论修订为：

纯文本
Previous milestone acceptance conditions
≠
永久 invariants

你的 stage 化修正是正确的，无需恢复成旧版 M0 文件；但从 M2 开始把 Gate 拆成“公共永久 invariant + milestone-specific contract”，避免 scripts/m0 逐渐变成所有阶段的总控脚本。

M2 顺序也确认：

Auth/Authz contract → minimal identity/session schema → 去除 client author trust → Data Model V0.1 → repeatable seed → pg_dump/restore → M2 Gate

认证方案选：

server-issued opaque session token，不采用 device-bound request signing。

这是目前最符合“小步验证、控制复杂度、证据可机械化”的路线。
