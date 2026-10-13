# 审核记录 08：M3 Evidence Preflight + Slice 0A 验收，Slice 0B 有条件开工

> 提交物：`docs/pending/m3/PREFLIGHT.md`、`docs/pending/m3/SLICE0-LOGIN-SEMANTICS.md`、`docs/pending/m3/MODEL-VALIDATION.md`、
> `docs/test/original-baseline/supplements/*`
> 审核方：ChatGPT web（远程独立审核）
> 提交时间：2026-09-21 10:45（Asia/Shanghai）

## 裁定

```
Evidence Preflight：   ACCEPTED
Slice 0A 登录语义冻结： ACCEPTED
Slice 0B：            CONDITIONAL GO
```

## Slice 0B 开工前必须落实的三处修订

1. **公开 handle/password 登录被 phone+OTP supersede** —— 不保留两条产品登录路径。
2. **OTP 使用 keyed HMAC**（不是普通 hash）；**开发投递用独立 dev sink**，
   优先 `/run` + admin CLI，**不要进入普通日志**。
3. **「先 listen 后 migration」期间，所有依赖 DB schema 的业务路由必须统一返回 503**，
   并且要区分 **transient retry** 与 **terminal migration failure**。

## 关于 Q1 的完整裁定（关键）

M2 应拆成三层看待：

| 层 | M2 设计 | M3 处理 |
|---|---|---|
| Session / authorization | opaque token、token hash、expiry、revocation、Bearer、author 来自 session | **全部保留** |
| Credential / identity proof | handle + password + scrypt | **被新证据 supersede** |
| Product identity | 当时未知 | **冻结为 手机号 + 一次性验证码** |

因此不能写成"M2 不动 + 额外加手机号验证码"——那会让最终产品存在**两个公开登录方法**，
而原版只观察到一个。正确做法：**保留 M2 的 session/authz 机制，用 phone+OTP 替换公开凭证机制；
把公开的 handle/password login 从当前产品契约中退休**。
（M2 的历史事实仍留在审核记录里，不代表当前产品必须永久兼容它。）

## 其余裁定

- **schools + campuses：SUPPORTED，接受**；"校园圈粒度是 school × campus"是足够强的新证据；
  `users/posts` 的 legacy FK 继续 NULL 符合「不伪造历史事实」。
- **`groups.name ≤ 24`：作为业务上限接受**。但 24 字按 Unicode code point / UTF-16 code unit /
  grapheme cluster 计数**尚无证据**，现在不要过度声明；以后测到 emoji 再确认边界语义。
- **群名(N) 是展示字段、不入库：接受**。
- **`places.address` 措辞要改**：从「address 不限长」改为
  「没有观察到支持短长度上限的证据，因此 V0.1 使用 TEXT，不人为增加 CHECK」——
  30 字地址只证明"至少要容纳这种长度"，不能证明原版理论上无限长。
- **Gate 必须把「功能正确」与「视觉一致」拆开**（因为验证码页无观察证据）：
  ```
  LOGIN_ENTRY_VISUAL:        PASS          （login-select / login-sns 有真实证据）
  OTP_UI_FUNCTIONAL:         PASS
  OTP_UI_VISUAL_CONFORMANCE: NOT_EVALUATED reason=BLOCKED_BY_ETHICS
  ```
  这比"合理推断实现后算 1:1"诚实得多。
- **Slice 0B 主路径不得再用 session fixture**；Gate 至少证明一次完整冷启动链路：
  ```
  App 冷启动 → 无 session → login-select → 协议弹窗行为 → 手机号页 → 请求验证码
  → 运维从 dev sink 取本次随机 code → UI 输入 → 服务端消费 challenge → 签发 session
  → /api/auth/me 身份正确 → 重启 App 仍有效 → logout → 旧 token 401
  ```
- **advisory lock 继续保留**。

## 关于第 3 点修订的完整要求（原文）

> 在 migration 尚未成功时，所有依赖数据库 schema 的业务 API 都返回 503，而不是尝试访问旧 schema。
> 否则只是把 connection refused 变成了「backend 已监听但业务 API 对半迁移 schema 发 SQL」——后者反而更危险。
>
> 另外不建议所有 migration error 都每 10 秒无限重试。应该区分：
> - **Transient**: PG unavailable / timeout → retry
> - **Terminal**: checksum mismatch / SQL syntax或runtime error / unexpected schema state
>   → remain NOT_READY、loud diagnostic、**不死循环执行 migration**

---

## 审核原文（完整）
裁定

这轮我给三个独立结论：

Evidence Preflight：ACCEPTED
Slice 0A 登录语义冻结：ACCEPTED
Slice 0B：CONDITIONAL GO

你已经成功把原来的 19 observed / 3 blocked 推进到了 原 22 页基线范围内的 22/22，而且恢复方式比重新 deep link 猜入口可靠得多。M0 原始证据不改写、supplement 追加、coverage history 保留，这套审计处理我接受。

不过 Slice 0A 得到的新事实会真正修订 M2 的“凭证层”设计。因此 Slice 0B 开工前有几处应该现在冻结。

1. Q1：你的“两层模型”基本正确，但不能完整保留 M2 的公开密码登录

可以把 M2 拆成两层看：

层	M2 设计	M3 处理
Session / authorization	opaque token、token hash、expiry、revocation、Bearer、author 来自 session	全部保留
Credential / identity proof	handle + password + scrypt	被新证据 supersede
Product identity	当时未知	现在冻结为 手机号 + 一次性验证码

所以不能简单写：

M2 handle/password 不动，再额外增加手机号验证码。

这样最终产品会存在两个公开登录方法，而原版只观察到一个。

正确做法是：

保留 M2 的 session/authz mechanism；用 M3 观察到的 phone + OTP 替换 public credential mechanism。

也就是把公开的 handle/password login 从当前产品契约中退休。M2 历史事实仍然保留在审核记录里，不代表当前产品必须永久兼容它。

这正是前面 Gate 方法论已经允许的：

历史 milestone acceptance condition ≠ 永久 invariant。

Schema：你的方向对，但我建议叫 login_challenges

users 增加：

phone_e164 TEXT UNIQUE

建议明确存规范化后的 E.164，而不是各种：

138...
+86 138...
+86138...

同时不要为了 M1/M2 legacy users 伪造号码，因此现阶段允许 nullable 是合理的。

验证码表我更建议：

login_challenges
----------------
id
user_id
code_digest
created_at
expires_at
consumed_at
failed_attempts

叫 challenge 比 login_codes 更准确，因为一条记录代表的是一次认证 challenge，而不是“一个验证码字符串”。

2. 验证码不要只做普通 SHA-256

这里有一个需要修正的安全细节。

session token 有 256-bit 随机熵，所以：

SHA-256(token)

非常合适。

但短信验证码通常只有很小的搜索空间，比如六位数字只有 100 万种。如果数据库泄漏：

SHA256(123456)

几乎可以瞬间枚举。

因此验证码应该采用：

HMAC-SHA256(server_secret, challenge_id || code)

其中 server_secret：

不进数据库；
不进 Git；
继续走服务器 secret/environment 管理。

也可以采用慢 KDF，但这里我更倾向 HMAC：验证码寿命很短、有严格尝试次数限制，而且 HMAC 不会额外给你这台 396 MB 机器制造 KDF 压力。

3. OTP verification 应该是原子的

建议把语义现在冻结：

SELECT challenge FOR UPDATE
↓
检查未过期 / 未消费 / attempts 未超限
↓
constant-time 比较 digest
↓
错误：
  failed_attempts += 1
  达上限则使 challenge 失效

正确：
  consumed_at = now()
  创建 session
↓
COMMIT

这样两个并发请求不能用同一个验证码成功登录两次。

新请求验证码时，也应明确旧 challenge 的规则。我建议：

同一用户的新 challenge 创建后，之前未消费的 challenge 全部失效。

否则“重新获取验证码”之后旧码还有效，会增加状态复杂度。

4. 现在不要发明“手机号自动注册”语义

这是 Slice 0A 目前仍然没有证据的地方。

你只观察到了：

手机号
→ 获取验证码

你没有观察到验证码正确之后：

已有账号登录
还是
首次手机号自动建号
还是
进入完善资料
还是
不存在用户时报错

因此 Slice 0B 不应该擅自实现：

未知手机号 → 自动创建 users。

当前最保守的 M3 实现应该是：

只有已由 seed/admin 创建且绑定 phone 的用户可以最终登录。

对未知手机号：

请求验证码接口保持与已存在用户一致的外部响应，避免枚举；
但验证成功也不能自动创建真实账户。

“首次手机号账号生命周期”继续标记为 UNOBSERVED / NOT IMPLEMENTED。

这不是 M3 未完成，而是你没有证据支持凭空发明。

5. Q2：真实生成 OTP 是正确的，但我不建议把明文验证码写进普通服务日志

所以我的结论是：

“没有 SMS 时用开发投递通道”这个方案接受；“把验证码写进普通 journal/application log”不建议接受。

验证码在有效期内本质上也是一个 credential。你 M2 已经专门证明：

bearer 不出现在日志。

那现在再把 OTP 写进 journalctl，安全原则会不一致，而且你的 Gate 又习惯完整保存子脚本输出，很容易误收进 evidence。

我更推荐一个极小的 development OTP sink

例如：

OTP_DELIVERY=dev-file

服务端仍真实：

random OTP
→ HMAC digest 存 DB
→ 正常 expiry / attempts / single-use

但明文验证码只暂存在：

/run/campus-otp/<challenge-id>

要求：

目录 0700
文件 0600
tmpfs / reboot 自动消失
消费或过期后删除

再由：

dist/admin.mjs read-login-code <challenge-id>

供你本地/Gate 操作者读取。

它不是万能验证码，也没有绕过认证逻辑：

Gate 拿到的仍然是这一次服务器刚刚随机生成的真实 challenge code。

未来接 SMS provider，只替换 delivery adapter：

dev-file → sms

OTP/authentication 核心完全不用改。

这比“日志投递”干净很多。

如果你坚持日志模式

最多把它定义成：

DEVELOPMENT DELIVERY ONLY

并保证：

不进入普通 access/application log；
不进入 Gate transcript；
不进入 evidence ZIP；
生产配置无法启用。

但既然你已经有 admin.mjs，我认为 /run + admin CLI 明显更适合这个项目。

6. 验证码页面的证据口径需要修正一下

这里我建议你不要写：

整个项目现在 evidence-blocked = 0

而要稍微精确一些。

你现在能够严格声称的是：

原先登记的 22 个 baseline pages：22 observed / 0 evidence-blocked。

但是 Slice 0A 同时新发现了一个：

登录验证码后续 UI/state，目前 BLOCKED_BY_ETHICS。

因此建议 manifest 分两层：

baseline_page_coverage:
  total: 22
  observed: 22
  blocked: 0

同时另有：

behavioral_unknowns:
  - login_verification_state:
      status: BLOCKED_BY_ETHICS

否则以后报告里直接写：

evidence-blocked = 0

读者很容易理解成“现在所有已发现行为都没有证据缺口”，而事实不是这样。

如果将来确认验证码阶段实际上是一个新的独立 Activity/page，而不是同一个 Activity 的 state，那么再正常把 page inventory 从 22 扩张，并保留 history。

7. Slice 0B 的 UI 可以实现，但 Gate 必须拆开“功能正确”和“视觉一致”

因为验证码页面没有观察证据，所以这部分不能进入：

VISUAL_CONFORMANCE PASS

建议写成：

LOGIN_ENTRY_VISUAL:
PASS

因为 login-select / login-sns 已有真实证据。

而验证码页面：

OTP_UI_FUNCTIONAL:
PASS

OTP_UI_VISUAL_CONFORMANCE:
NOT_EVALUATED
reason=BLOCKED_BY_ETHICS

这会比“合理推断实现后算 1:1”诚实很多。

8. 你这次 liveness/readiness 修复方向正确，但还缺一个必须确认的保护

你诊断得对：

await migration
→ listen

确实破坏了：

liveness != readiness

改成：

listen
→ migration/background DB initialization

方向正确。

但现在必须确保：

在 migration 尚未成功时，所有依赖数据库 schema 的业务 API 都返回 503，而不是尝试访问旧 schema。

理想状态：

/api/health
→ 200

/api/ready
→ 503

/api/posts
/api/auth/*
...
→ 503 service unavailable

直到 migration + compatibility check 完成：

dbReady = true

否则只是把：

connection refused

变成了：

backend 已监听但业务 API 对半迁移 schema 发 SQL。

后者反而更危险。

另外我不建议所有 migration error 都每 10 秒无限重试。

应该区分：

Transient:
PG unavailable / timeout
→ retry

Terminal:
checksum mismatch
SQL migration syntax/error
unexpected schema state
→ remain NOT_READY
→ loud diagnostic
→ 不死循环执行 migration

advisory lock 继续保留。

如果你当前实现已经这样做，那这个 defect 可以直接销项；如果还没做，这是 Slice 0B 开工前的 P0。

9. 几个模型结论的判定

schools + campuses：SUPPORTED，接受。 “校园圈粒度是 school × campus”已经是足够强的新证据，users/posts 的 legacy FK 继续 NULL 也符合之前“不伪造历史事实”的原则。

groups.name ≤ 24：作为业务上限接受。 但“24 字”到底按 Unicode code point、UTF-16 code unit 还是 grapheme cluster 计数，目前还没有证据。中文普通字符没问题；以后如果真实群名 UI 测到 emoji，再确认边界语义，不要现在过度声明。

群名(N)：展示字段，不入库，接受。

places.address：建议把文档措辞从：

address 不限长

改成：

没有观察到支持短长度上限的证据，因此 V0.1 使用 TEXT，不人为增加 CHECK。

30 字地址只能证明“至少要容纳这种长度”，不能证明原版理论上无限长。这是很小的证据措辞问题，不阻塞。

10. Slice 0B 可以怎么开始

所以我批准的 Slice 0B 是：

Observed login UI
→ phone_e164
→ request login challenge
→ real random OTP
→ dev delivery sink
→ verify one-time challenge
→ issue existing M2 opaque session
→ /api/auth/me
→ App session persistence
→ logout/revoke

并要求：

不再使用 session fixture 来证明 Slice 0B 主路径。

Gate 最终至少应该证明一次：

App 冷启动
→ 无 session
→ login-select
→ agreement dialog behavior
→ phone page
→ request code
→ operator 从 dev sink 获取本次随机 code
→ UI 输入
→ server consumes challenge
→ session issued
→ /me identity correct
→ restart App session still valid
→ logout
→ old token 401

这条跑通以后，你才真正完成了：

M2 authentication mechanism → M3 observed identity semantics → real device UI

的闭环。

最终裁定

Preflight 和 Slice 0A 可以正式关闭。Slice 0B 可以开工，但请先做三处小修订：

公开 handle/password 登录被 phone+OTP supersede，不保留两个产品登录路径；
OTP 使用 keyed HMAC，而不是普通 hash；开发投递使用独立 dev sink，优先 /run + admin CLI，不要进入普通日志；
确认“先 listen 后 migration”时所有 DB 业务路由在 ready 前统一 503，并区分 transient retry 与 terminal migration failure。

这三点落实后，我认为 Slice 0B 不需要再等新的设计审核，可以直接实现并提交 Gate 结果。
