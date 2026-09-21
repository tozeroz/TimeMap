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

## 五、结论与**不**做的事

```
CONFIRMED:
  · 清洁冷启动 11~20s；清洁窗口内无资源耗尽
  · "重启后过早放行流量会失败"这一**机制**（等待策略修正是对的）
  · 原先"资源是根因层"的断言**不成立**（已按审核 55 更正）

CONSISTENT BUT NOT PROVEN:
  · 176s 那次与并发争用相关 —— 需要**受控并发复现**才能证明
    （可做：人为并发 N 个 gate/psql，观察 READY_AT 是否随并发上升；
      这是**下一步**，本轮不做完不算数）

DO NOT（审核 55）:
  · 不提高 max_connections
  · 不加 swap 当作"修复"

仍待观察:
  · 若再次出现慢启动，`[migrate] ...: code=<SQLSTATE> ...` 会给出可归因证据
```
