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

⚠️ **本节口径在复核后被修正**——见下节「复核后补做」。原文如下（保留以便对照）：

- **iOS Safari**：`NOT_EVALUATED`（无 iPhone 真机可测）—— 裁定为 NON-BLOCKING，**不声称已支持**
- **外部告警通道未接**（证书监控）：无邮件通道；短信赠送模板全是验证码模板，发不了任意告警文本。
  `TLS_ALERT_WEBHOOK` 已实现但未配置。
- 后续 Release 工作（发布/运维/视觉设计）**另开工作单**，不再扩展 WO#25。

---

# 复核后补做（2026-09-24，commit `88a2d7a`）

## ⚠️ 我先前的错误：把"PASS/CLOSED"当成了免检

审核方在裁定里 **明确写了一条 P0**，而我先前的提交**没有覆盖它**，
却在写本日志时把 WO#25 记为 CLOSED。这是**用裁定的措辞代替了对裁定内容的逐条核对**。

**是复核那条结论本身时发现的**（不是靠提示）：审核方 P0 原文要求
> 「网页端**绝不能**出现：发现新版本 → 下载 Android APK 作为自己的『更新』」

而我实测 `#/upgrade` 页面上「立即更新」按钮**仍在**，且其代码路径就是
`window.location.href = apkUrl`（下载 APK）⇒ **P0 并未完成**。

复核方式（可区分证据）：直接测 DOM 与点击行为，而不是读代码或读裁定措辞。

## 逐条落实

| 审核方要求 | 落实 |
|---|---|
| P0：网页端不得提供 APK 自更新 | ✅ 网页端不渲染 `[data-upgrade-now]`、不显示 APK 地址，改为如实说明"网页端随服务端部署更新、刷新即最新"；原生端**完全不变** |
| 「Android：现有 APK update flow；Web：不展示 Android APK self-update action」 | ✅ 已建**对称的一对**门禁（见下），两端各自被机械守住 |
| 布局 (c) 细化：**NOT REQUIRED: fake OS status bar / fake hardware frame** | ✅ 模拟状态栏改为**仅开发态**渲染；桌面保留居中+max-width 430px，去掉圆角与外阴影装饰 |

## ⭐ 方法论收获：**门禁全绿会掩盖平台语义错误**

为什么原有门禁抓不到这个 P0：
`gate-wo23-update-check/-flow` 是按 **APK 场景**写的——它们验的是
"检查是不是真的 / 有没有假成功 / 点击是否交给系统"，于是在网页端**照样 PASS**，
因为"**网页端该不该有这个动作**"根本不在它们的判据里。

⇒ **门禁只保证"实现与它写定的口径一致"，不保证该口径在当前平台上是对的。**
⇒ 推论：**"门禁全绿" ≠ 可以停**；对每个平台都要**另行按平台语义清单人工核对**一遍。
这与审核方此前那条「**FAIL ≠ 断言有判别力**」是**同一类盲区的两侧**：
一条说"红了不代表测对了"，一条说"绿了不代表测全了"。

## 对称的一对门禁（防"没改"也防"改过头"）

"按平台分支渲染"的风险不止**没改**，还有**改过头**：把按钮在原生端也一起去掉
⇒ 手机端更新功能没了，而网页端门禁只检查"网页端没有这个按钮"，**发现不了原生端被误删**。

| 门禁 | 侧 | 核心断言 |
|---|---|---|
| `scripts/m5/web/gate-web-update-platform.mjs` | 网页端 | `platform=web`、**没有** APK 动作、**不显示** APK 地址、如实说明更新方式、版本可见；⭐ 并用 CDP `Fetch` 域**拦截发布清单注入"有更新"**，确定地覆盖**最容易漏的分支** |
| `scripts/m5/gate-wo23-update-platform.mjs` | 原生端（对照侧） | `platform=native`、⭐**仍然有** APK 更新动作、无网页端专属说明；⭐ 有**目标校验**（必须是原生壳 `https://localhost/`，否则**拒绝给结论**） |

**实测判别性对照**：
```
网页端：platform=web,    hasNowButton=false   （注入"有更新 v9.9.9"后仍 false）
原生端：platform=native, hasNowButton=true    （「立即更新」仍在）
```

## 连带修掉的隐患：门禁"测错对象"

现象：设备门禁 5/5 全部 `exit=1`，日志显示 `url=https://8.148.156.146/#/me` /
`FAIL no CDP page target url contains localhost`。

根因：**9222 端口争用**——网页端门禁起的测试 Chrome 仍占着 `127.0.0.1:9222`，
`adb forward tcp:9222` **绑定失败**（`forward --list` 为空），门禁实际问的是 web Chrome。

⭐ 值得肯定：门禁**正确地作废了证据**（`VISUAL_TARGET_VALIDITY: FAIL → 这不是产品 FAIL`），
没有误报成产品缺陷。

修复：`run-device-gate.sh` 建立转发前先按**独立 profile 精确**关掉 web 测试 Chrome
（⚠️ 绝不用 `taskkill /IM chrome.exe`），并用 `forward --list` **确认转发真的建立了**，
否则**大声失败**。

## 回归结果

- 设备端 5 个门禁 `exit=0` / `ARTIFACT_PROVENANCE: PASS`
- 新增原生平台门禁 `exit=0` / provenance PASS
- 网页端新门禁 `gate-web-update-platform` `exit=0`（9 项全真）
- 前端 `tsc --noEmit` exit=0 ／ `CHECK_ALL_LOCAL: PASS`
- ⚠️ 又一次漏跑 `npx cap sync android` ⇒ `ARTIFACT_PROVENANCE: FAIL`；
  补跑后 PASS。**已第二次**，已列为待固化为发布脚本的事项。

