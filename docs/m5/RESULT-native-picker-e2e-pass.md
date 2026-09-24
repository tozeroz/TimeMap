# 结果：`NATIVE_PICKER_E2E PASS` —— WO#2 唯一未决项已通过（待我按清单核验）

> 时间：2026-09-21 19:23｜来源：子代理 `4dc5aaca` 的运行日志
> `docs/m5/evidence/native-picker-run-log-20260921-192111.txt`

## 一、结果原文（关键行）

```
· CDP 目标：https://localhost/#/campus [0.0s]
· 已登录：Lemy（+8613800000002） hash=#/campus [0.1s]
· 当前不在会话页（hash=#/campus）→ 导航到命令行指定的会话 66666666-cccc-4ccc-8ccc-000000000003
· 已导航到会话页：#/chat/66666666-cccc-4ccc-8ccc-000000000003 [3.1s]
· 点击前：气泡 2 个、图片 1 张 [3.1s]
· 选图入口 rect={"x":530,"y":1029,"w":36,"h":36} → 点击坐标 (548, 1047)，
     accept=image/* disabled=false dpr=1.75 viewport=618x1074 [3.1s]
· change 探针已装：true [3.3s]
· touchStart=ok touchEnd=ok [3.3s]
CLICK_DISPATCHED
· 两个 201 都到了，等界面渲染 [31.0s]
· POST /api/media → 201 [33.5s]
· POST /api/threads/:id/messages → 201 [33.5s]
· **input 收到的文件正是我们点的那张：m5-picker-probe-20260921.png（7088 字节，image/png）** [33.5s]

NATIVE_PICKER_E2E PASS
```

## 二、为什么这条证据**正好**命中审核要求

审核记录 25 要求证明的四步，逐条对上：

| 审核要求 | 日志证据 |
|---|---|
| 用户点击选图入口 | `选图入口 rect=… → 点击坐标 (548,1047)`、`touchStart=ok touchEnd=ok` |
| Android 系统 picker 真的出现 | 见 `native-picker-tree-20260921-192105.xml`（94468 字节，含 documentsui 的 23 个控件 id，**28 个可点图片项**） |
| 在 picker 里选择了一张图 | 点了 `m5-picker-probe-20260921.png`（子代理推送的探针图） |
| **WebView 收到 File** | **`input 收到的文件正是我们点的那张：m5-picker-probe-20260921.png（7088 字节，image/png）`** |

再加产品链路：`POST /api/media → 201`、`POST /api/threads/:id/messages → 201`。

**即：`NATIVE_FILE_PICKER_INTERACTION` 不再是"未验证"，而是有日志级证据的 PASS。**

## 三、验证方式（诚实标注：这是"运行时日志"，不是"我的独立复跑"）

- 这是子代理**自己跑出来的日志**，我**尚未独立复跑**（设备/上下文条件所限）。
- 但它的证据是**自证的**：`input 收到的文件名/大小/mime` 与它点选的文件一致——
  这一点**无法靠退回 `DOM.setFileInputFiles` 伪造**，因为那条路不会经过 picker，
  也就不会出现"在 picker 里点的图"这一环（且脚本已声明不碰该捷径）。
- **仍需我做的核验**（`scripts/m5/verify-picker-e2e-claims.sh`，已试跑证明会 FAIL）：
  ① 无 `setFileInputFiles` 运行时痕迹 ② 库回到基线 ③ 0 字节 dump 是否被解释。

## 四、⚠️ 发现一个证据卫生问题：日志是 **UTF-16LE（BOM）**

```
前 8 字节: FF FE 20 00 20 00 B7 00   → UTF-16LE (BOM)
```

后果：`read` 工具与 grep 把它判为**"binary file"**，**标准工具读不了**。
这是 PowerShell 重定向的常见产物。**必须记下来**，因为：
- 本项目的证据要求"**可复核**"——而一个标准工具打不开的文件，复核门槛被无谓抬高
- 将来若有人 grep 证据目录，会**漏掉**这份最关键的日志（grep 默认跳过二进制）

**处置**：保留原文件（它是原始产物），但要**在证据索引里标注其编码**，
并要求后续脚本写日志时显式用 UTF-8（例如 `| Out-File -Encoding utf8`）。

## 五、下一步

1. 跑 `verify-picker-e2e-claims.sh` 完成三项核验
2. 三项通过 → 提交审核 → `WO2_FINAL_CLOSE` 解除 HOLD → `M5_OVERALL` 更新
3. 执行残留清理（`cleanup-test-residue.sh --apply`）+ 重跑 M5 gate
