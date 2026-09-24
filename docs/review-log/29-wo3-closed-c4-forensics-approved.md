# 审核记录 29：WO#3 CLOSED；tab 撤销获接受；C4 取证批准（并升级目标）；两条纪律正式冻结

> 审核方：ChatGPT web；时间：2026-09-21 22:07（Asia/Shanghai）
> 提交侧记录：`docs/review-log/28-wo3-submitted.md`

## 一、WO#3：ACCEPTED / CLOSED

审核给出的正式口径：

```
CHAT_MESSAGE_SENDER_PRESENTATION:  FIXED / VERIFIED
WO3_DEVICE_GEOMETRY:              PASS
WO3_SERVER_IDENTITY_ORACLE:       PASS
WO3_REGRESSION:                   PASS
WO3_FINAL_CLOSE:                  CLOSED
```

并指出**最有说服力的不是 `--me` 类名，而是把两件事分开验证**：

> "谁是我" → `/api/auth/me` + 服务端消息 `senderId`
> "他实际画在哪" → 真机 rendered geometry
> 这样避免了：`class=me` → 所以这是我的消息 → 再用 `class=me` 证明我的消息靠右 这种循环论证。
> **这个 verifier 的设计应该保留。**

关于原版证据的定性（**与我此前的自我更正一致**）：

> 原版右侧几何证据也足以支撑本单：至少"本人消息位于右侧"已有**直接 bounds 观察**；
> `im_chat_left/right_*` 资源**只作为辅助证据即可，不需要把它抬高成运行时证明**。

### 未覆盖项的**正确标注方式**（审核指定，须照此写）

```
meId === null 未运行，**不阻塞关闭**。你的标注方式正确：
  VALID AUTHENTICATED CHAT PATH:     VERIFIED
  meId === null defensive fallback:  SOURCE-VERIFIED
                                     RUNTIME: NOT_EVALUATED
它不是正常已登录聊天路径的完成条件，而且未登录时页面本身不可达，
因此没必要为了测试一个防御性 fallback 人工制造异常 session 状态。
→ **不要把它写成 PASS 即可。**
```

## 二、tab deviation 撤销：接受

> 这次也是典型的**坐标区域误分类**：把顶部标题/切换器与底部 tab 当成同一个导航区域。
> 既然 bounds 已把区域关系拆清 …… 那么 `TAB_DEVIATION: RETRACTED` 合理。
> **保留旧 finding + withdrawal provenance，不要直接抹掉历史即可。**

（我们的做法与之相符：旧登记保留、附四/撤销文档均写明原登记与为何错。）

## 三、C4：批准执行定向提取，但**取证目标被升级**，且预先冻结规则

审核把工作目标从"找有没有 emoji 资源名"升级为
**"表情相关资源发现 + 使用关系追踪"**，要求分两层：

### 第一层：资源 inventory

```
找: emoji / emotion / expression / face / smile …
    范围: drawable / mipmap / raw / assets

若出现**六个成套 drawable** → 很有价值的支持证据
若完全没有 → 只能得出"APK 中没有明显可识别的表情资源"，
           **不能直接证明字体渲染**（可能名称混淆 / atlas-sprite / assets / 网络资源 / 运行时生成）
```

### 第二层（**审核说"更重要"**）：追 `emotion_image` 的绑定

```
查: R.id.emotion_image → 哪个 layout / ViewHolder / adapter → bind 时调用什么
目标: 看到类似 setImageResource(...) / setImageDrawable(...) / setImageBitmap(...)
      或其它可追踪来源
```

### 预先冻结的判读规则（审核指定）

```
只得到"存在一些疑似 emoji drawable" → C4 继续 UNRESOLVED
追到 emotion_image → setImageResource(R.drawable.xxx) →
        才有资格把 C4 升为 ORIGINAL_RENDERING_KIND: DRAWABLE
若绑定链直接证明 Unicode/text/emoji rendering → 可**撤销** C4

资源名称**只能改变证据权重，不能单独改变产品实现**。
真正解冻要尽量追到 runtime binding / source。
```

### 停止扩张的条件（审核明确）

> 如果仍无法越过"资源存在性"到"实际绑定来源"，就**停止扩张调查**，
> 让 C4 保持 UNRESOLVED，**继续处理 AUDIT 里其他有明确证据价值的项目**。

## 四、`force-stop` 规则：**正式冻结**（采纳我现行版本）

```
DEFAULT: 不得主动 force-stop 第三方原版 App
若原版抢前台: 优先重新拉起我们自己的 Activity
无法可靠恢复: abort / 人工处理
explicit force-stop switch: 允许保留，但**不得进入默认 conformance Gate**
```
> 此前那次 force-stop 不属于对原版服务器的写操作，但它属于**主动第三方进程干预**，
> 所以不应成为默认自动化动作。

## 五、"测试期望来源"纪律：确认，但用**修订后的表述**

审核**否掉了**我原来的绝对化表述（"不要从 HTTP response 构造测试期望"），给出正式版：

> **Test oracle 应来自与被验证 invariant 最直接、独立、权威的观测面；
> 不要用被测流程中的脆弱中间变量循环构造期望。**

映射表（审核给出）：

| 被验证的东西 | 权威观测面 |
|---|---|
| HTTP contract | HTTP response |
| 数据库持久化 | DB |
| 文件状态 | filesystem |
| 界面呈现 | rendered UI geometry / text |
| 当前用户身份 | `/api/auth/me` / authoritative auth state |
| 部署版本 | embedded revision / hash |

并点名 **WO#3 是正例**：`sender identity → server`、`bubble position → device geometry`，
而不是让 UI class 同时充当输入事实和输出证明。

## 六、M5 状态（审核给定，以此为准）

```
WO#1 board_notes functional/privacy:  CLOSED
WO#2 chat image send path:            CLOSED
WO#3 sender presentation:             CLOSED
tab deviation:                        RETRACTED
C4 emoji rendering kind:              UNRESOLVED / FROZEN
```

## 七、下一步（审核建议）

> 支持优先做一次 **C4 APK 静态使用链取证**；若仍无法越过"资源存在性"到"实际绑定来源"，
> 就停止扩张调查，让 C4 保持 UNRESOLVED，继续处理 AUDIT 里其他有明确证据价值的项目。

→ 本轮即执行 C4 的两层取证（第一层 inventory + 第二层绑定链追踪）。

---

⚠ 审核原文末尾自带提示："ChatGPT 可能会出错。请核查重要信息。"
→ 本记录中的**事实性主张（几何数值、bounds、资源名）均以我们自己的原始产物为准**，
审核意见作为**裁定与方向**采纳；两者不一致时应复核产物再定。
