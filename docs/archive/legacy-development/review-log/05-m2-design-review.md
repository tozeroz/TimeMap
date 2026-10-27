# 审核记录 05：M2 设计审核（有条件批准）

> 提交物：`docs/archive/legacy-development/m2/SPEC.md`（M2 工作单）
> 审核方：ChatGPT web（远程独立审核）
> 提交时间：2026-09-21 04:49（Asia/Shanghai）
> **结论：M2 DESIGN — CONDITIONAL APPROVAL**（实施前需 patch 7 项）

## 七项实施前必改（P0）

1. session 必须有 `expires_at`；token = `randomBytes(32)` → base64url；DB 存 **SHA-256(token)**（token 本身高熵，**不要**再用 scrypt 哈希 token）。
2. 用户不存在时也要跑一次**参数相同**的 dummy scrypt（否则时间差仍可枚举用户）；
   用**异步** `crypto.scrypt()` 而非 `scryptSync()`；scrypt 参数（N/r/p/keylen/salt/maxmem）写死并在目标服务器实测
   单次与 1/5 并发登录的 RSS、延迟、OOM 后再冻结；`/api/auth/login` 必须**限流**。
3. 明确 login/logout/me contract：成功/失败状态码、expired/revoked → 401、malformed Authorization → 401、
   logout 后原 token 必须失效、`/me` 返回服务端解析出的身份；**不要**顺手加注册/改密码/refresh token。
4. **M1 legacy posts 的 `author_id` 迁移不得伪造历史身份**：采用 `author_id = NULL` + `author_name` 保留快照；
   M2+ 新帖由 session 解析出 `author_id` 且 API 层强制非 NULL。
   （若能证明 M1 帖子全是 Gate fixture 且已 cleanup，才可删 fixture 后设 NOT NULL。）
5. seed 从「`DO NOTHING` 幂等」改为 **convergent**（`ON CONFLICT (id) DO UPDATE`），
   否则 seed 源改了值而 DB 保留旧值，两次运行"一致"其实是**假幂等**；
   Gate 用 `fresh+seed once` vs `fresh+seed twice` 比内容哈希，并比对 canonical 期望哈希。
6. restore Gate 增加 **row-content hash**（按 PK 排序、规范化字段表示的 SHA-256）：
   四项对比 `schema_migrations` + 行数 + PK 集合哈希 + 行内容哈希；用 `pg_dump -Fc` + `pg_restore`。
7. **立即申请放行 443**；M2 其余部分可并行实施，但真实设备 bearer E2E 与 M2 最终 PASS 必须等最小 TLS 建立。
   443 仍被阻断时：`AUTH_FUNCTIONAL: PASS` / `TRANSPORT_SECURITY: BLOCKED_EXTERNAL_443` / `M2_OVERALL: HOLD`。

## 其他关键裁定

- **数据模型 scope Gate**：每张表都必须能追溯到 22 页 observed baseline 中的已观察实体/关系；
  「以后可能用得上」的表现在不建。约束要有业务含义（`likes UNIQUE(user_id,post_id)`、
  `thread_members UNIQUE(thread_id,user_id)`、`group_members UNIQUE(group_id,user_id)`）。
- **TLS 方案修正**（原文指出我方案里的漏洞）：
  - 「App 信任自签证书」与「服务器身份匹配」是**两道独立校验**，trust-anchor **不能**绕过 hostname 校验。
  - 冻结为：**临时私有 Root CA → 签发 server leaf（SAN 必须是 `IP:8.148.156.146`，不是 DNS，也不能只放 CN）**；
    APK 只内置私有 Root CA 公钥证书，Nginx 持有 leaf + 私钥。
  - 这样 leaf 轮换/到期不需要重新发 APK。
  - **绝不**实现 always-true 的 `HostnameVerifier` 去绕过校验。
  - M6 再把这套临时 PKI 换成 域名 + 公共 CA + 自动续期，并删除 APK 里的临时 CA。
- 改成 https 之后：明文例外与 `allowMixedContent` 都能收回，但 **CORS 必须保留**
  （`https://localhost` 与 `https://8.148.156.146` 仍是不同 origin）。
- **TLS Gate 九条机械验证**（不能只测"能访问"）：设备 `https://IP/api/health` 200；
  HTTPS 下 authenticated POST 201；明文路径不再是 App 可用路径；`allowMixedContent` 已删除；
  明文例外已删除；正确 CA + 正确 IP SAN → PASS；错误 CA → TLS FAIL；CA 对但 SAN 不匹配 → TLS FAIL；
  **bearer 不得出现在 Nginx/access log、应用日志与 Gate transcript**（token 必须 redact，
  禁止 `curl -v -H "Authorization: Bearer REALTOKEN"` 把完整输出收进 evidence）。

---

## 审核原文（完整）
结论：有条件批准 M2

M2 的主路线、范围边界和 Gate 思路已经可以冻结，没有必要重做方案。需要在实施前补一版很小的 M2 Design Patch；其中真正的 P0 是认证资源语义、seed 的“假幂等”问题，以及 TLS 的执行边界。

传输安全方面，我的结论很明确：

现在就申请开放 443；M2.1/M2.2/M2.4 等不必等 443，可以继续。M2.3 也可以实现并在 localhost/SSH 隧道内验证，但不要让真实 bearer token 经公网 HTTP 传输。最终设备 Auth E2E 和 M2 PASS 等最小 TLS 路径建立后再完成。

这不是把完整 M6 提前。M6 仍负责正式域名 + 公共 CA + 自动续期 + 清理临时证书体系；M2 只增加一个 credential transport prerequisite。

一、Auth 方案批准，但必须补 4 个约束

你的：

256-bit opaque token + DB 只存 hash + revoked_at + scrypt password + no JWT

我接受。

1. token 具体语义现在冻结

建议直接冻结：

纯文本
token = randomBytes(32) → base64url
DB = SHA-256(token)

32 bytes 就是 256 bit。token 本身已经具有高熵，所以 session token hash 用 SHA-256 即可，不要再用 scrypt。

sessions 至少要有：

纯文本
id
user_id
token_hash UNIQUE NOT NULL
created_at
expires_at NOT NULL
revoked_at NULL

并现在定下 session TTL。具体 7 天、30 天都不是这里最重要的问题，重要的是不要设计成永不过期 session。

2. “错误提示一致”还不足以防 username enumeration

目前：

纯文本
用户不存在 -> 立即失败
密码错误   -> 做一次 scrypt 后失败

即使两边都返回：

纯文本
invalid credentials

时间仍明显不同。

所以不存在用户时也执行一次：

与正常账户完全相同参数的 dummy scrypt

然后再统一返回 401。

另外使用 异步 crypto.scrypt()，不要 scryptSync()。Node 官方说明 scrypt 本身就是故意消耗 CPU/内存的密码 KDF；timingSafeEqual 也只保证比较操作本身，不会自动让外围代码变成 timing-safe。
Node.js
+1

3. scrypt 参数不能留成“Node 默认值”

SPEC 应写死：

纯文本
algorithm/version
N
r
p
keylen
salt length
maxmem

哈希串中携带这些参数是正确的。

由于你的服务器只有约 396 MB 可用物理内存，这里尤其不能照搬高内存配置。要求：

在目标服务器上实测单次登录以及 1/5/并发登录的 RSS、延迟、OOM 情况，再冻结参数。

同时给 /api/auth/login 加 rate limit。

这也是为什么我不赞成现在上复杂 device-signing：真正值得先解决的是简单认证机制本身的资源与传输边界。

4. Auth API contract 现在就冻结

SPEC 里还应明确，例如：

纯文本
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

至少冻结：

login 成功/失败状态码；
expired/revoked token → 401；
malformed Authorization → 401；
logout 后原 token 必须失效；
/me 返回服务端解析出的身份；
没有明确需求就不要顺手增加注册、改密码、refresh token。

这样 M3 接 UI 时不会重新设计认证协议。

二、posts.author_id 有一个迁移陷阱

这是一个必须提前处理的 P0。

M1 已经产生了认证前帖子。它们的 author_name 是客户端提交的，事实上不存在可信的 users.id 可以对应。

因此不能在 migration 中凭空：

把旧帖子归到某个真实用户。

这会篡改数据语义。

两种办法里我倾向：

纯文本
M1 legacy posts:
author_id = NULL
author_name = 原 snapshot

M2+ authenticated posts:
author_id MUST be resolved from session
author_name = server-generated snapshot

API 层强制新帖子 author_id != NULL。

如果你能证明 M1 所有现存帖子都只是 Gate fixture，并且 Gate 已明确 cleanup，那么也可以删除 fixture 后直接把 author_id 做成 NOT NULL。

关键原则：

未知身份就表示未知，不能为了 FK 漂亮而伪造身份。

三、Data Model V0.1：接受，但不要“为了表齐全而设计表”

你列的：

纯文本
media
comments
likes
places
message_threads
thread_members
messages
groups
group_members
announcements

本身没有问题。

但我给一个 scope Gate：

每张表必须能追溯到 22 页 observed baseline 中的某个已观察业务实体/关系。

如果某个表只是“以后感觉可能用得上”，现在不建。

M2 是 Data Model V0.1，不是“猜未来业务”。

另外 unique/CHECK/index 不要写成统一模板式要求，而应有具体业务含义。例如：

纯文本
likes UNIQUE(user_id, post_id)
thread_members UNIQUE(thread_id, user_id)
group_members UNIQUE(group_id, user_id)

这种才是真 constraint。

四、Seed 有一个比较严重的设计问题

你现在写：

fixed UUID/time + ON CONFLICT DO NOTHING + 两跑 hash 一致

这可能产生假幂等。

比如 V1 seed：

纯文本
Alice

后来 seed source 被改成：

纯文本
Alice Zhang

数据库已经有相同 UUID。

第二次：

SQL
ON CONFLICT DO NOTHING

于是 DB 仍然是旧值。

Gate 两次运行当然完全一样——但它实际上已经偏离 canonical seed。

所以建议改成：

seed 必须是 convergent，而不只是 non-destructive。

对 seed-owned fixture 用：

SQL
ON CONFLICT (id)
DO UPDATE SET ...

让数据库最终收敛到 seed specification。

然后 Gate 做：

纯文本
fresh DB + seed once
vs
fresh DB + seed twice

内容 hash 一致。

最好再验证：

纯文本
seed DB logical content hash
==
canonical expected hash

--reset 保持人工显式调用、Gate 不自动调用，这一点继续保留。

五、Backup Gate 再加强一点

你现在：

row count + schema_migrations + primary-key-set hash

已经比“dump 成功就算备份成功”强很多。

但还缺一个漏洞：

原库：

纯文本
id=1 body=ABC

restore 后：

纯文本
id=1 body=XYZ

row count 和 PK hash 都一样。

因此建议每个业务表再算：

确定性 logical row-content hash

例如按 PK 排序后，对规范化字段表示进行 SHA-256。

这样：

纯文本
source:
schema migration set
row count
PK-set hash
row-content hash

==

restored:
same four things

PostgreSQL 官方也明确区分了 dump 与真正 restore；custom-format pg_dump -Fc + pg_restore 很适合你这个演练，因为 archive 就是设计来重建数据库并允许检查恢复过程的。
PostgreSQL
+1

你的：

新建 campus_restore，真正 restore，而不是删表重建冒充

保留，完全正确。

六、传输安全：不选纯 B，采用“并行推进 + TLS Gate”

我不建议：

M2 全程在公网 HTTP 上真实发送 bearer，然后报告里注明 deferred 就算 PASS。

因为一旦 credential 真正在公网 HTTP 上传输，问题已经不是“报告措辞是否准确”。

我的执行顺序是：

纯文本
现在：
申请开放 443
       │
       ├── M2.1 auth contract
       ├── M2.2 schema
       ├── migration
       ├── seed / model
       └── M2.3 backend implementation + localhost tests
                     │
443 available ───────┘
       ↓
minimal TLS
       ↓
real device bearer E2E
       ↓
AUTH + AUTHOR_TRUST Gate
       ↓
M2 PASS

所以 443 没开不应该冻结整个 M2。

但是到最终 Gate：

443 仍然 blocked → M2 应是 HOLD/blocked，而不是完整 PASS。

如果确实需要阶段性报告，可以写：

纯文本
AUTH_FUNCTIONAL: PASS
TRANSPORT_SECURITY: BLOCKED_EXTERNAL_443
M2_OVERALL: HOLD

而不是公网 HTTP credential 测完后写“security deferred”。

七、自签 TLS：接受，但我建议改成“私有 CA + server leaf”，不要直接钉一张自签 leaf

Android 官方明确支持通过 Network Security Config 为 App 增加自定义 CA，包括私有/自签 CA。
Android Developers

我推荐：

纯文本
Private Root CA
       ↓ signs
Server leaf certificate

APK 内只放：

纯文本
Private Root CA public cert

Nginx 持有：

纯文本
server leaf certificate
server private key

而不是：

Nginx 使用一张自签 leaf，然后 APK 永久信任这张 leaf。

原因很简单：以后 leaf 到期/轮换时，私有 CA 模式不需要同步发布新 APK。

最关键的一条

因为你的 URL 是：

纯文本
https://8.148.156.146

server leaf 的 SAN 必须包含：

纯文本
IP:8.148.156.146

不是：

纯文本
DNS:8.148.156.146

也不能只放 CN。

HTTPS 的地址身份校验和 CA trust 是两回事；标准要求 URI 使用 IP 时证书里的 iPAddress SAN 与其精确匹配。
RFC 编辑器
+1

绝对不要实现自定义“always true HostnameVerifier”来绕过它。 Android 官方明确把跳过 hostname verification 视为 MITM 风险。
Android Developers

八、这个临时 TLS 能不能还掉你说的两项债？

能。

从：

纯文本
https://localhost WebView
    ↓
http://8.148.156.146

改成：

纯文本
https://localhost
    ↓
https://8.148.156.146

后：

API 不再使用明文；
不再是 HTTPS → HTTP mixed content；
可以删除 cleartext exception；
可以删除 allowMixedContent。

但是：

CORS 仍然存在。

因为：

纯文本
https://localhost

和：

纯文本
https://8.148.156.146

仍然是不同 origin。

所以 M1 已经验证过的 CORS policy 继续保留，只是 API scheme 从 HTTP 改成 HTTPS。

九、TLS Gate 我会要求这几条机械验证

这次不要只测“能访问”。

至少验证：

纯文本
1. 设备 https://IP /api/health -> 200
2. authenticated POST through HTTPS -> 201
3. cleartext http://IP/api/... 不再作为 App 可用路径
4. allowMixedContent 已删除/关闭
5. cleartext exception 已删除
6. 正确 private CA + 正确 IP SAN -> PASS
7. 错误 CA -> TLS FAIL
8. CA 正确但 SAN 不匹配 -> TLS FAIL
9. bearer 不出现在 Nginx/access log、应用日志和 Gate transcript

第 9 条很容易被忽略。

尤其 Gate/调试脚本里不要：

纯文本
curl -v -H "Authorization: Bearer REALTOKEN"

然后把完整输出收进 evidence。

token 必须 redact。

最终需要修改的点

因此这份工作单的状态是：

M2 DESIGN — CONDITIONAL APPROVAL

实施前 patch 以下 7 项即可，不需要重新设计：

session 加 expires_at，token 明确 randomBytes(32) + SHA-256 hash；
nonexistent user 也跑 dummy scrypt；异步 scrypt，冻结参数并做资源 Gate；
明确 login/logout/me contract，并给 login 限流；
明确 M1 legacy posts 的 author_id migration，不伪造历史身份；
seed 从 DO NOTHING 幂等 改为 canonical/convergent seed；
restore Gate 增加 row-content hash；
立即申请 443；M2 可以并行实施，但真实设备 bearer E2E 必须走 TLS 后才能给 M2 最终 PASS。

而你的自签方案我接受，但正式冻结为：

temporary private CA → IP-SAN server certificate → Android custom trust anchor，

不是关闭 hostname verification，也不是简单地“信任任何自签证书”。

M6 再把这一整套临时 PKI 替换成：

domain + publicly trusted CA + automatic renewal，

并删除 APK 中的临时 CA。这样 M2 与 M6 的边界会非常干净。

ChatGPT 可能会出错。请核查重要信息。




高
开始语音

