# 审核记录 43：**WO#7 PASS / CLOSED**；4 处修正（含资产版权边界）

> 审核方：ChatGPT web；时间：2026-09-22 02:18（Asia/Shanghai）

## 一、正式裁定

```
WO7_TEXT_MESSAGE_SEND_PATH: **PASS / CLOSED**

TEXT_SEND_ENTRY:       PASS
TEXT_SEND_FUNCTIONAL:  PASS
TEXT_SEND_PERSISTENCE: PASS
TEXT_SEND_FAILURE:     PASS
TEXT_SEND_DB_ORACLE:   PASS
COMPOSER_REGRESSION:   PASS
SERVER_REGRESSION:     PASS
SENSITIVITY:           PASS
```

审核特别肯定失败路径的设计：
> "尤其认可失败路径：发送失败 → DB delta = 0 → 无 ghost bubble → **draft 保留**。
>  这比'显示了错误提示'强得多，因为**用户没有因为网络/API 失败而丢掉刚输入的内容**。"

## 二、✅ 修正 1：Stage 0 术语收紧（我已改）

我原先写 `SEND_BTN_BINDING_EXISTS: STRONGLY_SUPPORTED` —— **过强**。审核给定：

```
SEND_BTN_DECLARATION:            CONFIRMED
SEND_BTN_BINDING_SYMBOLS:        SUPPORTED                      ← 不是 STRONGLY
SEND_BTN_RUNTIME_CLICK_BINDING:  NOT_DIRECTLY_OBSERVED
COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED
```
> "DEX 字符串池中同时出现这些符号，确实比单纯 layout declaration 更强，
>  但**它还不是'看到了具体方法体调用'**。你没有用它推导具体 VISIBLE/GONE 状态，
>  所以不影响关账。"

**并且重申**：我采用的"非空 draft → 显示发送按钮"
**继续标为我方合理设计选择**，不是 original conformance PASS。

## 三、⚠️ 修正 2：矢量 pathData —— 取证成立，但**资产版权是另一回事**

审核认可取证层面的判断：
> "Android vector 的 pathData + fillColor + viewport + dimensions 本身就是**图形绘制描述**，
>  不是视觉模型猜出来的形状。因此作为 1:1 复刻依据，它比'看截图手动画一个纸飞机'强得多。"

应记录的强度：
```
SEND_BUTTON_VECTOR_GEOMETRY: DIRECTLY_DERIVED_FROM_APK_RESOURCE
RUNTIME_PIXEL_CONFORMANCE:   NOT_EVALUATED
```

**⚠️ 但审核同时指出一条与 conformance 无关、却必须写清的边界**：
> "如果原版不是你拥有或获许可的资产，**直接复制其 vector path 到要公开/商业发布的产品里
>  可能涉及资产版权/许可问题**。这不影响你用它做**私下的复刻和证据分析**，
>  但**最终发布前**最好把'原样复制第三方图形资产'单独做一次 **licensing/IP 清查**。
>  若目标是可公开独立项目，届时可能需要**自行重绘一个视觉等价但非直接复制的图标**。"

**我的处置（记入计划，并在代码注释里标注）**：
```
· 本项目当前定位：**私有复刻 demo**（对照学习/演示）→ 取证与复刻本身按本记录继续
· 但凡是"逐字复制第三方图形资产"的地方，都加标记：
    ASSET_ORIGIN: COPIED_FROM_THIRD_PARTY_APK
    PUBLICATION_BLOCKER: LICENSE_REVIEW_REQUIRED（公开发布前必须单独清查）
· 已受影响资产（当前清单）：
    1. app/src/components/icons-send.tsx —— 发送按钮 pathData（res/JA.xml）
    2. docs/original-baseline/supplements/original-emoji-*.txt —— 154 个表情资源名/映射
    3. docs/original-baseline/screens/** —— 原版截图（含第三方内容）
    4. .mumu-capture/apk/target.apk —— 原版 APK 副本
  → 已加入 NEXT-ACTIONS（I 区）作为**发布前必做项**，不是现在做，但**不能忘**。
```

## 四、✅ 修正 3："改前必须先跑 FAIL" **不设为绝对硬步骤**

> "你这次的补救我接受。真正的硬要求应继续是我们前面冻结的：
>  关键 Gate 创建或显著修改时，**必须证明 sensitivity** ——
>  对应 invariant 被破坏后，Gate 能稳定 FAIL 且顶层 exit 非零；恢复后 PASS/0。"

**正式纪律（替换我原先的表述）**：
```
PREFERRED:
    pre-fix FAIL → fix → PASS
    （因为它同时证明 Gate 能捕获**真实历史 defect**）

REQUIRED:
    controlled sensitivity test proving
        broken invariant   → FAIL / exit 非零
        restored invariant → PASS / exit 0

⚠️ 不要因为漏跑 pre-fix Gate 就把已经完整的 WO#7 重新打开。
```

## 五、✅ 修正 4：覆盖检查的**命名与语义**（我已改代码）

我原先的实现从 **DB enum** 推出"每个 enum 都必须有 UI 入口" —— **语义错了**。审核：

> "建议名称/语义明确为 `IMPLEMENTED_COMPOSER_CAPABILITY_COVERAGE`。
>  **不要**让它自动从 server message kind enum 推出'每个 enum 都必须有 UI 入口'，
>  因为未来可能存在**内部 kind、历史兼容 kind 或只读 kind**。
>  更稳的关系是：capabilities declared as **user-sendable** → each must have a reachable user path"

**我已改为**：
```
基准 = **产品声明**（脚本里的 SENDABLE 清单，人工维护、每项给出可探测判据）
服务端 enum = **仅 INFO 对照**，用来让"声明"与"实现"的漂移可见，**不参与判定**
新增用户可发送类型时必须在 SENDABLE 里登记，否则不受本检查保护
```

**判别力双侧验证（两向都要成立）**：
```
① --self-test-declare video → video = COVERAGE GAP → **FAIL / exit 1**
   （证明：已声明但无入口 → 会被检出）
② --server-kinds text,image,voice,video,internal_note
   → info "服务端有但未声明为可发送: video, internal_note（不判 FAIL）" → **仍然 PASS / exit 0**
   （证明：enum 不会造出假 FAIL —— 正是修正要求的语义）
```
> 审核的总结："这单最重要的收获其实不是多了一个发送按钮，
>  而是把之前分散的 text/image/voice 垂直 slice 提升成了一个**横向 capability coverage 视角**。
>  这个 Gate 很值得作为 M5 后续的 **persistent invariant**。"

## 六、✅ 修正 5：两个工具问题都做成"不依赖调用者记住顺序"

```
① VISUAL_TARGET_VALIDITY 的 forward 顺序
   → 已封成 scripts/m5/run-device-gate.sh：
       am start → **establish CDP forwarding** → prove CDP reachable
       → VISUAL_TARGET_VALIDITY → device test → VISUAL_TARGET_VALIDITY(again)
   → 实测两次 preflight 均 PASS，假 FAIL 消除
② .ps1 BOM
   → 已封成 tools/check-ps1-bom.ps1（静态检查，含非 ASCII 的 .ps1 必须带 BOM）
   → 首跑即发现**我自己新写的脚本**缺 BOM，正是它该防的形态
```

## 七、最终状态（审核给定）

```
WO#7:  PASS / CLOSED
ENTER_TO_SEND:                    NOT_IMPLEMENTED
ORIGINAL_BEHAVIOR:                NOT_EVALUATED
COMPOSER_EXACT_VISIBILITY_STATE:  NOT_EVALUATED
TEXT MESSAGE USER PATH:           FUNCTIONALLY VERIFIED
```
