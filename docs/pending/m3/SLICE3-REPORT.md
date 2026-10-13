# M3 Slice 3 报告：登录后发帖（作者只能来自会话）

> 依据：审核记录 10（`M3 Slice 3: APPROVED TO START` 及其工作单）
> 完成时间：2026-09-21（Asia/Shanghai）
> Gate：`scripts/gates/m3/slice0b.ps1` 第 6.7 组 → **M3_SLICE3_GATE_RESULT: PASS**

## 一、结论

```
M3_PRECONDITION_RESULT: PASS
M3_SLICE0B_GATE_RESULT: PASS
M3_SLICE1_GATE_RESULT:  PASS
M3_SLICE2_GATE_RESULT:  PASS
M3_SLICE3_GATE_RESULT:  PASS
  AUTHOR_FROM_SESSION_ONLY:    PASS（author_id == 会话用户 id）
  AUTHOR_INJECTION_REJECTED:   PASS（author / authorId / author_id / user_id → 400 且不产生行）
  UNAUTH_PUBLISH_REJECTED:     PASS（401 且不产生行）
  PUBLISH_SURVIVES_RESTART:    PASS（后端重启 + App 重启后仍存在）
  NO_SESSION_FIXTURE:          PASS（设备端走真实 OTP 登录闭环）
  ORIGINAL_PUBLISH_TRANSITION: BLOCKED_BY_POLICY（原版发布=写操作，禁止取证）

后端 PUBLISH_RESULT PASS（26 条断言）；设备端 DEVICE_PUBLISH_RESULT PASS
```

## 二、按审核工作单逐条对照

| 审核要求 | 落实 | 证据 |
|---|---|---|
| 真实手机号 OTP 登录 | 设备端走真实 UI 登录（个人页入口 → 协议弹窗 → 手机号页 → dev sink 取码 → 输入 → 登录） | `DEVICE_PUBLISH_RESULT PASS` 第 1 步 |
| **无 session 夹具** | 全程不注入会话；且 App 内读到的身份与 helper 返回一致 | 第 1 步两条 PASS |
| PublishScreen | 走真实 UI：**先切「文字」模式**（编辑器是条件渲染的）→ 输入 → 点发布 | 第 2 步 |
| 请求体不含 author/authorId | 客户端 `createPost({body, place})` 只有这两个字段 | 代码 + 第 3 步 |
| backend 从 session 解析 author_id | 库中 `author_id` == 会话用户 id、`author_name` == 会话展示名 | 第 3 步两条 PASS |
| 写 PG → 返回校园页 | 发帖后自动回 `#/campus`，信息流出现新帖 | 第 2/4 步 |
| UI 作者与登录身份一致 | 信息流里的作者名 == 登录身份 | 第 4 步 |
| App 重启后仍存在 | **重启 App 后新帖仍在**（会话也未丢） | 第 5 步 |
| **攻击用例**：手工塞 author/authorId → strict 400 且 DB 不能产生行 | 四种写法（`author`/`authorId`/`author_id`/`user_id`）全部 400；**行数未变**；库中不存在伪造作者名的行 | 后端第 1 节（12 条断言） |
| 原版侧只读取证 | 未在原版发布任何内容；发布后的反馈/跳转/动画记 `BLOCKED_BY_POLICY` | 报告 + Gate 输出 |

后端另加：未登录发帖 401 且不产生行；空正文 400；超长（501 字）400；
**后端重启后**详情仍可读且归属一致（持久化）。

## 三、工程要求：抽成共享 helper（审核点名）

审核原话（要点）：不要整段复用 `verify-device-login.ps1`，它带 logout/cleanup 等
Slice 0B 验收副作用，会让两个 Gate 因测试流程互相耦合。

落实：

- `scripts/m3/device-login-helper.ps1` 新增 **`Reset-DeviceToLoggedOut`**（共享的"重置到未登录"）
- **Slice 0B 的 `verify-device-login.ps1` 改为 dot-source 该 helper**，两边用同一套冷启动逻辑
- helper 对外：`Connect-DeviceLoggedIn` / `Reset-DeviceToLoggedOut` / `Connect-DeviceCdp` /
  `Restart-DeviceApp` / `Disconnect-Device`
- helper **刻意不带验收副作用**（不 logout、不清理账号）；
  使用方各自清理自己的测试账号（本 slice 的编排脚本负责删帖 + 删账号 + 清 dev sink）

## 四、本轮修掉的四个问题（每个都会伪装成"功能坏了"）

### 1. 冷启动没有复位路由（GATE_DEFECT）

`coldreset` 的页面 reload **会保留当前 hash**。上一组用例把 App 留在 `#/loginselect`，
reload 后仍停在登录页 → 后续报「找不到底部导航」，看起来像 App 坏了。
修法：reload 前先 `location.hash = '#/campus'`。**跨用例的状态泄漏**。

### 2. 认证脚本 D2 用固定手机号（GATE_DEFECT）

服务端按 (IP, 手机号) 对发码限流 5 次/300s；反复跑同一个号会在某次运行里踩 429，
表现成「新号码未创建账号」这种完全看不出原因的失败。
修法：改用随机号，并**把 verify 的状态码与响应打出来** —— 失败要能自证原因。

### 3. Gate 归因错误（GATE_DEFECT / 归因）

M0 基线完整性 + 工作区清洁度属于**审计前置**，却被算进 `M3_SLICE0B_GATE_RESULT`，
导致"工作区是否已提交"能让 Slice 0B 的结论在 PASS/FAIL 之间翻转 ——
那不是阶段结论，而是跑 Gate 时的仓库状态。
修法：新增 `PRE` 桶，输出独立的 `M3_PRECONDITION_RESULT`。

### 4. 嵌套 powershell 的 stderr 会打断 Gate（GATE_DEFECT）

与 adb/ssh 同类：`ErrorActionPreference='Stop'` 下外部程序的 stderr 被当成终止错误。
修法：统一封装 `Invoke-SubPowerShell`。

> 这四条有一个共同点：**都不是产品逻辑错，而是"测试/门禁自身"的问题**，
> 但它们的表象全都是"产品功能没实现"。这正是为什么 Gate 抓到的失败必须先分类
> （PRODUCT / GATE / ENVIRONMENT / EXTERNAL），否则会把时间花在错误的方向上。

## 五、原版侧的政策边界

发布是写操作 → 在原版上发布、以及观察"发布成功后的反馈/跳转/动画"全部禁止，
记为 `BLOCKED_BY_POLICY`。本 slice **不声称**发布交互与原版 1:1 一致；
只声称"在我们自己的系统里，作者归属与持久性是被机械验证过的"。

（原版发布页的**只读**结构在 Slice 1 已顺带取得：`PostActivity` 的关闭/地点标题/
相册/翻转摄像头/底部三选 语音·拍摄·文字 —— 那部分可作为实现参照。）

## 六、证据

| 文件 | 内容 |
|---|---|
| `docs/pending/m3/evidence/publish-*.txt` | 后端 26 条断言（含攻击用例） |
| `docs/pending/m3/evidence/device-publish-*.txt` | 设备端闭环输出 |
| `docs/pending/m3/evidence/gate-slice3-*.txt` | 完整 Gate（四个 slice key + PRE 全绿） |
| `scripts/m3/verify-publish.sh` | 后端断言脚本 |
| `scripts/m3/device-slice3.mjs` + `verify-device-publish.ps1` | 设备端驱动与编排 |
| `scripts/m3/device-login-helper.ps1` | 共享登录 helper（含 Reset-DeviceToLoggedOut） |
