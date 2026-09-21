# M3 Final Gate 报告

> 依据：审核记录 12（`M3 Slice 4 — CLOSED` / `M3 Final Gate — GO`，
> 并批准 Final Gate 前做"非零距离 canonical seed"与"定向清理测试残留"两件事）
> 完成时间：2026-09-21（Asia/Shanghai）
> 跑法：`scripts/gates/m3/slice0b.ps1` 在当前 **HEAD** 上全量重跑

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

**两层记账并存**（这一版新加的）：slice 回答"哪个切片过了"，
layer 回答"**哪一类保证**还成立"。两者都需要 —— 只报 slice 会看不出
"M3 的切片都过了、但 M1 的某个不变量已经坏了"这种情况。

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
| 模型验证（`docs/m3/MODEL-VALIDATION.md`） | `login-sns` SUPPORTED；`places` SUPPORTED；`schools` SUPPORTED（需校区子实体，已改）；`comments.parent_id` MODEL SUPPORTED / PRESENTATION EXPANDED；`message`/`group` 关系部分完成（`board_notes` 待观察） |
| 政策 | 违规如实登记并已排除出一致性依据；`BLOCKED_BY_POLICY` 与 `BLOCKED_BY_ETHICS` 成为常设判定标签 |

## 五、遗留项（明确不隐藏）

1. **`board_notes` 的真实关系**仍未观察 → 后续需要时按只读取证。
2. **`OTP_UI_VISUAL_CONFORMANCE`** = NOT_EVALUATED（BLOCKED_BY_ETHICS）：
   验证码页无原版证据，不声称与原件一致。
3. **`at-panel` / `media-preview` 的视觉一致性** = NOT_EVALUATED
   （CONFORMANCE_EVIDENCE_INADMISSIBLE）：功能可用、页面 ACCEPTED，但不作一致性声明。
4. **媒体上传/图片**属 M4：当前动态图片用作者头像色块占位，图片内容层面不声称一致。
5. **`距我N公里` 的参照点**是校区坐标（demo 不申请定位权限），与原版真实定位不同 —— 已记为偏差。

## 六、证据

| 文件 | 内容 |
|---|---|
| `docs/m3/evidence/final-gate-*.txt` | 本次 Final Gate 全量输出（三层 + 六个 slice key） |
| `docs/m3/evidence/cleanup-*.txt` | 定向清理与自检 |
| `docs/m3/evidence/places-*.txt`、`comments-*.txt`、`likes-*.txt`、`publish-*.txt`、`device-publish-*.txt` | 各切片断言 |
| `scripts/m3/cleanup-test-residue.sh` | 定向清理脚本（含"canonical 未变"自检） |
