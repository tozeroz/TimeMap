# I1 发布前 IP 清查（第一刀：图标来源核实）

> 时间：2026-09-23 04:30（Round 319）
> 依据：NEXT-ACTIONS 的 I1 条 —— 逐一核对 5 类"逐字复制自第三方 APK"的资产，
> 决定 保留／替换为自绘等价物／移除。本条聚焦其**第 5 类**：
> "`app/src/**` **其它**『按原版截图/资源复刻』的图标（**需逐个核对来源**）"

---

## 〇、⚠️ 本轮的**方法失败**必须先说清（否则"0 匹配"会被误读）

```
我尝试用机械比对回答"icons.tsx 的 pathData 是否逐字复制自原版 APK"：
  ① unzip 取出 APK 内 res 下所有 xml（2627 个条目）
  ② 正则抓 `pathData="…"`
结果：**"含 pathData 的 1136 个文件，但去重后一条值都取不到（0 条）"** —— 自相矛盾。

根因：APK 里 vector drawable 被编译成 **AXML 二进制** ——
      "pathData" 作为**字符串池**里的名字能被搜到，而属性**值**通过索引引用，
      明文正则拿不到。
⇒ ⚠️⚠️ **那次"0 匹配"是方法失效的产物，绝不能读成"我们的图标是自绘的/清白的"。**
   这正是本项目反复强调的"**测量 ≠ 事实**"：一个看起来干净的结果，可能只是仪器没工作。
```

**正确方法已经写在仓库里**（`icons-send.tsx` 的来源注释）：
```
命令： aapt2 dump xmltree --file res/JA.xml <apk>
```
⚠️ 但本轮**环境里 aapt2 不可用**（也查了 apktool / androguard，都没有），
   且**该命令的输出从未留档进仓库** ⇒ 那条取证现在**不可复算**。

---

## 一、核实结论（逐项）

| 资产 | 现状 | 判定 |
|---|---|---|
| `app/src/components/icons-send.tsx` | **有** `ASSET_ORIGIN: COPIED_FROM_THIRD_PARTY_APK`，写明两条 pathData 逐字复制自 `res/JA.xml`，并给出 `aapt2 dump xmltree` 命令 | ✅ **已登记**（但见 §二 的"不可复算"问题） |
| `app/src/components/icons.tsx`（267 行、29 条 path） | **既无** `ASSET_ORIGIN` 标记、**也无**任何"自绘"声明 | ⚠️ **`ASSET_ORIGIN: UNDOCUMENTED`** —— 来源未登记，**发布前必须核实** |
| `docs/original-baseline/supplements/original-emoji-*` | 已登记于 `LICENSING-NOTES.md` 第 2 项 | ✅ 已登记 |
| `docs/original-baseline/screens/`、`raw-dumps/` | 已登记第 3 项 | ✅ 已登记 |
| `.mumu-capture/apk/target.apk` | 已登记第 4 项；**未被 git 跟踪**（`.gitignore` + 全局 `*.apk`） | ✅ 已登记且未入库 |

---

## 二、⭐ 顺带查出的一个新问题：**取证不可复算**

```
`icons-send.tsx` 引用了 `aapt2 dump xmltree --file res/JA.xml <apk>` 作为取证方法，
但我在仓库里**搜不到该命令的任何产物**（xmltree 输出、JA.xml 拷贝 …都没有）。
⇒ 那条取证属于"**照一条不可复算的记录**"—— 本项目此前**已经**因这种记录吃过亏
   （message-board 的"原版恰好 7 个表情"就是一条不可复算的旧记录，曾导致实现被改错，
     后来靠可复算的 dump 才纠正回 6 个）。
⚠️ 处置建议（发布前动作）：
   重跑一次并**把输出留档进仓库**（例如 `docs/original-baseline/supplements/apk-vector-paths.txt`），
   使 `icons-send` 与 `icons` 的来源都可**机械复核**。
⚠️ 本轮**不**做这件事：它需要 aapt2（环境里没有），且属于发布前动作。
```

---

## 三、我在代码里做的**诚实标记**（不含无证据的结论）

在 `app/src/components/icons.tsx` 头部加了：
```
ASSET_ORIGIN:  **UNDOCUMENTED**（来源未登记，发布前必须核实）
+ 事实（可复核）：本文件无 COPIED 标记、也无自绘声明；对照 icons-send.tsx 有标记
+ ⚠️ 我**不能**断言本文件是自绘的 —— 那会是无证据的结论
+ 我的**印象**（⚠️ 只是印象，不是证据）：本文件路径多为极简手写形
  （如 IconMenu = `M3.5 6.5h17…` 三条直线），与 icons-send 那种 dp 制坐标不像同一来源
+ ⚠️ 方法失败的经过也写进注释，避免后来人重犯
+ 发布前动作：装上 aapt2 → 重跑 dump 并**留档** → 逐条比对 29 条 path
```
⚠️ 这样处理的理由：把"**未登记**"这件事**机械可见**（而不是留一句含糊的"复刻风格"），
   同时**不**把"未登记"偷换成"自绘"（那是无证据的结论）。

---

## 四、状态与边界

```
I1 第 5 类（其它图标来源核实）：**INCONCLUSIVE / 需要工具**（不是"已清"）
  · 已完成的：icons.tsx 的来源状态被如实登记为 UNDOCUMENTED（发布前必须核实）
  · 未完成的：逐条 path 的机械比对（需要 aapt2 或等价 AXML 解码器）
  · ⚠️ 我**没有**宣称"未发现逐字复制" —— 因为方法失败了，宣称那个是不诚实的
I1 其余 4 类：已于 I2/既有轮次登记（见 §一 表）
⚠️ I1 属**发布前置**项；本项目当前未决定公开（PUBLIC_WEB_FRONTEND_DEPLOYMENT:
   NOT REQUIRED FOR CURRENT ANDROID 1:1 SCOPE）⇒ 它不是 M5 体验完成度的阻塞项。
```

**核对过的方法学参数（可复算）**：
```
APK: .mumu-capture/apk/target.apk（176090 KB，sha256 记录在 LICENSING-NOTES.md）
条目数: 2627 个 xml；其中含 "pathData" 字符串的 1136 个
提取方式: unzip -p <apk> <entry> | 正则 /pathData\s*=\s*"([^"]+)"/g
结果: 0 条（方法对 AXML 无效 —— 见 §〇）
```
