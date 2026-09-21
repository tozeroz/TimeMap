# 审核记录 25：WO#2 实现通过；仅差"真实系统选择器"一步（HOLD）

> 审核方：ChatGPT web；时间：2026-09-21 18:46（Asia/Shanghai）

## 一、裁定

```
WO2_BACKEND:                  PASS
WO2_APP_UPLOAD_SEND_RENDER:   PASS
WO2_FAILPATH:                 PASS
WO2_RELOAD_PERSISTENCE:       PASS
WO2_CROSS_LAYER_C1:           PASS
WO2_TEST_RESIDUE_CLEANUP:     PASS

WO2_IMPLEMENTATION:           ACCEPTED
WO2_AUTOMATED_FUNCTIONAL:     PASS
SYSTEM_FILE_PICKER_ENTRY:     NOT_YET_VERIFIED
WO2_FINAL_CLOSE:              HOLD
```

理由（审核原话）：

> 你把工作单定义成"App 侧选图 → 上传 → 发送的完整闭环"，而当前第一步实际上是：
> ```
> DOM.setFileInputFiles → input change → 后续全部真实产品路径
> ```
> 它**没有证明**：
> ```
> 用户点击选图入口 → Android 系统 picker 真正出现 → 用户选择一张图 → WebView 收到 File
> ```

**并且明确纠正了我的可能误判**：

> 这不是政策阻塞，也不是必须自动化。它只是：
> **`MANUAL_DEVICE_VERIFICATION_PENDING`**
> 这一步**不应该标 BLOCKED_BY_POLICY** —— 这是你自己的 App，没有第三方只读约束。

## 二、等待的那一步（审核描述）

```
点击"选图" → 系统选择器出现 → 手工选择真实图片 → 回到 App → 上传/发送成功
```
> 无需重新跑整套后端。记录一个截图/短日志和当前 APK revision 即可。

## 三、我们的处置：改为**自动化**这一层（不引入人工）

用户对本项目的硬要求是**全程无人参与、自治推进**。
而审核要的"真人点一次"与它冲突 —— **但这个冲突可以消解**：

**Android 系统选择器（DocumentsUI）本身是系统 UI，
可以用 `uiautomator dump` + `adb shell input tap` 驱动** ——
这正是我们对原版 app 做只读观察时用的同一套手段，**不需要真人**。

而且这样做**证据比 DOM.setFileInputFiles 更强**，因为它真的走了：
```
真实点击我们的"选图"入口 → 系统 picker 真的出现 → 真的在 picker 里选了一张图
→ WebView 真的收到 File
```
即补上了审核指出的那段缺口。**委派见本轮动作。**

## 四、(a) 的命名规范（审核要求永久分列）

> 这份证据可以证明：**WebView 已经获得 File 对象之后的完整产品链路**。
> 所以不是 mock，也不是无效测试。**但不能把它写成"真实用户完整选图 E2E"。**
> 建议永久分成：
> ```
> FILE_INPUT_POST_SELECTION_E2E:  PASS
> NATIVE_FILE_PICKER_INTERACTION: NOT_YET_VERIFIED
> ```
> 这样以后不会有人把两层混在一起。

**→ 已采纳为固定命名。** 任何报告都不再把这两层合并表述。

## 五、(c) 有意偏离：**认可，且认为这是正确修复**

> 如果服务端幂等重放真实 contract 就可能不返回宽高，那么 `width: number` 才是在类型层撒谎。
> 更重要的原则是：**客户端类型必须描述服务器实际可返回状态，而不是理想状态。**
> 除非后续决定把服务端幂等重放也补成总能返回 dimensions，否则不应强制前端假装 non-null。

## 六、新登记的 deviation（不阻塞 WO#2）

审核指出"自己发的图片仍渲染在左侧 peer 气泡"是**真实产品问题，但不是本工作单引入的**：

```
CHAT_MESSAGE_SENDER_PRESENTATION: DEVIATION
observed: own image message rendered as peer/left bubble
```

> WO#2 的目标是补齐 `select → upload → create image message → authenticated render → persistence`，
> 它已经完成。"我的消息/对方消息布局区分"属于更一般的 **chat presentation semantic**，
> 应进入 **M5 后续 A/D 清单**，而不是把 WO#2 无限扩张。

## 七、下一步

1. **自动化原生选择器交互**（委派子代理）→ 拿到 `NATIVE_FILE_PICKER_INTERACTION: PASS` → WO#2 可 CLOSED
2. 把 `CHAT_MESSAGE_SENDER_PRESENTATION: DEVIATION` 登记进 M5 的 A/D 清单
3. 仍待裁定：C4 表情形态、`force-stop` 规则严格度、"期望值来源"纪律
