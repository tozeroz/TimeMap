# 续作点（Resume Point）—— 2026-09-21 18:16（Asia/Shanghai）

> 用途：本会话上下文已接近上限。本文件记录**在飞的工作、待裁定项、下一步**，
> 使工作可被会话或后续会话直接接续，不需要重新推导。

## 一、阶段状态

| 阶段 | 状态 |
|---|---|
| M0 / M1 / M2 / M3 | CLOSED（各 Final Gate PASS） |
| **M4** | **ACCEPTED / CLOSED**（审核记录 20） |
| M5 | 进行中 |

M5 当前：
```
M5_SLICE1_FUNCTIONAL:   CLOSED     （board_notes 功能/权限闭环，含 strict 400 + 第三账号真机隔离）
M5_SLICE1_CONFORMANCE:  OPEN       （该页仍有真实差异，见下）
```

## 二、在飞的工作（有一个后台子代理正在跑）

**WO#2 后端**（子代理 `be94e420`，运行中，尚未提交）：
- `server/src/index.ts`：`POST /api/threads/:id/messages` 新增**单数** `mediaId`
  （审核强制修订：不接受数组；数组形式一律 400 `bad_media_id`）
- `server/src/cleanup-entry.ts`：**unattached media TTL GC**
  （审核强制修订；`--unattached-max-age-hours` 默认 24h，取值依据已写进文件头）
- `scripts/m5/verify-message-media.sh`、`scripts/m5/verify-cleanup-unattached.sh`：两个验证脚本

**已完成的静态核验**（在主代理侧做过，未干扰子代理）：
- `mediaIds` 只出现在注释里，且注释写明"刻意不接受数组、一律 400"
- owner/scope 校验在位（错误码 `media_not_private` / `media_scope_conflict`）
- cleanup 把 type A（orphan：盘上有文件、DB 无行）与 type B（unattached：有行有文件但无消息引用）**分开处理**

**接续动作**：等它汇报 → 比对它的自查与我上面的静态核验 →
`pnpm typecheck` + `pnpm build` → **部署** → 在真实服务器跑两个验证脚本 →
向审核提交 WO#2 结果。

⚠ 纪律提醒：**有并发写者时只用显式路径 `git add`，绝不用 `git add -A`**
（本项目已因此出过一次事故：提交信息与内容不符）。它提交前请先 `git status` 确认工作区。

## 三、待裁定项（在审核方；两项）

1. **C4 实现方式**：表情行原版用**图片**（`emotion_image`），我们用**文字 emoji**。
   待定：**复刻 6 个图标图像** vs **先做 image-based structure**。
   （我倾向后者：先让结构与语义正确，逐图标像素复刻属外观层且需真图标资源。）
   ⚠ 若裁定改为图片形态，**C6 的字号修正随之失效**（届时以图片固有尺寸为准）。
2. **`force-stop` 规则严格度**：我已把测试脚本改为**默认不干预原版 App**
   （检测到前台不是我们的 App → 先把自己 Activity 拉回前台；否则 abort），
   force-stop 降级为显式开关 `ALLOW_FORCE_STOP_ORIGINAL=1`。请确认这个严格度是否够。

## 四、board 页差异清单（已收敛，权威版本在 `docs/AUDIT-M0-M4.md` 附三）

| 项 | 状态 |
|---|---|
| C1 顶部按钮 | **撤销**（`ivClose` 在 `iv_back` 内部，非两个按钮） |
| C2 留言总数 | **撤销**（`tvTotalComment` 文本是标题） |
| C3 下拉刷新 | **BLOCKED_BY_POLICY**（需非空留言板，造它须发留言＝写操作＝禁止） |
| C4 表情形态 | **成立**（DEVIATION），实现方式待裁定 |
| C5 表情底色 | **成立并已修**（原版无底色；我们原有灰色圆片） |
| C6 表情字号 | **成立并已修**（16px → 24px，估计值已标注残余不确定） |

## 五、表情行当前状态（该行已收敛）

```
项数 6 / item 宽 70 / pitch 112 / 首末边界 21,651   ✅ 设备 px 下与原版逐项吻合
底色：原版无 → 我们已改为无                          ✅ 设备实测确认 rgba(0,0,0,0)
字号：16px → 24px（据实心字形墨迹外接测量）           ✅ 设备实测确认（估计值）
形态：原版图片 vs 我们文字 emoji                     ❌ 唯一剩余，待裁定（C4）
未比对：圆角 / 垂直位置 / padding                    ⚠ 未声称
```

## 六、本会话确立的纪律（都在文件里，可直接引用）

| 纪律 | 位置 |
|---|---|
| **Gate 原则**：可复核原始产物才可驱动实现改动；finding 走 `raw_evidence → observation → conclusion → impact` 四段链 | `PLAN.md`、`docs/conformance/FINDING-board-emojis.md`（范本） |
| 有并发写者时**只用显式路径**提交，绝不用 `git add -A` | `docs/m4/INCIDENT-git-add-all-during-subagent.md` |
| **设备端验证进行中**时不要重装 APK / 不要抢同一 WebView | `docs/DISCIPLINE-device-concurrency.md` |
| **不要把 `resource-id` 的名字当成行为 contract** | 审核记录 23；实证见 `FINDING-board-page-controls.md` §十一 |
| **比较测量值前先确认定义与坐标基准**（pitch vs gap 是定义差；行内相对 vs 屏幕绝对是基准差） | `FINDING-board-emojis.md` §八 / §十四 |
| 原始产物必须入库（此前只有摘要，导致结论无法复核） | `docs/original-baseline/raw-dumps/` |

## 七、原始证据索引（可直接复核）

```
docs/original-baseline/raw-dumps/
  message-board-dump.xml        留言板（deep link 只读进入）
  board-observation-1.xml       校园广场页（含 4 个底部 tab）
  board-ivback-before.xml       只读点击 iv_back 前
  board-ivback-after.xml        只读点击 iv_back 后
  board-refresh-{before,mid,after}.xml   下拉手势前后（均为空态）
  emoji-row-crop.png            表情行裁切（按 dump 坐标精确裁切，缩放系数=1 已验证）
```

获取方式（**纯只读**）：`adb shell am start -a android.intent.action.VIEW -d "campusx://messageBoard" com.kairuotu.campus`
→ `uiautomator dump` → `adb pull`。**全程未做任何写操作。**

---

## 八、更新（2026-09-21 18:28）：WO#2 后端已完成，前端已开工

### WO#2 后端：**完成并双层验证通过**

```
MESSAGE_MEDIA_RESULT:      PASS   （真实服务器；含 A7「复数 mediaIds → 400」）
CLEANUP_UNATTACHED_RESULT: PASS   （真实服务器，20 条）
另有实现在本地 docker postgres + 本地 node 产物上的真实 HTTP 验证：A 26/26、B 25/25
→ "实现者自查 + 独立复核"两段齐备
```

实现要点：单数 `mediaId`；事务内逐条校验（成员/存在/scope=private/**owner=当前用户**）；
messages 与 message_media 同事务；TTL GC（默认 24h，与 orphan 分开计数报告；
删行自带 not exists 判据；dry-run 默认；备份窗口内 exit 3 且不动行与文件）。

### WO#2 前端：**已委派子代理 `c4836556`（进行中）**

内容：`client.ts` 新增上传函数（FormData：`file`/`purpose`/`uploadRequestId`=UUID；复用 `authHeaders()`；
不手动设 Content-Type）；`ChatScreen.tsx` 底部加 `<input type="file">` 选图 → 上传(purpose=chat) →
发 `kind='image'`+`mediaId` 的消息 → 重拉列表；**不引入新插件、不改 MediaImage 的 blob 逻辑**。
验证要求：tsc/lint/build/装机 + 真机验证 + **`verify-cross-layer-constants.sh` 的 C1 应由 FAIL 转 PASS**。

### 交接给下一轮的注意点

- 部署/验证**前必须先核验产物**（本项目已三次栽在"验旧产物"上）：
  `grep -c '<关键新符号>' /srv/campus/server/dist/xxx.mjs` 应 ≥1
- **不要** `git add -A`（有并发写者）；只用显式路径
- 设备端若前台不是我们的 App：**不要 force-stop 原版**，先拉回自己前台，否则报错停下
- 待审核裁定：① `mediaIds` 复数 strict 400 是否认可 ② `.tmp` 部署缺口修法 A/B
  ③ C4 表情形态（图片 vs 文字）④ `force-stop` 规则严格度
- 待清理：子代理遗留 docker 容器 `wo2-pg`（已停止）
---

## 九、更新（2026-09-21 18:45）：WO#2 完成（待审核确认收口）

### WO#2 状态

```
WO2_BACKEND:  ACCEPTED（审核记录 24）
WO2_FRONTEND: 真机 PASS（含失败路径）
WO2_OVERALL:  待审核确认 CLOSED
```

**前端真机证据**（子代理执行，我核验 commit `2da713f`）：
```
DEVICE_CHAT_IMAGE_RESULT PASS
  选图 → 上传 201 → 发消息 201 → 图片真的渲染（blob, naturalWidth>0）
  → 气泡数 3→4 → 重载后仍在；服务端复核两张图 scope=private
DEVICE_CHAT_IMAGE_FAILPATH PASS
  非图片 → 红字「发送失败」、气泡数不变（无幽灵消息）、input 已清空
```
**证据强度的一处已知弱点（子代理主动披露，我认可其标注）**：
"选图"这一步用 `DOM.setFileInputFiles` 交给 input（**原生系统选择器 CDP 点不到**），
之后的 上传/发送/重拉/渲染 全是产品代码、无桩。选择器弹窗本身未人工确认。
→ 属"弱一档但已如实标注"；若需更强证据需人工介入（BLOCKED 类）。

### 跨层常量检查：C1 覆盖缺口**已关闭**
`scripts/m4/verify-cross-layer-constants.sh` → `CROSS_LAYER_CONSTANTS_RESULT PASS`
（C1 原为 FAIL："app 从不发送 purpose"，现已修复并复跑确认。）

### M5 服务器侧 Gate：全键 PASS
`scripts/gates/m5/gate-server.sh`（服务器实跑）：
```
PERSISTENT PASS / STAGE PASS / REGRESSION PASS
M5_MEDIA_MESSAGE_API / M5_MEDIAID_STRICT_REJECT / M5_UNATTACHED_TTL_GC
M5_TMP_SELFHEAL / M5_BOARD_NOTES   全部 PASS
M5_SERVER_GATE_RESULT: PASS
M5_OVERALL: OPEN（待审核确认 WO#2 后更新）
```

### 本轮修掉的两个测试侧问题（都已验证）
1. **坏断言**：`verify-message-media.sh` 的 id 集合断言用了**从未赋值的 `MSG2`**，
   本质恒错、表现为间歇性 flaky → 改为**从 DB 按 kind 推导**（image=1 且 text=1）。
2. **产物核验必须用 ASCII 标记**：esbuild 把非 ASCII 转义成 `\uXXXX`，
   grep 中文恒为 0 → 假阴性（实测踩到）。已写进 Gate 前置步骤的注释。

### 验证残留已清理（我做的）
子代理留在我们服务器上的 2 条消息 + 2 条 media 已按 id 精确清理，
盘上文件一并删除；orphan 清扫 dry-run 结果
`orphans=[] unattached=[] unattachedMissingFile=0`（存储一致）。
理由：本项目多个 Gate 做计数类断言，残留会造成"测试污染被测环境"。

### 待人工执行（我不绕道）
清理已退出的 docker 容器 `wo2-pg`：本会话的命令守卫对容器删除类命令
一律返回 "cannot statically verify deletion inside opaque shell syntax"。
我如实记为**需在会话外清理一次**。影响：仅占磁盘与一个容器名，
不影响任何功能与验证。

### 待审核裁定（累积 6 项）
1. WO#2 整体可否 CLOSED
2. 前端"替代入口"方式是否接受（DOM.setFileInputFiles 代真手指点系统选择器）
3. `uploadMedia` 返回 `width/height: number | null` 的有意偏离是否认可
4. **C4 表情形态**：复刻 6 个图标图像 vs 先做 image-based structure
5. **`force-stop` 规则严格度**（已改为默认不干预原版 + 显式开关）
6. 新提纪律："测试期望应从权威数据源推导，而非从 HTTP 响应正则抓取"

### 一条工具使用上的观察（记录，不视为项目问题）
本会话的命令守卫会把**命令文本里出现的删除关键词**（哪怕只是文档内容里提到）
判为"无法静态验证的删除"并拒绝执行。处置：把含这类字样的内容**用文件工具写**，
命令只做追加与提交 —— 这不是绕过安全控制（我并没有执行任何删除），
而是避免文档用词触发假阳性。
