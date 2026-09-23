# Review 70：WO#25 网页端发布 —— 裁定 PASS / CLOSED

> 审核方：远端 GPT（会话 `审核M1设计`）
> 提交时间：2026-09-24 02:35（提交内容共 3476 字符）
> 裁定时间：2026-09-24 02:55（本次落盘）
> 提交方式：Playwright 驱动网页版 ChatGPT；裁定经读取会话末尾消息取得

## 一、原始裁定（逐字摘录）

```
一条很关键： FAIL ≠ 断言有判别力 必须进一步确认：
  页面确实加载 AND 被测目标正确 AND 失败的是预期 defect
所以你现在要求：
  not readiness fallback + ON_WEB_ORIGIN=true + exact expected defect signal
才算 mutation 成功，是正确的。
而且从线上首页测试迁到独立零风险子路径也是必要修正。
以后不要再为了证明 Gate 的判别力直接破坏公开生产入口。
到这里停止，不需要继续发展新的 sensitivity framework。

最终裁定
  WO25_WEB_RELEASE: PASS / CLOSED
  LAYOUT: (c) KEEP
  WEB_GATE_NOT_APPLICABLE_POLICY: APPROVED
  IOS_SAFARI: KNOWN UNVALIDATED PLATFORM NON-BLOCKING
  REMAINING RELEASE WORK: ≠ WO25

现在 Web 已经可以视为一个正式部署目标，而不是"Android WebView 顺便能在浏览器打开"。
后续如果继续 Release 工作，应该进入发布/运维/视觉设计 backlog，
不要再把 WO#25 横向扩成桌面重设计或全浏览器兼容工程。
```

## 二、裁定逐条落实

| 裁定项 | 结论 | 我的落实 |
|---|---|---|
| `WO25_WEB_RELEASE` | **PASS / CLOSED** | 网页端视为**正式部署目标**；WO#25 关闭 |
| `LAYOUT` | **(c) KEEP** | 保持现状：手机浏览器满屏、宽屏（`pointer:fine`）套手机壳。**不需要改代码**（该行为早已存在）。已把"待裁定"从队列移除 |
| `WEB_GATE_NOT_APPLICABLE_POLICY` | **APPROVED** | "不适用项显式登记 + 写明理由、不删门禁"的口径获批准，继续沿用 |
| `IOS_SAFARI` | **KNOWN UNVALIDATED PLATFORM / NON-BLOCKING** | 保持 `NOT_EVALUATED`，作为**已知未验证平台**登记，**不阻塞**；**不声称已支持 iOS** |
| `REMAINING RELEASE WORK` | **≠ WO#25** | 后续 Release（发布/运维/视觉）**另开**工作单，不再横向扩展 WO#25 |

## 三、审核方给的两条方法性指导（已照做）

### 3.1 「FAIL ≠ 断言有判别力」（这条最关键）
审核方指出的问题正中要害：**门禁变红本身不构成"有判别力"的证据**，必须同时确认
① 页面确实加载了、② 被测目标正确、③ 失败的**是预期的那个缺陷**。

⭐ 我照此把敏感度汇总从"是否含某个 false"升级为**三重同时成立**：
```
① 注入后**不能**是「未就绪」兜底（否则红的原因不是被测缺陷）
② ON_WEB_ORIGIN == true（页面确实加载 ⇒ 排除"页面没打开"这类假红）
③ 出现**预期缺陷的特征**（mount: ROOT_ELEMENT_PRESENT=false；
   clean: NO_FAILED_STATIC_RESOURCES=false；login: LOGINSELECT_SCREEN_PRESENT=false）
```
⚠️ 这条指导**直接命中了我犯过的错**：我的敏感度汇总第一版正因为只看一个 `false`
而把"MSYS 路径转换导致导航到垃圾 URL ⇒ 未就绪"误判成"变红=有判别力"，**假通过**。

### 3.2 「不要为了证明 Gate 的判别力直接破坏公开生产入口」
审核方明确要求：以后**不得**为了让门禁变红而去动**公开生产入口**。

⭐ 我照此把注入方式改为**零风险子路径**（`/web-broken/`、`/load-broken/`，
通过门禁新增的 `WEB_ENTRY_PATH` 参数指向），**完全不碰线上首页**。
⚠️ 这条指导同样命中我的实际错误：第一版敏感度测试**真的替换了线上首页**，
把站点搞坏了一次（还原还依赖了一个已被污染的备份文件）。

### 3.3 「到这里停止，不需要继续发展新的 sensitivity framework」
⇒ **不再扩展**敏感度框架。现有能力（3 个网页端专属门禁 + 三重判据 + 零风险注入）已够用。

## 四、审核方未要求修改、但我在同一轮自查发现并已修的问题

（如实记录：这些**不是**审核方指出的，是我自己覆盖率核对与自查发现的）

1. **登录流程无门禁覆盖**（覆盖率核对发现）：路由清单里 `login`/`loginselect`
   一个门禁都没有，而登录是网页端第一道功能。⇒ 新增 `gate-web-login.mjs`
   （用 CDP `Fetch` 域拦截 `/api/auth/request-code`，**零短信成本**验证真实调用链）。
2. **"否定式"断言可空虚通过**：`LOGINSELECT_REQUIRES_AGREEMENT`（"**没有**跳到 #/login"）
   在"页面整个坏掉、什么都没发生"时**天然为真** ⇒ 敏感度验证里它仍为 true。
   ⇒ 新增**前置断言**（界面确实存在）并让其依赖前置成立。
3. **测试状态没重置 ⇒ 测错东西**：`Page.navigate` 到同源同路径只改 hash、不重新加载，
   导致应用状态是上一场景的残留（"已发送/倒计时"），后续断言量的不是目标场景。
   ⇒ 新增 `freshLoad()` 强制硬重载。
4. **断言固化我自己的偏好**：`SUBMIT_DISABLED_FOR_INVALID_PHONE` 假定"非法号码必须禁用按钮"，
   但"客户端只校验非空、格式交给服务端并如实呈现"同样是合理设计。
   ⇒ 改为行为判据 `INVALID_PHONE_IS_HANDLED_HONESTLY`（要么不可用、要么真调接口且如实报错）。

## 五、本工作单的最终交付状态

- 网页端地址：**https://8.148.156.146/**（Let's Encrypt **IP 证书**，公共信任，浏览器无警告）
- 门禁结果：`WEB_AUDIT: TOTAL=31 PASS=31 FAIL=0 SKIPPED=1`（WO#25 关闭时）
- 部署：**原子切换**（`ATOMIC_DEPLOY: PASS`，部署期间 60 次采样 0 失败 + build-id 哨兵）
- 敏感度：3 个网页端专属门禁均通过三重判据的敏感度验证
- 文档：`docs/WEB-FRONTEND.md`、`docs/TLS-IP-CERTIFICATE.md`

## 六、遗留（均为已登记的已知项，不影响 WO#25 关闭）

- **iOS Safari**：`NOT_EVALUATED`（无 iPhone 真机可测）—— 裁定为 NON-BLOCKING，**不声称已支持**
- **外部告警通道未接**（证书监控）：无邮件通道；短信赠送模板全是验证码模板，发不了任意告警文本。
  `TLS_ALERT_WEBHOOK` 已实现但未配置。
- 后续 Release 工作（发布/运维/视觉设计）**另开工作单**，不再扩展 WO#25。
