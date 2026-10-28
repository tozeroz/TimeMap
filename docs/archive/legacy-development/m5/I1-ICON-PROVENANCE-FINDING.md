# I1 发布前 IP 清查（第一刀：图标来源核实）

> 时间：2026-09-23 04:42（Round 319）｜**最终结论：已核实完成**（含两次失败方法的记录）
> 依据：NEXT-ACTIONS 的 I1 条 —— 逐一核对 5 类"逐字复制自第三方 APK"的资产，
> 决定 保留／替换为自绘等价物／移除。本条聚焦其**第 5 类**：
> "`app/src/**` **其它**『按原版截图/资源复刻』的图标（**需逐个核对来源**）"

---

## 〇、最终结论（先说结果）

```
用 aapt2 对原版 APK 做了**全量矢量 path 比对**，且**自检通过**：

  脚本：scripts/m5/i1-icon-provenance-aapt2.mjs
        （结果归档 docs/archive/legacy-development/m5/i1-icon-provenance-result.json）

  ① aapt2 dump resources target.apk  ⇒ 2626 个 xml 资源
  ② 逐个 aapt2 dump xmltree          ⇒ 1136 个含 pathData；**去重后 1831 条**原版矢量 path
  ③ 与我们图标文件的 path 逐字比对：
       · icons.tsx      候选 30 条 ⇒ **命中 0 条**
       · icons-send.tsx 候选  3 条 ⇒ **命中 2 条**（资源 `res/JA.xml`）✅ 与其自述一致
  ④ **方法自检：PASS**（已知被复制的 icons-send 必须 ≥1 命中 —— 它命中了 2 条）

⇒ 结论：
   · `icons-send.tsx`：**确已逐字复制**自 `res/JA.xml` ⇒ 已有的
     `ASSET_ORIGIN: COPIED_FROM_THIRD_PARTY_APK` 标记**被机械验证为正确**
   · `icons.tsx`：**未发现逐字复制的矢量 path** ⇒ 已在代码头部写明
     `ASSET_ORIGIN: ORIGINAL_WORK` + **方法、自检、边界**（见该文件注释）
```

### ⚠️ 本结论的边界（必须随结论一起引用）
```
· 规范化比对忽略空白/逗号 ⇒ "命中"= 几何写法一致，不保证字节一致；
  "未命中" ⇒ 不存在**规范化后逐字相同**的 path
· 只覆盖 `<path pathData=...>`；**位图资源（PNG/WebP）不在内**
· 我们若用非 SVG 画法（canvas 等）不在覆盖内
· ⇒ 证明的是"**未发现逐字复制的矢量 path**"，**不是**"绝无任何派生关系"：
  形状相似但改过坐标（例如按截图临摹后微调）**不会被本法发现**
```

---

## 一、⚠️ 为什么我**前两次**的"0 匹配"不可信（这段必须留着）

这种"看似干净、实则仪器没工作"的结果，是本项目**最容易自我欺骗**的地方。两次失败：

```
【第一次】unzip + 明文正则抓 pathData
  结果："含 pathData 的 1136 个文件，但**一条值都取不到**"
  根因：APK 里 vector drawable 被编译成 **AXML 二进制**（值走字符串池 + 索引引用）
  ⚠️ 当时我差点把它读成"我们干净"（幸好"1136 个文件里有值 0 条"这个自相矛盾太刺眼）

【第二次】改用正解 aapt2，但我的资源表正则写错
  我以为资源表是 `-> res/xxx.xml`，实际是 `() (file) res/xxx.xml type=XML`
  ⇒ 命中 0 个资源 ⇒ 整条比对链空转 ⇒ **又是 0 命中**
  ⭐ 这次是**我加的第 ④ 步自检**把它抓出来的：
     "icons-send 已知是复制的 ⇒ 必须 ≥1 命中" ⇒ 自检 **FAIL** ⇒ 我知道仪器没工作

【第三次】修正正则 + 跑全量（2626 个资源）
  ⇒ 自检 **PASS**（icons-send 命中 2 条，正是那两条 path）⇒ 这一次的"0"才是证据
```

### ⭐ 由此得到的一条可复用纪律（我认为比本次结论更重要）
```
**任何"未发现 X"的结论，都必须先证明"仪器能发现 X"。**
做法：在脚本里放一个**已知阳性的样本**（这里是 icons-send，
      已知它复制自 res/JA.xml），要求它**必须被检出**。
若它没被检出 ⇒ 结论只能是 INCONCLUSIVE，**不得**报"未发现"。
⚠️ 这与本项目此前学到的"验证产物、不要验证日志""测量≠解释"是同一条线的延伸。
```

---

## 二、逐项核实表

| 资产 | 现状 | 判定 |
|---|---|---|
| `app/src/components/icons-send.tsx` | 2 条 path **机械比对命中** `res/JA.xml` | ✅ **已登记且已被验证** |
| `app/src/components/icons.tsx`（30 条 path） | 与 APK 的 1831 条矢量 path 逐字比对 **0 命中** | ✅ **`ORIGINAL_WORK`**（附方法/自检/边界） |
| `docs/test/original-baseline/supplements/original-emoji-*` | 已登记于 `LICENSING-NOTES.md` 第 2 项（APK 内的表情 drawable 名如 weixiao/daxiao/… 亦见于资源表） | ✅ 已登记 |
| `docs/test/original-baseline/screens/`、`raw-dumps/` | 已登记第 3 项 | ✅ 已登记 |
| `.mumu-capture/apk/target.apk` | 已登记第 4 项；**未被 git 跟踪** | ✅ 已登记且未入库 |

---

## 三、顺带修正的一个**取证可复算性**问题

```
侧记：`icons-send.tsx` 引用 `aapt2 dump xmltree --file res/JA.xml <apk>` 作为取证方法，
      但该命令的**产物从未留档** ⇒ 此前那条取证其实是"**不可复算**"的
      （本项目曾因同类记录吃过大亏：message-board 的"原版恰好 7 个表情"就是一条
        不可复算的旧记录，曾导致实现被改错，后来靠可复算 dump 才纠正回 6 个）。
⇒ 本轮**已补上**：把比对结果归档进仓库
   `docs/archive/legacy-development/m5/i1-icon-provenance-result.json`（含方法、计数、自检结论、命中明细）
   ⚠️ 刻意**不**把 APK 的 1831 条 path 落盘（那等于把第三方资源搬进仓库）；
      要复算只需重跑脚本 `scripts/m5/i1-icon-provenance-aapt2.mjs`（需 APK 在场）。
```

---

## 四、发布的处置建议（供 Owner 参考；本条属**发布前置**）

```
· `icons-send.tsx` 的 2 条 path 是**逐字复制**自第三方 ⇒ 若公开/商业发布，
  直接使用可能涉版权/许可 ⇒ 建议按 I3 做"视觉等价但非直接复制"的重绘
  （该文件已标 `PUBLICATION_BLOCKER: LICENSE_REVIEW_REQUIRED`）
· `icons.tsx` 经机械核实未发现逐字复制 ⇒ **暂无已知来源问题**
  ⚠️ 但"临摹后微调"型相似**不在本法覆盖内** ⇒ 若追求绝对稳妥，仍可一并重绘
· ⚠️ 本项目当前**未决定公开**（PUBLIC_WEB_FRONTEND_DEPLOYMENT:
  NOT REQUIRED FOR CURRENT ANDROID SCOPE）⇒ 上述**不阻塞 M5 体验完成度**
```

**核对过的方法学参数（可复算）**
```
APK: .mumu-capture/apk/target.apk（176090 KB；sha256 见 LICENSING-NOTES.md）
aapt2: G:\android-sdk\build-tools\35.0.0\aapt2.exe
      （位置来自 app/android/local.properties 的 sdk.dir —— 我一开始没找到，
        是因为只在 PATH/环境变量里搜，**忘了 Gradle 用的是 sdk.dir**）
xml 资源 2626 个；含 pathData 1136 个；去重 pathData 1831 条；自检 PASS
```
