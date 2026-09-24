# M3 Slice 0B 报告：手机号 + 一次性验证码登录

> 依据：`docs/review-log/08-m3-preflight-slice0a-verdict.md`（Slice 0B 的 CONDITIONAL GO 与三处开工前修订）
> 完成时间：2026-09-21（Asia/Shanghai）
> Gate：`scripts/gates/m3/slice0b.ps1` → **M3_SLICE0B_GATE_RESULT: PASS**

## 一、结论（按审核要求的拆分口径）

```
M3_SLICE0B_GATE_RESULT: PASS

LOGIN_ENTRY_VISUAL:        PASS
OTP_UI_FUNCTIONAL:         PASS
OTP_UI_VISUAL_CONFORMANCE: NOT_EVALUATED  reason=BLOCKED_BY_ETHICS
SMS_GATEWAY_NOT_INTEGRATED: 真（无短信通道，投递走 dev sink）
```

**必须说清楚**：`OTP_UI_VISUAL_CONFORMANCE` 是 `NOT_EVALUATED`，不是 PASS。
验证码页没有得到原版证据（取证会给一个真实手机号真发短信，主动停止），
所以它只能算"合理推断实现"，**不得声称与原件 1:1 一致**。

## 二、三处开工前修订的落实与验证

### 修订 1：公开 handle/password 登录被 phone+OTP supersede

| 措施 | 验证 |
|---|---|
| `POST /api/auth/login` → **410**（明确"已退休"） | Gate 断言：`login_status=410` |
| **删除 `users.password_hash` 列**（迁移 005） | Gate 断言：`password_col=0` |
| 移除 `auth.ts` 里的 scrypt / 密码哈希原语 | 代码层面已无密码路径 |
| 删除 `scripts/m2/verify-auth.sh`（测已退休契约），M2 Gate 改调 M3 脚本 | Gate 里认证组直接跑 M3 脚本 |
| 两条外部可观察断言 | 发密码后 **sessions_delta=0**；响应里 **无 token 字段** |

关于最后一条：第一版断言是"产物里 grep 有没有 scrypt 字符串"——
那是**实现位置**断言，PLAN §10 明确要求 Gate 验证外部有意义的状态；而且它会误报。
已替换为上面两条外部事实。

### 修订 2：OTP 用 keyed HMAC + 独立 dev sink + 不进日志

| 措施 | 验证 |
|---|---|
| `code_hmac = HMAC-SHA256(密钥, "<phone>\|<code>")` | Gate 断言：64 位 hex、非明文、**且不等于裸 SHA-256(code)** |
| 密钥在部署时生成到 `/srv/campus/.login_code_hmac_key`（600），经 server.env 注入；缺失时接口**失败关闭(503)** | Gate 断言：`scrypt`→ 改为外部事实；密钥缺失路径有单测覆盖 |
| HMAC 消息含手机号（防跨号重放） | 设计断言 + 代码注释 |
| dev sink 用 `/run`（tmpfs），目录 0700 / 文件 0600 | Gate 断言：`sink_dir_perm=700`、文件 0600 |
| systemd `RuntimeDirectory=campus`（重启后自动重建） | Gate 断言：`RuntimeDirectory=campus` |
| **验证码不入普通日志** | Gate 断言：journal 与 nginx access log 中均无该验证码 |
| 运维取码：`dist/admin.mjs latest-code`（不经日志） | 设备 E2E 的实际取码路径 |

### 修订 3：先 listen 后迁移时的就绪门禁

| 措施 | 验证 |
|---|---|
| 所有依赖 schema 的业务路由在就绪前统一 **503** | Gate：停 PG 后 `/api/posts`=503、`/api/auth/me`=503、`/api/auth/request-code`=503 |
| liveness 不受牵连 | Gate：`/api/health`=200 |
| readiness 如实 503 | Gate：`/api/ready`=503 |
| 恢复后自愈 | Gate：PG 恢复后 `/api/posts`=200 |
| 区分 transient / terminal | 代码：`classifyMigrationError()`；transient 每 10s 重试，terminal **停止重试** + 响亮诊断 |
| 迁移校验和 | `schema_migrations.checksum`；已应用迁移被改动 → terminal，绝不自动重跑 |
| advisory lock | **先拿锁再读状态**（见第四节） |

## 三、设备端闭环（审核要求的"至少证明一次"）

`scripts/m3/verify-device-login.ps1`，**全程没有注入任何 session 夹具**：

```
App 冷启动（force-stop + 重启 + 清空本地存储）
  → 个人页（真实点击底部导航）
  → 登录入口（真实点击「登录 Campus」）
  → 未勾选协议点登录 → 弹出「请阅读并同意以下条款」+「同意并继续」
  → 同意并继续 → 手机号页
  → 输入手机号 → 点「获取验证码」（真随机码、60s 倒计时）
  → 运维从 dev sink 取本次随机 6 位码
  → UI 输入验证码 → 点「登录」
  → 会话签发 → /api/auth/me 身份正确（+86 手机号）
  → 重启 App → 会话仍有效
  → 真实点击「退出登录」→ 本地清空 → 旧 token 401
  → 清理测试账号
```

结果：`DEVICE_LOGIN_E2E_RESULT PASS`

**这个闭环补齐了 M2 到 M3 的最后一段**：
`M2 authentication mechanism → M3 observed identity semantics → real device UI`。

## 四、Gate 抓出的真实缺陷（都已修）

| # | 缺陷 | 分类 | 修法 |
|---|---|---|---|
| 1 | **迁移竞态**：原实现"先读已应用集合 → 再拿锁 → 再按旧集合应用"，并发调用（后台迁移 + `/api/ready`）都认为 005 未应用，第二个 INSERT 撞主键；而 duplicate key 被归为 terminal → 服务把自己判成终态、业务路由全 503 | PRODUCT_DEFECT | 把"读状态"挪进锁内（检查与动作同一临界区）；插入加 `on conflict` 兜底；`refresh()` 加 single-flight；终态短路不再重复跑迁移 |
| 2 | **门禁状态过期**：`status()` 是上次 refresh 的快照，PG 在两次 refresh 之间挂掉时门禁仍以为 ready → 业务路由 500 而不是 503 | PRODUCT_DEFECT | 加 `db.noteFailure()`：顺着真实请求观察到的连接错误立刻降级；另加 10s 健康心跳（故障降级 + 恢复自愈） |
| 3 | **`/api/auth/me` 把"库挂了"误报成 401** | PRODUCT_DEFECT | `resolveSession` 返回 `ok/none/db_down` 三态，`db_down` → 503 |
| 4 | seed 验证脚本用 `kill %1` 清理临时实例，非交互 bash 里无效 → 残留进程占着测试端口，下一次就绪探测从旧进程拿到 200 而目标库还没建表 → seed 假失败 | GATE_DEFECT | 按 PID 清理 + 起实例前先释放端口 + 断言该库的迁移版本数 |
| 5 | Gate 里 ssh 的 stderr 被 `ErrorActionPreference='Stop'` 当成终止错误，**整个 Gate 被打断**，第 5 节拿不到结果 | GATE_DEFECT | 统一走 `Invoke-SshRaw`（临时放宽），并保留全部诊断行 |
| 6 | TLS/后端脚本用已退休的密码登录取会话（`invalid input syntax for type uuid: ""`） | GATE_DEFECT | M3 阶段改用手机号 + dev sink 取码 |

第 1–3 条有一个共同点：**它们都不会在"happy path 单次运行"里暴露**，
只有并发、时序、故障注入才打得出来 —— 这正是 Gate 该做的事。

## 五、隐私修复（顺带发现）

我们自己的源码里曾经硬编码了原版截图里的**真实手机号**（`LoginScreen.tsx`）。
M0 之所以要在 `login-sns` 截图与控件树上打码，就是因为原版输入框里留着它。
已改为默认空 + 占位提示；全仓确认仅此一处。

## 六、与本阶段（M3）其余部分的关系

- 本提交只完成 **Slice 0B**。M3 还有 Slice 1（帖子详情/评论 → 解决 `comments.parent_id`）、
  Slice 2（点赞）、Slice 3（登录后发帖，**无 session 夹具**）、Slice 4（恢复页一致性）、M3 Final Gate。
- Slice 3 现在**已经具备条件**：设备端登录闭环可复用 `verify-device-login.ps1` 的 A–D 段。
- 模型验证登记表（`docs/m3/MODEL-VALIDATION.md`）里 #1 登录语义已判 `SUPPORTED`；
  #3 `comments.parent_id` 待 Slice 1 解决。

## 七、证据文件

| 文件 | 内容 |
|---|---|
| `docs/m3/evidence/gate-slice0b-*.txt` | Gate 全量输出（含每组 PASS/FAIL 与诊断） |
| `docs/m3/evidence/device-login-*.txt` | 设备端闭环输出 |
| `docs/m3/evidence/auth-otp-*.txt` | 认证脚本 A–G 组输出 |
| `docs/m3/evidence/seed-*.txt` | seed 幂等/canonical/收敛性 |
