# 审核记录 55：WO#13 关账（PASS/CLOSED）+ **驳回我的根因断言** + 三处方法论修正

> 时间：2026-09-22 07:26｜Round 263｜来源：网页版 ChatGPT 独立审核
> 关联提交：`39652d7`（WO#13 实施）、`51e4048`（CORS 缺 DELETE + 部署脚本修复）、`756787b`（gitattributes 固定 LF）

## 一、WO#13：**PASS / CLOSED**

```
WO13_PROFILE_EDIT_AUTHORITATIVE_WRITE: PASS / CLOSED

PROFILE_EDIT_NAME_FROM_AUTHORITY             PASS
PROFILE_EDIT_SAVE_HITS_SERVER                PASS
PROFILE_EDIT_DB_PERSISTENCE                  PASS
PROFILE_EDIT_SAVE_REFLECTS_SERVER            PASS
PROFILE_EDIT_RELOAD_PERSISTS                 PASS
PROFILE_EDIT_FAILURE_KEEPS_INPUT             PASS
PROFILE_EDIT_NO_FAKE_SUCCESS_ON_FAILURE      PASS
PROFILE_EDIT_INVALID_INPUT_ZERO_MUTATION     PASS
PROFILE_EDIT_NO_INERT_CONTROLS               PASS
PROFILE_EDIT_NO_SOURCELESS_FIELDS            PASS
PROFILE_EDIT_ENTRY_CORRECT                   PASS
PROFILE_AUX_ENTRIES_NOT_MISROUTED_TO_PROFILE_EDIT  PASS
ORPHAN_PROFILE_MOCK_ROUTES_REMOVED           PASS
NO_FABRICATED_MEMBER_COUNT                   PASS
ORIGINAL_PROFILE_EDIT_PAGE_CONFORMANCE       NOT_EVALUATED
```

审核 55 特别指出：**「四方一致：PATCH response = DB = /api/auth/me = /api/users/:id」
这一组 oracle 很强 —— 它证明的不是"请求发出去了"，而是真正的 authoritative persistence。**
失败保留 draft、未知字段 400、4xx 零 mutation、测试后精确恢复 seed 也都符合先前冻结的要求。
CORS 缺 PATCH 是本单实施中发现并修掉的真实端到端缺陷，**不形成 closure gap**。
五个 Me 条目的处理**正确**：只有「编辑资料」有 destination evidence；
其余四项保留存在性、取消未经证据支持的错误跳转，比"全部连到一个假页面"更准确。

---

## 二、⭐ **驳回我的根因断言**（我过度断言了，必须纠正）

### 我写的（**过强，不成立**）
> "⚠️ 服务器资源是**根因层**问题（396MB 内存 + PG max_connections=15）"

### 审核 55 的裁定
```
不要现在提高 max_connections；
"396MB + max_connections=15 是根因"目前**不能成立**。
```

**已确认的机制（可写 CONFIRMED）**：
```
BACKEND_RESTART
→ readiness can remain false for ~176s
→ callers that proceed before /api/ready=200 can fail
→ fixed-duration / liveness-only waiting was invalid
```
即：**"重启后过早放行流量"这一机制是确认的**；
**"240s 就绪轮询"是正确的等待语义修复，但它不是 176 秒冷启动的最终运维修复。**

**只能说明"预算很紧张"、不能单独证明根因的量**：
```
free = 8 MB            → free 很小 **不等于** Linux 已无可用内存，要看 **MemAvailable**
swap used = 183 MB     → 说明存在内存压力**迹象**，但不能证明当次 DB unreachable 由 swap 导致
loadavg = 3.27         → 是**强烈调查方向**，不是证明
max_connections = 15（used 10）
                       → 确实很紧，但**需要看到失败时的实际 SQLSTATE / connection error**
                         才能证明"连接耗尽"
```
并且审核 55 明确警告：**在只有约 396MB RAM 的机器上，贸然提高 PostgreSQL max_connections
反而可能加剧内存压力。**

### 裁定
```
DO NOT:
  · blindly raise max_connections
  · add more swap as "the fix"

DO NOW:
  · 保持 readiness-based waiting（已做）
  · 记录启动期间的**精确 DB 连接错误 / SQLSTATE**
  · 记录失败时刻的 pg_stat_activity 状态与计数
  · 检查应用连接池 max 与**所有** gate/test 的并发 DB 客户端
  · 记录 MemAvailable、swap-in/out、OOM/journal 信号

SEPARATE INFRA ITEM:
  BACKEND_COLD_START / RESOURCE_PRESSURE INVESTIGATION
```

---

## 三、⭐ 我提议的 CORS 门禁**过强**，正确的不变量是另一个

### 我提议的（**过强**）
> "每个已注册的 HTTP 方法都必须在 CORS allow-methods 里"

审核 55：这会**无意扩大暴露面** —— 将来可能存在
"server route exists but intentionally not callable from WebView/browser" 的路由；
强迫它进入 allow-methods 是错的。

### 正确的不变量
```
CORS_CLIENT_METHOD_COVERAGE:
  每一个被 WebView/browser 客户端**实际调用**的 HTTP method，
  都必须通过**真实 CORS preflight contract**。
```
机械检查不应只扫字符串，而应建立：
```
frontend API operations → method → path → 是否需要预检
```
然后对**每一种实际浏览器 method** 发真实 OPTIONS：
```
Origin: <configured app origin>
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization, content-type
```
验证：
```
· 2xx / 204
· allow-origin 合法
· allow-methods **包含**所请求的方法
· allow-headers **包含**所请求的非简单头
```
→ 以后新增 **PUT / PATCH / DELETE / 带自定义头的 POST**，
只要客户端真的会调用，就**自动进入 Gate**。
→ 这比 "registered methods ⊆ allow-methods" 更接近真实用户链路，且不会无意放宽 CORS policy。

**沉淀结论**：
```
SERVER_API_PASS ≠ BROWSER_CLIENT_REACHABLE
browser/API E2E 必须验证：origin → preflight → method → headers → 实际请求
```

---

## 四、⭐ 常规回归不该每次都重启正在服务的后端

审核 55 指出一个比"240 秒够不够"**更重要**的问题：
> **常规 M5 regression gate 不应该每次都把正在服务的 backend 重启、
> 并制造接近 3 分钟的不可用窗口。**

建议：
```
把 TMP_SELFHEAL / restart test
从「普通无副作用 regression 路径」拆出为
DESTRUCTIVE_SELF_HEAL_GATE
要求显式 maintenance / exclusive execution；
普通 server regression 尽量**不** restart 服务。
```

---

## 五、⭐ 长期间歇故障的**状态表述**要更精确

审核 55 要求不要把状态写成"已彻底根治"，也不要继续写"根因未知"，而应拆成两条：
```
PREMATURE_POST_RESTART_TRAFFIC_MECHANISM: CONFIRMED
HISTORICAL_05:19:37_EVENT:                CONSISTENT WITH THIS MECHANISM
                                          BUT NOT FORENSICALLY PROVEN
```
并说明：**已经找到足以指导工程修复的机制，旧事件本身没必要为了"100% 归因"继续考古。**

---

## 六、下一单：WO14（MeScreen 权威自身身份），**优先于 Map**

```
WO14_ME_AUTHORITATIVE_SELF_IDENTITY
```
审核 55 的理由：MeScreen 是**主导航真实 surface**，自己的身份却仍来自 mock；
而 WO#13 已经让它通往真实 ProfileEdit —— 更新昵称之后，
MeScreen 若仍显示旧的 mock name，就会产生**新的跨页面 identity inconsistency**。

**仍然先 inventory，不要直接改。** 至少查：
```
field → current source → /api/auth/me 是否已有 authoritative source
      → reload/relogin semantics → ProfileEdit 修改后是否同步
      → mock-only presentation → wire / placeholder / hide
```
Gate 至少：
```
ME_IDENTITY_FROM_SESSION
ME_DISPLAY_NAME_CONSISTENCY
PROFILE_EDIT_TO_ME_CONTINUITY
ME_AVATAR_PLACEHOLDER
NO_MOCK_SELF_IDENTITY
```
头像无权威来源 → 继续首字 placeholder，**不加列**。然后再做 MapScreen。

---

## 七、当前状态（审核 55 给出）

```
WO11: CLOSED
WO12: CLOSED
WO13: CLOSED

NEXT:
  WO14 MeScreen authoritative self-identity audit

CROSS-CUTTING:
  · add CORS_CLIENT_METHOD_COVERAGE Gate
  · split destructive self-heal/restart test from routine regression
  · investigate backend cold-start / resource / DB-connection pressure separately
```

**本轮最值得保留的方法论结论**（审核 55 原话意译）：
> 服务端 API 验证通过，只能证明**协议端点自身**工作；
> 只要真实客户端还隔着 **CORS、WebView origin、构建产物和运行状态**，
> 就不能替代客户端 E2E。
