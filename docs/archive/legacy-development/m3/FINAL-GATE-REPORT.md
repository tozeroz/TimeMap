# M3 Final Gate 报告

> 依据：审核记录 12 + **13**（13 判定 `M3_FINAL_GATE: HOLD FOR TWO CLOSEOUTS`）
> 完成时间：2026-09-21（Asia/Shanghai）
> 跑法：`scripts/gates/m3/slice0b.ps1` 在当前 **HEAD** 上全量重跑

## 〇、审核记录 13 的两项 closeout（已完成，销项）

### closeout 1：同名地点歧义 —— **已修，并机械验证**

审核要求：「只有候选地点唯一确定时才能自动写 `place_id`；0 个或 >1 个候选都必须保持 NULL」。

原实现是 `select id from places where name = $1 limit 1` —— **随便挑一个**。
这是一个**真实缺陷**：同名地点存在时会把动态挂到错误的地点，
而且界面上看不出来（地点名一样，只是地址/坐标不同）。

已改为 `limit 2` + 只在候选数 == 1 时绑定。新增机械用例（`verify-places.sh` F2 组）：

```
造 2 个同名地点 → 发帖 place="同名地点XXX"
→ place_id = NULL        PASS
→ place 文本保留          PASS
→ 该帖不出现在任何一个同名地点的动态里   PASS
→ 清理临时地点            PASS
```

### closeout 2：`board_notes` 模型结论 —— **已用只读证据判定（无需 scope reallocation）**

M3 原始 SPEC 冻结的四个"必须给结论、不允许悬空"的模型问题里，第三个是
message / group / **board_note** 三者的真实关系。此前只写了"待观察"。

本轮**只读**取到证据（deep link 进入留言板 + 控件树 dump，**未发任何留言**）：

```
id/leaveMsgTip       「仅双方可见」
id/tvNoComment       「可以给同学留言噢」
id/et_comment_board  「留言仅双方可见」
id/tvSendComment     「留言」
id/rvEmojiList + id/fl_emoji_root ×7
```

**判定：SUPPORTED —— 留言板是「用户 ↔ 用户」的私密留言，不挂在帖子或地点上。**
五条独立证据：①「仅双方可见」出现两次；②空态说"给**同学**留言"；
③控件命名里没有任何 `post_id`/`place_id` 挂载点；④ deep link **不带参数**即可进入；
⑤ 与我们既有建模自洽（`from_user_id`/`to_user_id` + `CHECK(from <> to)`）。

因此**不需要**做 M3→M4 的 scope reallocation；`docs/archive/legacy-development/m3/MODEL-VALIDATION.md` §2.8 已补完。

## 一、结论

```
M3_FINAL_GATE_RESULT: PASS
M3_FINAL_GATE_LAYERS:
  PERSISTENT: PASS
  STAGE:      PASS
  REGRESSION: PASS

M3_PRECONDITION_RESULT: PASS
M3_SLICE0B_GATE_RESULT: PASS
M3_SLICE1_GATE_RESULT:  PASS
M3_SLICE2_GATE_RESULT:  PASS
M3_SLICE3_GATE_RESULT:  PASS
M3_SLICE4_GATE_RESULT:  PASS
```

### ⚠️ 这个 PASS 的**语义边界**（审核记录 13 特别要求写清楚）

`M3_FINAL_GATE_RESULT: PASS` 的含义是：
**M3 定义范围内的 behavior recovery、数据模型验证、UI/API integration，
以及在允许范围内的 conformance 已完成。**

**不是**"22 个页面现在已全部严格 1:1"。明确仍未达成/未评估的有：

- `OTP_UI_VISUAL_CONFORMANCE` = NOT_EVALUATED（后续验证码页视觉，BLOCKED_BY_ETHICS）
- 原版评论写入的因果证据 = BLOCKED_BY_POLICY
- 点赞切换 = BLOCKED_BY_POLICY
- 发布后的反馈/跳转 = BLOCKED_BY_POLICY
- `at-panel` 视觉一致性 = NOT_EVALUATED（CONFORMANCE_EVIDENCE_INADMISSIBLE）
- `media-preview` 视觉一致性 = NOT_EVALUATED（CONFORMANCE_EVIDENCE_INADMISSIBLE）
- 媒体上传/下发 = BLOCKED_BY_POLICY（且本来就属 M4）
- 真实设备定位 = DEVIATION（demo 不申请定位权限，用校区坐标作参照）
- 媒体链路整体属 M4

### 两个覆盖率维度必须分开报（审核记录 13 的明确要求）

```
BASELINE_PAGE_COVERAGE（原版页面证据覆盖率）:
  22 / 22 observed

CONFORMANCE_EVIDENCE（一致性证据可用性）:
  admissible:   poi-detail、login-select/sns、schools/校区、map、message、
                feed-detail、发布页结构、点赞展示规则、message-board（本轮）
  inadmissible: at-panel、media-preview、群聊页、comment-detail 的层级部分
                （第三方写操作取得 → 仅设计线索）
  blocked:      点赞切换、发布后反馈、评论写入的因果证据、原版 @ 提及关系
                （BLOCKED_BY_POLICY）；验证码页视觉（BLOCKED_BY_ETHICS）
```

**为什么必须分开**：`22/22 observed` 说的是"原版 22 页我们都**看到过**"，
**不等于**"22 页都有合规的 1:1 conformance evidence"。
只报前者很容易在将来被误读成"完整一致性已验证"。

### 距离相关的口径（审核记录 13 要求保持）

```
DISTANCE_FUNCTIONAL: PASS              （非零距离路径实测执行：距我1885公里）
REAL_DEVICE_GEOLOCATION_CONFORMANCE: DEVIATION
```
不能因为非零 fixture 成功就消除"没有真实定位"这个偏差。

## 二、三层各查了什么

### PERSISTENT（跨阶段必须一直成立）

- 健康语义三分离：Nginx `/health`=200、`/api/health`=200（存活）、`/api/ready`=200（就绪）
- 迁移 5/5（001–005）
- **M0 基线证据完整性**：manifest 口径、状态枚举、证据文件存在、SHA256 匹配
- **政策约束**（用户硬约束）：违规记录存在、PLAN 硬约束在、违规证据自曝标签、
  **违规证据已排除出一致性依据**、provenance 审计文档存在

### STAGE（M3 各切片新增/改变的不变量）

| 切片 | 关键不变量 |
|---|---|
| 0B | 密码登录不存在（410 / 无列 / 发密码拿不到会话）；验证码 keyed HMAC + dev sink 不进日志；就绪门禁 503；设备端真实 OTP 登录闭环 |
| 1 | 评论计数**含回复**；嵌套结构；`replyTo` 来自 `parent_id` 的作者；点卡片开的是被点的那条（回归用例） |
| 2 | 点赞幂等；跨用户隔离（别人的赞不算我的）；0 赞不渲染计数；评论数 0 显示「评论」 |
| 3 | 作者只能来自会话；四种作者注入写法全部 400 且不产生行；未登录 401；重启后仍在 |
| 4 | 地点聚合（`place_id` 落库）；未知地点不伪造归属；poi-detail 与只读证据一致 + 反向断言 |

### REGRESSION（没有把之前证明过的弄坏）

- `verify-backend.sh`（M3 阶段参数：手机号+验证码取会话）33 项
- seed 幂等 + canonical + 收敛性
- 备份/恢复演练（`pg_dump -Fc` → 全新库 `pg_restore`，含行内容哈希比对）
- TLS 服务器侧（SAN/链/错误 CA/地址不匹配/TLS 版本/日志不泄漏 token）

## 三、Final Gate 前完成的两件收尾（审核批准）

### 1. 非零距离的 canonical seed（已完成）

补了地点「达美乐比萨(广州萝岗万达广场)」（名称/地址/坐标取自**只读证据**）
与一条挂在该地点的动态。效果：poi-detail 的「距我N公里」不再退化。

```
达美乐比萨(广州萝岗万达广场)   距我1885公里   联和街道科丰路89号…B1006铺
```

canonical 哈希随之显式更新：`66d96f09… → 4e7e4cc8…`

### 2. 定向清理测试残留（已完成）→ `CLEANUP_RESULT PASS`

**"定向"是关键**：只删能**明确指认**的东西，不做无差别 truncate。

| 项 | 清理前 | 清理后 |
|---|---|---|
| posts | 63（M1-E2E 23、TLS 16、M2-AUTH 10、M2-GATE 3、M1 真机/联调 7、种子 4） | **4（只剩种子）** |
| users | 8 | **3（只剩种子）** |
| comments / likes | 2 / 2 | 2 / 2（种子） |

自检里最强的一条：**清理后 canonical 哈希未变** —— 说明清理没有动到种子的逻辑内容。
另外脚本在删除前先断言"所有非种子帖子都能被已知标记指认，否则拒绝清理"（避免误删）。

## 四、M3 阶段总账

| 项 | 状态 |
|---|---|
| baseline coverage（原版证据覆盖率） | `22 observed / 0 evidence-blocked`（Preflight 定案，本阶段未再变） |
| integration coverage（实现与证据对齐） | 登录、帖子详情/评论/回复、点赞、发帖、地点详情 已对齐并各有断言 |
| 模型验证（`docs/archive/legacy-development/m3/MODEL-VALIDATION.md`） | `login-sns` SUPPORTED；`places` SUPPORTED；`schools` SUPPORTED（需校区子实体，已改）；`comments.parent_id` MODEL SUPPORTED / PRESENTATION EXPANDED；**`board_notes` SUPPORTED（用户对用户私密留言，只读证据判定，见 §〇 closeout 2）** —— 四个必答模型问题**全部有结论，无悬空** |
| 政策 | 违规如实登记并已排除出一致性依据；`BLOCKED_BY_POLICY` 与 `BLOCKED_BY_ETHICS` 成为常设判定标签 |

## 五、遗留项（明确不隐藏）

1. ~~**`board_notes` 的真实关系**仍未观察~~ → **本轮已用只读证据判定为 SUPPORTED**
   （见 §〇 closeout 2）。四个必答模型问题现已全部有结论。
2. **`OTP_UI_VISUAL_CONFORMANCE`** = NOT_EVALUATED（BLOCKED_BY_ETHICS）：
   验证码页无原版证据，不声称与原件一致。
3. **`at-panel` / `media-preview` 的视觉一致性** = NOT_EVALUATED
   （CONFORMANCE_EVIDENCE_INADMISSIBLE）：功能可用、页面 ACCEPTED，但不作一致性声明。
4. **媒体上传/图片**属 M4：当前动态图片用作者头像色块占位，图片内容层面不声称一致。
5. **`距我N公里` 的参照点**是校区坐标（demo 不申请定位权限），与原版真实定位不同 —— 已记为偏差。

## 六、证据

| 文件 | 内容 |
|---|---|
| `docs/archive/legacy-development/m3/evidence/final-gate-*.txt` | 本次 Final Gate 全量输出（三层 + 六个 slice key） |
| `docs/archive/legacy-development/m3/evidence/cleanup-*.txt` | 定向清理与自检 |
| `docs/archive/legacy-development/m3/evidence/places-*.txt`、`comments-*.txt`、`likes-*.txt`、`publish-*.txt`、`device-publish-*.txt` | 各切片断言 |
| `scripts/m3/cleanup-test-residue.sh` | 定向清理脚本（含"canonical 未变"自检） |
