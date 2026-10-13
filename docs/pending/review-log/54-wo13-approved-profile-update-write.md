# 审核记录 54：WO#13 批准（插队）+ profile-update 写能力契约 + 三项边界

> 时间：2026-09-22 07:02｜Round 263｜来源：网页版 ChatGPT 独立审核
> 对应提交：`39652d7`（WO#13 实施）

## 一、遗留状态钉死

```
WO#12: **PASS / CLOSED**（上一轮已正式裁定）
敏感度②由 INVALID_PROFILE_ID_NO_FALLBACK 而非 NO_MOCK_IDENTITY 捕获的**分工**：
      审核 54 明确表示**已接受**
```

## 二、WO#13 裁定

```
WO13_PROFILE_EDIT_AUTHORITATIVE_WRITE: APPROVED TO IMPLEMENT
PRIORITY: HIGH / PREEMPTIVE
理由：它是从 MeScreen 一步可达、**会把纯本地 state 伪装成持久保存结果**的用户信任/数据语义缺陷。
```

### 选择 (a)：新增 `PATCH /api/users/me`，只做 displayName

**措辞更正（审核 54 指出）**：它**不是**"本项目第一个写能力"——
项目已有发帖、评论、点赞等写路径。准确说法是**第一个 profile-update 写能力**。

冻结的最小契约：

```
PATCH /api/users/me
authenticated user only

body: { "displayName": "..." }
success: 200 { "id": "...", "displayName": "..." }
```

- 服务端必须从 **session** 得到 user id；客户端**不能**提交"我要修改哪个 user"
- Body 应**严格**只接受当前支持字段；`bio/gender/tags/...` **不应被静默忽略**——
  否则又会制造"调用方以为保存了"的问题

冻结的保存链：

```
draft → PATCH → DB mutation → authoritative server response → UI commit

PATCH failure → draft retained → authoritative value unchanged → no success presentation
```

### 成功 Gate 不要只看 HTTP 200

```
PROFILE_EDIT_SAVE_HITS_SERVER
PROFILE_EDIT_DB_PERSISTENCE
PROFILE_EDIT_SAVE_REFLECTS_SERVER
PROFILE_EDIT_RELOAD_PERSISTS
PROFILE_EDIT_NAME_FROM_AUTHORITY
```
建议做 **read-after-write**：`PATCH` → `/api/auth/me` → `/api/users/:selfId` **三处一致**。
测试后把**原昵称精确恢复**，避免 Gate 自己污染 canonical seed。

失败 UI 若用受控 500 stub 测试，应明确标 **CLIENT_CODEPATH**；真实服务端则至少用
非法输入验证 **4xx + zero mutation**。

### 简介 / 性别 / 标签 / 学校等：**不加列**

```
displayName:  WIRE_REAL_READ + REAL_WRITE
avatar:       initial placeholder / no fake "更换头像" control
bio / gender / tags / campus-card fields / school:
              HIDE / DEFER
              NO DB COLUMN ADDED
```
理由：当前 inventory 没有 authoritative schema，也没有页面内容基线，
**不应因为 ProfileEditScreen 长这样就反推数据模型**。

### 5 个 App.tsx 孤儿静态路由：删除其编造实现；但**不要**一律登记成 KNOWN_DEVIATION

要区分两层：
- 已证明这些 route **没有真实 UI navigation**、且里面是硬编码假数据 →
  **删除这些 fabricated route surface 是合理清理**（不能因为"可能将来有用"就保留一个
  可通过手工 URL 打开的假业务页面）
- 但 KNOWN_DEVIATION 需要**原版事实**作参照。当前只有：
  - Me 中五个条目存在：**有基线**
  - 「编辑资料」→ 资料编辑页：**有基线**
  **没有**证明兴趣/标签/介绍/学校各自进入什么页面 → 应记：
  ```
  ORIGINAL_INTEREST_DESTINATION: NOT_EVALUATED
  ORIGINAL_TAG_DESTINATION:      NOT_EVALUATED
  ORIGINAL_BIO_DESTINATION:      NOT_EVALUATED
  ORIGINAL_SCHOOL_DESTINATION:   NOT_EVALUATED
  ```

### ⭐ 审核 54 新指出的问题（我原本没发现）

```
现象：MeScreen 五个入口**全部** navigate('profile-edit')，也没有证据支持
处置：
  「编辑资料」→ ProfileEditScreen   [MATCH, baseline-supported]
  另外四项 → **不得**继续错误地进入 ProfileEditScreen
          → 不要把它们接到那五个旧 mock route
          → 保留 MeScreen 已有条目本身，但当前目的地显式记为 NOT_EVALUATED / DEFERRED
          → **不能再假装"我的兴趣 = 改昵称页面"**
新增 Gate：PROFILE_EDIT_ENTRY_CORRECT
          PROFILE_AUX_ENTRIES_NOT_MISROUTED_TO_PROFILE_EDIT
```

### `12,486`

随 fabricated route 删除而消失即可。**不要**把"仓库里任何地方存在字符串 12,486"当 Gate ——
`mock.ts` 仍可能服务尚未治理的页面。**应该检查可执行/可呈现 surface，而不是全仓字符串绝迹。**

### 那条"结构按原版实测"必须降级

```
ORIGINAL_PROFILE_EDIT_ENTRY:          SUPPORTED by trident-me baseline
ORIGINAL_PROFILE_EDIT_PAGE_STRUCTURE: NOT_EVALUATED
Current layout: OUR CURRENT IMPLEMENTATION / not a conformance claim
```
审核 54：**没有**另一份可用于补证的观察记录 → **不要为了保住注释去推断存在过证据**。

### PowerShell 教训的推广（并入既有 CHECK TARGET VALIDITY）

> **零命中只有在搜索范围本身被证明完整之后才有证据价值。**
> 以后"仓库不存在 X"最好同时记录实际遍历范围/文件数，
> 而不是单凭一个可能不递归的命令返回空集。

### 严重度

```
PROFILE_EDIT_FAKE_SAVE: HIGH / M5 BLOCKING
```
（也可作为 M5 acceptance P0：不是因为系统宕机或数据损坏，
而是因为它从真实入口一步可达，并**明确向用户谎报"持久写入已经成功"**。）

## 三、本轮我自己额外查出并确认的两个问题（审核 54 未涉及）

### ① ⭐ 长期"未定位"间歇性失败的**机制已确认**

```
06:49:54 Started
06:50:47 [uploads] tmp 目录就绪        ← 53s
06:51:05 [listen] :3001                ← 71s
06:51:21~06:52:43 [migrate] retryable: database unreachable  ×7
06:52:50 [health] ready: false -> true ← **176s** 才就绪
```
资源实测：free 仅 **8MB**、swap 用 183MB、**loadavg 3.27**（2 vCPU）、
**PostgreSQL max_connections 仅 15**（used 10 / reserved 3）
→ **重启后约 3 分钟不可服务**；M5 gate 的 `verify-tmp-selfheal.sh` 会重启后端而**只等 5 秒**
（30s 轮询也不够）→ 后续要登录的段偶发失败，**单独跑同一脚本却 PASS**。
时间线吻合：05:16:26 重启 → 约 05:19:2x 才就绪 → 05:19:37 的失败正落在这个窗口内。

**修正**：就绪轮询 30s → 240s；并把 `deploy-server.ps1` 从等 `/api/health`（liveness）
改为等 `/api/ready`（readiness）—— 原来它会在**还没就绪时**就报"就绪耗时 Ns"并继续。

⚠️ 边界：**机制**已确认；**具体那一次**未逐帧重放。

### ② ⭐ 设备级 E2E 抓到服务端脚本**永远测不出**的缺陷：CORS 缺 PATCH

```
服务端 CORS: access-control-allow-methods: 'GET,POST,OPTIONS'   ← 缺 PATCH
后果：PATCH 带 content-type/authorization → 触发 CORS 预检(OPTIONS)
      → 预检未列 PATCH → 预检失败 → fetch 报 "Failed to fetch"
      → 设备上保存 **100% 失败**，而服务端脚本全 PASS
```
**为什么服务端脚本测不出**：curl/psql **不带 CORS 语义、根本不发预检**。
→ 这是"真机验证"纪律的价值：**同一条路径，服务端 PASS ≠ 客户端可用**。
已修，并在 `verify-wo13-patch-me.sh` 里**新增预检断言**。
教训：**每新增一个 HTTP 方法，都要同步检查 CORS 的 allow-methods**。

## 四、待审核裁定（本单之后）

```
① ⚠️ **【已被审核 55 更正，我原来的断言不成立】**
   我原先写的是"服务器资源是**根因层**问题（396MB 内存 + PG max_connections=15）"。
   审核 55 明确驳回：free / swap / loadavg / max_connections 只能说明资源预算**紧张**，
   **不足以单独证明** 176 秒冷启动的根因；而且在只有约 396MB RAM 的机器上
   贸然提高 `max_connections` **反而可能加剧内存压力**。
   裁定：**DO NOT** blindly raise max_connections / add more swap as "the fix"；
   改为**单独立案**做 cold-start / resource pressure 调查（见 §二）。
   已确认的只是**机制**：重启后 readiness 可能约 176s 为 false，
   在 `/api/ready=200` 之前放行流量就会失败（固定等待、只看 liveness 的等待都无效）。
   详见 `docs/pending/review-log/55-wo13-closed-and-three-methodology-corrections.md` §二。
   本轮只修了"等待策略"，未改 PG 配置或扩容 —— 属运维决策，请裁定是否调整。
② MeScreen 自身仍显示 mock 的 me.name / me.avatar（与 WO#13 同类的"身份来自 mock"），
   但不在 WO#13 批准范围内 → 是否单开一单？
```
