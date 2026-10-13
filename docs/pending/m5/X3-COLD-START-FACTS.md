# X3 事实报告：后端冷启动 / 资源压力调查（`BACKEND_COLD_START / RESOURCE_PRESSURE INVESTIGATION`）

> 时间：2026-09-22 07:52｜Round 264｜依据：审核记录 55 的 **DO NOW** 清单
> 立场：**只记录事实，不改任何参数**（审核 55：DO NOT blindly raise max_connections /
> add more swap as "the fix"；先记录，再判断）

## 一、直接结论（三条，按证据强度排列）

```
① CLEAN_COLD_START: **11 ~ 20 秒**（本机连续实测 3 次：14s / 11s / 20s）
   → 这是**空闲状态下**的真实冷启动耗时。
② HISTORICAL_176S_EPISODE: 2026-09-22 06:49:54 → 06:52:50 = **176s**
   → 该次观测期间**我正在并发跑多个 gate/脚本**。
   → 与"并发争用导致变慢" **CONSISTENT**，但**未被证明**（未做受控并发复现）。
③ 清洁冷启动期间**没有**资源耗尽：MemAvailable 216~225 MB、swap 增量 **0 页**、
   campus 连接数最大 **2**、等待中的锁 **0**、无 OOM、loadavg ≤ 1.54
```

**⭐ 这组数据**直接证实审核 55 对我原断言的驳回**是对的**：
我先前写的"服务器资源是**根因层**问题（396MB + max_connections=15）"**站不住** ——
在真正观测到快启动的那几次里，内存**很充裕**（MemAvailable 约 200MB+，不是我以为的"仅 8MB"）。

## 二、我先前那条断言的错误在哪（值得记住）

```
我引用的数字：free = 8 MB ／ swap used = 183 MB ／ loadavg 3.27 ／ max_connections = 15 (used 10)
问题：
  · `free` 很小 **不等于** Linux 已无可用内存 —— 要看 **MemAvailable**
      → 实测 MemAvailable = 216~225 MB（**充足**）；free 小主要来自 page cache/buffers
  · swap 有使用 **不等于** 当次 DB unreachable 由 swap 导致
      → 实测清洁启动窗口内 swap_in/out 增量 **0 页**
  · max_connections=15 且 used=10 确实紧，但**没有实际的 connection error / SQLSTATE** 就不能断言"连接耗尽"
      → 实测清洁启动期间 campus 连接数最大仅 **2**，且等待中的锁为 0
  · 而且在 396MB 的机器上贸然提高 max_connections **反而可能加剧**内存压力（审核 55 原话）
```

## 三、本轮实际采集到的事实

### 3.1 静态配置
```
应用连接池（server/src/config.ts 默认值，server.env **未**覆盖任何 PG_*）：
  PG_POOL_MAX            5
  PG_IDLE_TIMEOUT_MS     10000
  PG_CONNECT_TIMEOUT_MS  5000
PostgreSQL 连接预算：
  max_connections = 15 ／ superuser_reserved_connections = 3 → 应用可用约 12
所有会连库的客户端（审核 55 要求核对）：
  [1] campus-backend.service（池上限 5）
  [2] gate/test 脚本（verify-*.sh 各自开 psql / curl）
  [3] cleanup / cleanup-auth / seed / admin（oneshot；且 systemd timer 每 6h 触发 cleanup）
  [4] 人工 psql 会话
```

### 3.2 三次清洁冷启动（逐秒采样见各 `01-readiness-timeline.csv`）
```
run        READY_AT   MemAvailable(min~max)     swap_in/out 增量   conn(max)  wait_lock(max)  loadavg(max)
x3b        14s        203064 ~ 231568 kB         0 / 0              2          0               1.09
x3c        11s        （同上量级）                0 / 0              2          0               1.09
x3d        20s        216576 ~ 225172 kB         0 / 0              2          0               1.54
```
启动阶段 journal（x3b 为例）：
```
07:48:42 Started
07:48:51 [uploads] tmp 目录就绪     (+9s)
07:48:54 [listen] :3001            (+12s)
07:48:56 [migrate] ready applied=11/11  (+14s)   ← 首次 /api/ready=200 也在 14s
启动期 distinct 错误明细：**空**（完全没有 "database unreachable"）
```

## 四、代码侧的一项改动（审核 55 的 DO NOW：记录精确 SQLSTATE）

**发现**：`server/src/db.ts` 的启动探针原来是 `} catch { return false }` ——
**错误被完全吞掉**，所以日志只说得出 `[migrate] retryable: database unreachable`，
**没有 code / errno / syscall / message**。

**改动**（只记录，不改判定/重试行为）：
```
把 pg 错误的可归因字段取出来存进 state.lastError：
  code=<SQLSTATE> errno=<...> syscall=<...> address=<...>:<port> message=<...>
缺哪个写 <none>（不用空串掩盖"没取到"）
```
`index.ts:2519` 会打印 `[migrate] ${st.state}: ${st.lastError}` → 下次真出问题时**可归因**。

⚠️ 实现形态上的一个自省：我第一版写成"外层 `let probeErr` + 在 catch 里赋值"，
tsc 报 **6 个** `Property 'x' does not exist on type 'never'` ——
因为**外层控制流分析看不到嵌套函数里的赋值**，把变量一路收窄成 `null`。
→ 改成**由 IIFE 直接 return 结果**，类型完全确定、不需要断言。

## 五、⭐ X3.1 受控并发复现：争用假设**已被证明**（不再是"只一致"）

> 方法：唯一变"并发 DB 客户端数 N"，其余保持一致（同一脚本事先起 N 个后台只读 DB worker，
> 重启后端，逐秒测 `/api/ready`）。N=0 即 §一 的基线。

```
N   READY_AT_s  loadavg(before→after)  conn_before  'database unreachable' 次数
0   **13 s**    0.41 → 1.05            2            0
8   **18 s**    1.45 → 3.93            2            0
20  **180 s**   5.08 → **24.97**       2            1
```

**结论：冷启动耗时随并发 DB 客户端数急剧上升（13 → 18 → 180 秒）。**
且 N=20 时 loadavg 冲到 **24.97**（2 vCPU），启动期**真的出现了 `database unreachable`**
—— 与 06:49 那次 176 秒的日志形态一致，耗时也几乎重合（180 vs 176）。

⚠️ **精确措辞（审核记录 56 修正）**：本实验里 N **同时改变了多个东西** ——
`psql 进程创建 ／ 连接 churn ／ DB 工作量 ／ CPU 调度压力 ／ 系统负载 ／ 可能的瞬时连接槽竞争`。
所以**不能**说"连接 churn 本身已被证明是根因"。正确冻结：
```
COLD_START_DEGRADES_UNDER_CONCURRENT_DB_CLIENT_LOAD:  **PROVEN**
SPECIFIC_SUBMECHANISM
  (CPU scheduling vs process churn vs connection churn vs transient slot pressure):
                                                    **NOT ISOLATED**
HISTORICAL_176S_EPISODE_EXPLAINED_BY_CONTENTION:      **STRONGLY SUPPORTED**
```
（历史事件**不升级为 PROVEN**：180s 与 176s、相同启动阶段、相同 `database unreachable`
形态已使归因非常有カ，但历史那一轮没有当时的完整因果观测。）

### 5.1 一个反直觉的观察：稳态连接数很低，但耗时差 14 倍
三档里 `conn_before` 都是 **2**，但耗时差 14 倍。
原因：负载 worker 用 `psql -c '...'` —— **每跑一次就建一次连接、跑完即退**。
所以瞬时连接数很低，但**连接建立/销毁的频率极高**。

⚠️ **但这不足以排除 max_connections 相关！**（审核记录 56 的修正）
`conn_before=2` 只是**某个采样时点的稳态快照** —— worker 是短生命周期，
**不能排除**负载期间出现**瞬时连接峰值**。20 个 worker 对一个
`max_connections=15` + `reserved=3` 的实例施压时，**瞬时连接槽竞争是一个合理候选**。
正确写法：
```
MAX_CONNECTIONS_AS_ROOT_CAUSE:      **NOT ESTABLISHED**
NO EVIDENCE JUSTIFYING RAISING IT:  YES
```
若后续压力实验里新加的 SQLSTATE 捕获出现 `too_many_connections` 之类，
**反而会成为证据**；只有明确捕获到**其它**连接/调度故障、**且**连续采样证明峰值远低于上限，
才可以进一步排除。**这不改变操作结论：现在不要提高 max_connections。**

### 5.2 边界（不夸大）
· 本实验只变"**并发 DB 客户端数**"这一维；真实 gate 负载还含 HTTP 请求、媒体上传等。
· N=20 是**刻意压到极端**（loadavg 25）以验证灵敏度，**不代表**日常工作负载。
  8 档（loadavg 3.9）已使耗时从 13s 升到 18s —— 日常并发就在这个量级。
· 采样的**采样率是 1 Hz**，"瞬时峰值"可能被漏采 —— 这也是"NOT ESTABLISHED"而非"已排除"的原因之一。

## 六、最终账本（**按审核记录 56 的建议冻结**，含两处精度修正）

```
X3_CLEAN_COLD_START:                                  PASS
    观察到 11–20s（多次独立清洁启动）
CONCURRENT_DB_CLIENT_LOAD_CAUSES_READINESS_DEGRADATION:
                                                      **PROVEN IN CONTROLLED EXPERIMENT**
    0 → 13s ／ 8 → 18s ／ 20 → 180s
EXACT_LOW_LEVEL_BOTTLENECK:                           **NOT ISOLATED**
    （CPU 调度 / 进程 churn / 连接 churn / 瞬时连接槽竞争：本轮无法区分）
HISTORICAL_176S_EVENT:                                STRONGLY CONSISTENT WITH /
                                                      SUPPORTED BY CONTENTION MECHANISM
MEMORY_EXHAUSTION_AS_ROOT_CAUSE:                      NOT SUPPORTED BY CLEAN-START EVIDENCE
MAX_CONNECTIONS_AS_ROOT_CAUSE:                        **NOT ESTABLISHED**
CAPACITY_CHANGE:                                      NOT WARRANTED BY CURRENT EVIDENCE
```
审核 56 的理由：这比"176s 已完全证明由连接 churn 导致"**更经得起以后复审**。

### FIX CHAIN（三条已各自落实，合起来覆盖这一问题）
```
① **Gate 互斥锁**（gate-lock.sh）→ 阻止"多个 Gate 并发跑"这一**致因**
② **破坏性测试已从常规回归拆出**（X2）→ 常规回归**不再重启**正在服务的后端
③ **就绪轮询**（/api/ready，超时 240s；deploy-server.ps1 也从"等 liveness"改成"等 readiness"）
```

### 容量决策（审核 56 确认）
```
max_connections: UNCHANGED ／ swap: UNCHANGED ／ machine size: UNCHANGED   ← 正确
```
已证明：清洁启动 11–20s、MemAvailable ~216–225MB、swap 增量 0、无 OOM、应用侧 DB 并发很低
⇒ **没有证据**支持"机器在正常负载下无法运行"，而真正该先做的三个工程修复已经完成。
⇒ 扩容保持为 **SEPARATE OPERATIONS / CAPACITY DECISION**，不是 M5 correctness fix。
以后若正常工作负载下仍频繁出现持续内存压力／swap-in-out／readiness 延迟／
DB 连接饥饿／不可接受的用户延迟，再用**实际容量数据**决定。

### DO NOT
· 不提高 max_connections（`MAX_CONNECTIONS_AS_ROOT_CAUSE: NOT ESTABLISHED`；
  但注意**并非"已排除"** —— 见 §5.1 的采样局限）· 不加 swap 当作"修复"

### 仍待观察
· 若再次出现慢启动，`[migrate] ...: code=<SQLSTATE> ...` 会给出可归因证据
  （若真出现 `too_many_connections` 之类，**反而会成为** max_connections 相关的证据）
