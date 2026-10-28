# 审核记录 27：WO#2 **CLOSED**；须修正 claim strength（不得写"真人触摸 E2E"）

> 审核方：ChatGPT web；时间：2026-09-21 19:32（Asia/Shanghai）

## 一、裁定：WO#2 继续 CLOSED

审核逐项列出**实际证明**的链路：

```
CDP Input.dispatchTouchEvent
→ 命中 App 真实 file-input 入口
→ Chromium 正常触发 Android DocumentsUI
→ DocumentsUI 与 App 位于同一 task
→ adb 系统输入点击真实文件
→ WebView 收到完全相同 filename / size / MIME
→ upload 201
→ message 201
→ render / persistence PASS
```

并列出**明确没有**的东西（审核原话）：

> 这里没有：
> - `DOM.setFileInputFiles`
> - 人工构造 File
> - 人工 `am start` 一个假的 picker
> - 绕过产品上传/发送代码

> 因此对于 WO#2 的核心命题：**App 的真实选图入口可以拉起系统 picker，
> 并把系统选择结果送入真实产品链。证据已经足够。**

**并且**：

> 我不要求再增加"真人手指点一次"作为 WO#2 closeout。

## 二、必须修正的：claim strength（**不得**写"真人/物理触摸完整 E2E: PASS"）

改为以下四个**分列** key：

```
NATIVE_FILE_PICKER_PRODUCT_PATH:        PASS
SYSTEM_PICKER_SELECTION:                PASS
WEBVIEW_FILE_DELIVERY:                  PASS
ANDROID_INPUTDISPATCHER_ENTRY_TOUCH:    NOT_EVALUATED
```

**为什么必须分列**：前者说的是"**产品路径**通了"（这是 WO#2 的命题）；
后者说的是"**Android 输入层分发**也走通了"（本次未验证，因为用的是 CDP 注入触摸）。
把两者合并成一句"真人触摸 E2E PASS"，就是把未验证的那层**说成已验证** ——
与本项目已犯过的"措辞不精确导致过度声明"（pitch/gap、"真机 PASS"含混两层）**同一类**。

## 三、另两项裁定

### 设备健康探针 → **正式纳入设备 Gate 前置惯例**

> 第二条我建议正式进入 **设备 Gate 前置惯例**。

即：任何 UI 自动化**之前先跑设备健康检查**（`scripts/m5/device-health-probe.ps1`）。
这条来自子代理的真实事故：第一次尝试时 picker 弹出但 guest 整体卡死
（input 全无效、相隔 2 分钟的 screencap 哈希逐字节相同），
**若当时收工就会写出与事实相反的结论**。

### 共享验证环境卫生 → **必须清**，但不追溯否定 WO#2

> 第三条是共享验证环境卫生，必须清，但不追溯否定 WO#2。

**已完成**：A 类（7 测试账号 + 4 media + 1 留言）与 B 类
（种子用户 Lemy 名下 2 条 image 消息 + 1 media，用白名单删）都已清理，
库回到纯种子基线 `users=3 / messages=2 / media=2 / board_notes=1 / message_media=0`，
`TEST_RESIDUE_USERS=0`。基线参照也已同步更正
（`docs/archive/legacy-development/m5/evidence/db-counts-clean-seed-baseline.txt`）。

## 四、WO#2 最终状态

```
WO2_BACKEND:                             ACCEPTED（审核记录 24）
FILE_INPUT_POST_SELECTION_E2E:           PASS
NATIVE_FILE_PICKER_PRODUCT_PATH:         PASS
SYSTEM_PICKER_SELECTION:                 PASS
WEBVIEW_FILE_DELIVERY:                   PASS
ANDROID_INPUTDISPATCHER_ENTRY_TOUCH:     NOT_EVALUATED（明确分列，不得合并）
WO2_FINAL_CLOSE:                         CLOSED
M5_SERVER_GATE_RESULT:                   PASS
```

## 五、下一步

1. 把上述分列 key 写进 M5 gate 的 `M5_OVERALL`（**替换**此前含糊表述）
2. 把"UI 自动化前先跑设备健康探针"写进设备纪律文档
3. M5 剩余的 A/D 项：C4（UNRESOLVED+FREEZE）、tab deviation、气泡偏差观察
4. 仍待裁定的旧项：`force-stop` 规则严格度、"测试期望应从权威数据源推导"纪律
