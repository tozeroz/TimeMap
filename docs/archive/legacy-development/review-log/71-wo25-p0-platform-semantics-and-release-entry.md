# Review 71：WO#25 P0 补做 —— 裁定全部 PASS / P0 正式销项

> 审核方：远端 GPT（会话 `审核M1设计`）
> 提交时间：2026-09-24 03:27（提交内容 3316 字符，含 4 个待裁定问题）
> 裁定时间：2026-09-24 03:42（本次落盘）
> 触发原因：**我自己复核裁定内容时发现先前把"PASS/CLOSED"当成了免检**，
> 而审核方在批准时明确给了一条 **P0**（网页端绝不能把"下载 APK"当成自己的更新），
> 我先前未覆盖却已记为 CLOSED ⇒ 补做后复交。

## 一、原始裁定（逐字摘录）

```
WO25_WEB_RELEASE: PASS / CLOSED
DESKTOP_CONSTRAINED_LAYOUT: PRESERVED / PASS

WEB_UPDATE_PLATFORM_CONTRACT: PASS
NATIVE_UPDATE_PLATFORM_CONTRACT: PASS

WEB_PLATFORM_SEMANTICS: PASS
NATIVE_PLATFORM_REGRESSION: PASS

NEXT RELEASE HARDENING:
canonical Android release script
-> build -> cap sync -> provenance -> package
```

## 二、逐条裁定与落实

### 2.1 P0 正式销项
> 「这次补丁修的是一个真正的 **P0**：此前"网页端门禁全绿"并不能证明 APK 更新逻辑适用于 Web；
>   现在平台语义才真正对齐。… **所以这个 P0 正式销项。**」

审核方确认的分工（与我的实现一致）：

| 平台 | 更新语义 |
|---|---|
| **Web** | 随服务端部署更新 → 刷新获得新版本 → **不展示 APK URL** → **不提供「立即更新 APK」** |
| **Android native** | release manifest → APK update → OS install handoff |

> 「这不是两个平台功能不一致，而是**相同用户目标在不同平台采用正确的平台行为**。」

### 2.2 对称的一对门禁 —— 认可
> 「**认可，而且这里非常合适**。这不是重复测试。它们分别防两种不同回归：
>   Web gate → 防止 APK-only 功能**重新泄漏**到 Web
>   Native gate → 防止修 Web 时**误删 Android 的真实更新能力**」
> 「尤其你又给 native gate 加了：CDP target must be https://localhost/ otherwise refuse conclusion
>   —— 这是**正确的 target validity**。」
> 「**两条都保留**。Web audit 中 native gate 标记 NOT_APPLICABLE 也仍然是正确做法，
>   **不应为了统一数字删除它**。」

⚠️ 最后一句很重要：**不为了"数字好看"而删掉不适用项**。这与我一贯坚持的口径一致。

### 2.3 fake status bar 仅开发态 —— 认可
> 「**认可**。这个边界现在很清楚：Vite development preview → 可以显示 fake status bar
>   （开发预览辅助）；Production Web → 不显示 fake OS status bar；
>   Native Android → 使用真实系统 bars / safe area。」
> 「这比以前"正式网页还画 9:41、信号、电池"合理得多。」
> 「桌面端继续保留 centered / max-width ≈ 430px 也认可。去掉圆角、重阴影等"模拟手机硬件"的装饰后，
>   现在它更准确地说是：**桌面上的居中 mobile-first application canvas**，
>   而不是"浏览器里的手机模拟器"。」

### 2.4 cap sync —— 要求固化为**唯一入口**（已直接实施）
> 「**需要**。你已经连续两次遇到 source changed ≠ Android packaged artifact changed，
>   这已经足以证明它**不是偶发手误，而是发布流程本身缺少一个必经步骤**。」
> 「但**不要再新建复杂 Gate 系统**。只需要做一个**唯一 Android 构建/发布入口**。」
> 固定顺序：`frontend build → npx cap sync android → artifact provenance check → Android build → install/release`
> 「以后不要允许正常发布流程出现 npm run build → 直接 gradle / install，
>   而必须走 release-android.ps1 或你们已有脚本中的一个明确 command。」
> 「最重要的是：**cap sync failure → entire release command fails；
>   provenance failure → entire release command fails。不要出现 warning 后继续打 APK。**」
> 「这样第三次问题就从"提醒 agent 记住"变成了"**流程结构上很难漏掉**"。」
> 「这条发布脚本我**建议直接做，不必再发一份设计计划**；范围已经足够明确。」

⇒ 已按此实施 `tools/release-android.ps1`（见下节）。

### 2.5 9222 端口争用的修法 —— 认可
> 「你这次修的 9222 端口争用也认可：**精确终止你自己启动、独立 profile 的 Web 测试 Chrome**，
>   再确认 adb forward 实际建立，比粗暴 taskkill chrome.exe 正确得多。」

### 2.6 边界指示
> 「你指出的这条也值得保留为项目经验：Gate 全绿只能证明"符合 Gate 写定的 contract"，
>   不能证明"这个 contract 对当前平台本身就是对的"。**但记录到这里即可，
>   不要再由此发展新审计体系。**」

⇒ 只把这条写进文档与日志，**不新建审计体系**。

## 三、按 2.4 实施的唯一 Android 发布入口

`tools/release-android.ps1`（**纯 ASCII**，实测 0 个非 ASCII 字节）：

```
1) tsc --noEmit（叶子配置）
2) pnpm build
3) npx cap sync android          ← 反复被漏掉的那一步，现已成为流水线必经步骤
3.5) PROVENANCE: web dist == cap asset   ← **强制**（同名 + 同 sha256，不符即中止、不产出 APK）
4) gradle assembleDebug / installDebug
5) 打印 APK 路径/大小/sha256
6) 设备门禁（三段式 provenance + 平台语义）—— 任一失败即**中止整条命令**
```

**实测**：
- 默认流程端到端成功：`BUILD SUCCESSFUL`，APK 8965701 字节，
  三个关键门禁 `exit=0` 且 `ARTIFACT_PROVENANCE: PASS`
- **注入测试（证明 3.5 步骤真有判别力）**：临时把 cap 资产目录指向错误路径
  ⇒ 脚本 `exit=1` 并在 provenance 步骤**中止**、**不产出 APK**
  （审核方要求"provenance failure → 整条命令失败"已满足）
- ⚠️ 一次性手工验证，**不建新的敏感度框架**（遵守 2.6）

## 四、本工作单最终状态

```
WO25_WEB_RELEASE:            PASS / CLOSED
WEB_PLATFORM_SEMANTICS:      PASS
NATIVE_PLATFORM_REGRESSION:  PASS
DESKTOP_CONSTRAINED_LAYOUT:  PRESERVED / PASS
WEB_UPDATE_PLATFORM_CONTRACT:   PASS
NATIVE_UPDATE_PLATFORM_CONTRACT: PASS
NEXT RELEASE HARDENING:      已实施（release-android.ps1 为唯一入口）
```

## 五、遗留（已登记的已知项，均经裁定不阻塞）

- **iOS Safari**：`NOT_EVALUATED`（无真机）—— 裁定 `KNOWN UNVALIDATED PLATFORM / NON-BLOCKING`
- **外部告警通道未接**（证书监控）：裁定为 `RELEASE OPS GAP`；`TLS_ALERT_WEBHOOK` 已实现未配置
- 后续 Release / 运维 / 视觉设计**另开工作单**，不扩展 WO#25

## 六、本轮我自己的错误（如实留痕）

1. ⭐ **把"PASS/CLOSED"当成免检**：审核方明确给了一条 P0，我未覆盖却已记为 CLOSED
   ⇒ 等于**用裁定的措辞代替了对裁定内容的逐条核对**。
   是靠**复核那条结论本身**（实测 DOM 与点击行为）发现的，不是靠提示。
2. 在 `release-android.ps1` 注释里**引用审核方的中文原文** ⇒ 该文件出现 66 个非 ASCII 字节，
   **违反了该文件头部自己写的 ASCII 规则**（PowerShell 5.1 会按本地代码页解析无 BOM 的 .ps1）。
   已改为英文转述并实测 0 个非 ASCII 字节。
