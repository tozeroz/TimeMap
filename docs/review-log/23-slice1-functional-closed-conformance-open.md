# 审核记录 23：board_notes 功能闭环 CLOSED / 页面一致性仍是 OPEN；force-stop 规则收紧

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 17:58（Asia/Shanghai）

## 一、状态裁定：**功能闭环可以关，页面 1:1 收敛不能关**

审核接受了四个 key：

```
BOARD_NOTES_FUNCTIONAL:         PASS
BOARD_NOTES_PRIVACY_ISOLATION:  PASS
BOARD_NOTES_IDENTITY_CONTRACT:  PASS
BOARD_NOTES_DEVICE_E2E:         PASS
```

但状态必须**拆成两个维度**：

```
M5_SLICE1_FUNCTIONAL:   CLOSED
M5_SLICE1_CONFORMANCE:  OPEN
```

审核给的理由（我认为是对的，且这正是本项目一直在坚持的口径）：

> 现在已经知道页面仍有真实差异，**不能一边登记差异，一边又把该页一致性关账**。

対于真机验证的价值，审核也给了肯定：

> 第三账号真机验证很有价值，因为它同时覆盖了 **session 切换、前端缓存、路由、API 权限和正常空态**，
> 已经不是单纯后端授权测试。

## 二、force-stop：技术判断成立，但**规则要收紧**（重要）

审核原话：

> `adb force-stop com.kairuotu.campus` **不是**对原版服务端业务数据的写操作，
> 所以它与发帖、点赞、发消息、改资料不是同一类违规。
>
> 但它确实是对第三方 App 的**主动本地状态干预**；在"原版只读取证"的治理原则下，
> 我建议采用更保守的规则：
>
> **测试 harness 不主动 force-stop 原版 App；检测到前台包不是我们的 App 时，
> 优先把我们自己的 Activity 拉回前台，无法可靠恢复则该用例 abort / 提示人工处理。**
>
> 也就是说，不需要把这次动作定性成一次第三方服务器写入违规，
> 但**不要把 force-stop 永久嵌入正常 Gate 路径**。这样边界更干净。

**要做的修改**：`scripts/m5/device-board-isolation.mjs` 目前把 force-stop 内置了。
应改为：
1. 检测到前台包不是 `com.campusx.demo` 时，**先尝试把我们的 Activity 拉回前台**
   （`am start -n com.campusx.demo/.MainActivity` 之类）；
2. 仍不可靠恢复 → **abort 并提示**，而不是去 force-stop 第三方 App；
3. 若要保留 force-stop 能力，必须**显式开关**（默认关），并且每次使用都要在证据里说明。

## 三、C1–C4 的方向：总体认可，但 **C1/C4 也要先补只读证据**

审核对我的"口径清楚先做、口径不清先观察"表示认可，但**进一步收紧**：

| 项 | 审核要求 |
|---|---|
| **C1 返回按钮** | 存在性已直接观察，但"**按钮究竟返回哪里、与 `ivClose` 的区别**"还需一次**只读点击观察**。导航本身不产生业务写入，可安全取证。**确认后再实现。** |
| **C4 图片表情** | `emotion_image` 足以证明"原版用图像而非文字 emoji"，故当前文字 emoji 确是 DEVIATION。但**六张图长什么样仍未 captured** → 建议先用**原始截图裁出对应区域**形成 raw visual evidence，再决定"复刻图像"还是"先完成 image-based structure"。 |
| **C2 留言总数** | 我的判断正确：控件存在 ≠ 知道计数口径。**先只读观察，不猜。** |
| **C3 下拉刷新** | 同样先观察。拉动刷新通常属只读交互，但要确认**没有其它副作用**；只观察刷新 UI、列表与网络读取即可，**不制造留言**。 |

### 一条应当写进纪律的原则

> **不要把 `resource-id` 的名字当成行为 contract。**

这条正好解释了我这次发现的性质：`tvTotalComment`、`refreshLayout` 这些**名字**告诉我"有个控件"，
但**名字不是契约** —— 计数口径、刷新语义都必须另外取证。这也是 M5 最应坚持的方式。

## 四、下一步（按裁定）

1. **改 `device-board-isolation.mjs`**：去掉默认 force-stop，改"拉回自己前台 / abort 提示"
2. 把状态写成 `M5_SLICE1_FUNCTIONAL: CLOSED` + `M5_SLICE1_CONFORMANCE: OPEN`（写入审计表）
3. C1 做**只读点击观察**（确定返回目标与 ivClose 的区别）后再实现
4. C4 用**原始截图裁区域**形成 raw visual evidence 后再决定实现方式
5. C2/C3 先只读观察口径，不猜
6. WO#2 后端已在按批准的设计施工（单数 `mediaId` + TTL GC）

## 五、值得记的一句

审核这次把我"登记了差异"与"关账一致性"之间的矛盾直接指了出来。
我的原报告写的是"board_notes Slice 1 收口"，**这个说法本身就把两个维度混在了一起** ——
功能闭环确实收了口，但一致性并没有。**措辞精确性又一次是问题的核心**（与 §22 那次
"pitch 不是 gap" 是同一类错误）。
