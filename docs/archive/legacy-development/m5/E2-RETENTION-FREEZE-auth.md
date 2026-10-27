# E2：认证相关表的 **retention 语义冻结**（auth hygiene retention freeze）

> 时间：2026-09-22 01:29｜依据：审核记录 39 的明确顺序
> （"先查状态分布 → 冻结 retention 语义 → 增加 auth-specific cleanup → Gate 检查 stale/dead rows"）
> 前置：E1 审计已完成（`docs/archive/legacy-development/m5/EVIDENCE-auth-hygiene-audit.txt`）

## 一、为什么要"冻结语义"而不是直接写清理

审核记录 39 的核心反对意见（我已采纳）：

> `sessions=122` 可能是"120 条早已过期的垃圾"，也可能是"122 条仍合法的活跃 session"
> —— **这两个语义完全不同，总行数不是正确的 invariant**。

E1 审计**证实了这一点**：本库 `sessions` 共 130 条，其中 **active（未撤销未过期）= 94 条**。
→ 任何"按总数清理"或"总数上界门禁"都会误伤合法会话。

因此必须先定义**"确定已经死亡的数据"**，且该定义只依据 schema 已有的语义字段
（`expires_at` / `revoked_at` / `consumed_at`），**不依据总数、不依据"看起来很久没用了"**。

## 二、schema 事实（来自迁移文件，非假设）

```
sessions（002_identity.sql）
  id, user_id, token_hash, created_at, expires_at, revoked_at
  CHECK revoked_at IS NULL OR revoked_at >= created_at
  CHECK expires_at > created_at

login_challenges（005_phone_otp_identity.sql）
  id, phone_e164, code_hmac, created_at, expires_at, consumed_at, attempts
  CHECK expires_at > created_at
  CHECK consumed_at IS NULL OR consumed_at >= created_at
```

**重要**：`sessions` 没有 `last_used_at` / `last_seen_at` 之类字段
→ **无法**据"多久没用"判断死亡，只能据"**已过期**"或"**已撤销**"。
这一点必须写进注释，防止将来有人想"顺手清掉 30 天没用的会话"（那是**无依据**的删除）。

## 三、冻结的定义（**只有这四类算"确定已经死亡"**）

设 `grace` = retention 宽限期（**默认 24 小时**，可用 `--grace-hours` 覆盖）。

```
① EXPIRED_SESSION      （会话已过期且过期已超过 grace）
     expires_at  < now() - grace
     且 revoked_at IS NULL   ← 注意：已撤销的走 ②，两类不重复计数
② REVOKED_SESSION      （会话已撤销且撤销已超过 grace）
     revoked_at  IS NOT NULL  AND  revoked_at < now() - grace
③ EXPIRED_CHALLENGE    （验证码挑战已过期且过期已超过 grace）
     expires_at  < now() - grace
     且 consumed_at IS NULL  ← 已消费的走 ④，两类不重复计数
④ CONSUMED_CHALLENGE   （挑战已消费且消费已超过 grace）
     consumed_at IS NOT NULL AND  consumed_at < now() - grace
```

### 3.1 **绝不**删除的集合（写成硬约束）

```
ACTIVE_SESSION          revoked_at IS NULL AND expires_at > now()
VALID_PENDING_CHALLENGE consumed_at IS NULL AND expires_at > now()
```

⚠️ **这两类永不按数量、永不按 age、永不按"看起来没用"删除**。
   只有 ①②③④ 四类可删，且各自都必须"超过 grace"。

### 3.2 为什么 ④ CONSUMED_CHALLENGE 不需要"再过期"也能删

已消费的挑战**语义上已经完成**（`consumed_at` 非空即"这次登录已用过它"），
其 `expires_at` 是否过了与"它是否还可能有用途"无关 —— 它已经不可能再被使用
（消费是终态；任何再次使用都会因 `consumed_at` 非空而被拒）。
因此判据是"consumed_at 超过 grace"，而不是"expires_at 超过 grace"。

⚠️ 但**仍要求超过 grace**：保留 grace 是为了让"刚刚发生的登录"在短时间内仍可被审计/排障
（比如用户报"我没登录过"，需要能查到刚才那条 challenge）。

## 四、为什么 `grace` 默认取 **24 小时**

依据 E1 审计的实测分布（不是"拍一个数"）：

```
grace=1h  → revoked session 36 ；consumed challenge 87 ；expired challenge 92 ；expired session 0
grace=1d  → 全部为 0        ← 现有数据的年龄全部 < 1 天
grace=7d  → 全部为 0
```

- 现有数据的最大年龄 < 1 天（库还很年轻），所以 grace=1d 时候选为 0 —— **不会误删任何现有数据**
- 同时 24h 是"用户报障回溯窗口"的合理上界：用户说"我刚才没登录过"，
  排障通常在数小时内完成，24h 宽限足够
- 参考本项目对 **media unattached TTL 的取值方法**（`cleanup-entry.ts` 里论证过：
  真实窗口是"本次 composer 会话"，24h 比它大两个数量级）→ 这里同样取 24h 保持一致的尺度感

⚠️ **`grace` 必须可配**（`--grace-hours`），因为它是**策略**不是**事实**：
   运维可能希望更长（合规审计）或更短（磁盘紧张）。

## 五、实现约束（交 E3 执行）

```
1. **独立工具** `cleanup-auth`，**不塞进 media cleanup**
   —— 避免把"媒体生命周期"与"认证生命周期"绑成一个破坏半径很大的工具（审核明确要求）
2. dry-run 默认；只有显式 --apply 才删
3. **分类计数**（绝不合成一个数字）：expiredSessions / revokedSessions /
   expiredChallenges / consumedChallenges / activeSessions / pendingChallenges
4. DB 错误时 **fail closed**：没有 DATABASE_URL → 退出码 2 且**不执行任何删除**
5. 删除顺序无关（本表无外键引用；E1 已核实 `referencing_tables = (无)`），
   但仍用**单事务**删除以保证"要么全删要么全不删"
6. 幂等：连跑两次，第二次候选为 0
7. 输出 JSON 与人类可读两种（沿用 cleanup-entry.ts 的 --json 约定）
```

## 六、Gate 约束（交 E4 执行）

```
✅ 允许的状态型不变量：
     STALE_EXPIRED_SESSIONS        = 0   （expires_at  < now() - 24h 的会话数必须为 0）
     STALE_REVOKED_SESSIONS        = 0
     STALE_EXPIRED_CHALLENGES      = 0
     STALE_CONSUMED_CHALLENGES     = 0

❌ 禁止的不变量：
     sessions < 50  /  login_challenges < N   ← 总数不是 invariant（E1 已证）
     任何"按 age 删会话"的不变量            ← schema 无 last_used_at，无依据

ℹ️ 总数只作**次级** trend/告警：
     INFO active_sessions=…  pending_challenges=…
     WARN total_sessions unusually high
```

## 七、声明强度

```
本冻结证明/定义了: "哪些行算确定已死" 的**判据**，以及"哪些行永不删"的硬约束
本冻结**不**声称:
  · 该 grace 值最优（它是可配策略，默认 24h 有理有据但非唯一解）
  · 删除后不可恢复（删了就没了 —— 所以 dry-run 默认 + 分类计数）
  · 覆盖了"会话被窃取"等其他安全语义（那是另一件事，不在本单范围）
```
