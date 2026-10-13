# A5 定点视觉/语义 fidelity closeout（第一轮切片）

> 依据：审核 65 的 A5 口径 ——
> "可机械量化（色相/bbox/几何/ROI/颜色族）⇒ 用**现有** pixel analyzer 收敛；
>  真正需要语义判断的**少数**截图 ⇒ 上传到审核会话做定点核对；
>  非关键/非默认 fallback ⇒ 保留 known limitation。
>  ⚠️ **不**建设新 vision 基础设施；但**不能**无限全挂 NOT_EVALUATED 后宣布完成。"
> ⚠️ 并遵循审核 66："**不再开启新的 Gate/方法学专项**" ⇒ 本轮只做**切片**，不铺开成全量工程。
> 时间：2026-09-23 03:46（Round 319）

---

## 〇、为何从"文字"而不是"像素"入手

```
现有可用的机械工具：scripts/m5/analyze-baseline-pixels.py（只测量颜色/几何，不解释语义）
   + selftest-pixel-analyzer.py（它自己也做了自测，纪律已在）
但像素比对需要**我们自己的同尺寸截图**且要处理主题/字体/渲染差异 —— 而本轮更硬、更省的入口是：

⭐ Round 261 的 `FIDELITY-GAP-AUDIT-closed-screens-vs-baseline.md` 做的是**基线逐条文本核对**
   （title / interactions / navigation），而它**只覆盖了 4 个屏**
   （feed-list / message / group / at-panel），**其余 20 个屏从未做过这种核对**。
   ⇒ 这是**覆盖缺口**，而且是**机械可查**的 ⇒ 作为 A5 的第一刀。
   ⇒ 事实也证明它值得先做：**第一刀就抓到 3 处真实偏差**（见 §二）。
```

## 一、做了什么（两个切片，第二个修正了第一个的判据）

### 1.1 切片 v1：拿基线 `title` 去搜源码 —— **判据错，已自我纠正**
```
结果：22 个屏里 11 个 NEEDS_HUMAN
⚠️ 复核后发现**判据错**：基线 `title` 很多是**屏幕的描述**，不是屏上文字：
   「校园广场（主容器默认 tab）」「地图页（底部 tab 3）」「登录（选择方式）」
   「发布（相机）」「新手引导（昵称）」…… 这些**本来就不该出现在屏上**。
⇒ 那 11 个里大部分是**我的判据错**，不是实现错。
  （与项目既有教训同型：**"我最初的判断"不是证据**。）
```

### 1.2 切片 v2（更贴近证据）：拿 `interactions`/`navigation` 里**被「」明确引用**的字符串去搜
```
脚本：scripts/m5/a5-quoted-text-crosscheck.mjs（输出 tools/tmp/a5-quoted-crosscheck.json）
结果：22 个屏｜抽到屏上文字 **30 条**：**FOUND 17 ／ CLUE 8 ／ NEEDS_HUMAN 5**
```
**⚠️ 判据的边界（必须随结论一起引用）**：
```
· 只做**字符串搜索** —— FOUND ≠ 渲染位置/样式正确；NEEDS_HUMAN ≠ 一定是偏差
· 「」抽取依赖基线作者的引用习惯；未被「」引用的屏上文字**不在**本切片覆盖内
· 只覆盖"文字是否存在"这一类；**布局/颜色/间距/字体不在此列**
```

## 二、⭐ CLUE / NEEDS_HUMAN 的逐条判读（不把组合写法当缺陷）

**8 条 CLUE —— 判读后**全部**不是**缺陷**（都是"组合写法"造成的）：
```
「北京交通大学 ▼」「校园广场 ▼」  → 基线把"校名 + ▼"写成一个引用串；
                                    我们是两个元素（校名 + chevron 图标）⇒ 字符串不可能整体命中 ✅
「我的兴趣 ›」「我的标签 ›」「介绍一下自己～ ›」「我的学校 ›」
                                  → 同上（标签 + chevron） ✅
「就这样」（onboarding 按钮）／「确认」（通用词） → 子串命中于对应文件，人工确认存在 ✅
```

**5 条 NEEDS_HUMAN —— 判读后 2 条是"按设计不可匹配"、3 条是真问题**：
```
✅ 不是缺陷：publish 「📍<地点名> ×」      含**占位符** ⟨地点名⟩ ⇒ 字符串搜索按设计匹配不到
✅ 不是缺陷：trident-me 「我的兴趣/标签/学校」 用斜杠**合并描述**多个控件，非字面 UI 文本
⚠️ 【真问题 1】announce 「校园活动」       见 §三 ①
⚠️ 【真问题 2】scanner 「请将二维码对准扫码框中心」/「我的二维码」  见 §三 ②
```

## 三、本轮 A5 查出并修掉的 3 处**真实**偏差

### ① `announce`（群公告）—— ⭐ 标题不符 + **编造内容**
```
原版基线（observed）：
   interactions = ["顶部标题「校园活动」+ 左上返回", "**内容区为空**"]
   navigation   = ["返回 → 上一页"]
改前我们：
   center="校园公告"                ← ① 标题不符（原文「校园活动」）
   const ANNOUNCEMENTS = [ 3 条 ]    ← ② 基线明写"内容区为空"，我们却渲染 **3 条编造公告**
     （"校园广场内容规范更新"/"图书馆四楼自习区开放时间调整"/"新生校园卡领取提醒" + 正文 + 时间，**全部无出处**）
   左上 IconBack + aria-label="返回" ← ③ 与基线"左上返回"**相符** ✓
⚠️ 这条偏差**从未被核对过**（Round 261 只查了 4 个屏）
⇒ 已修：标题 →「校园活动」；删除 3 条编造公告 → 如实空态「暂无内容」
⇒ 门禁 `gate-announce-baseline.mjs`：**4 键全 PASS**
   ```
   ANNOUNCE_TITLE_MATCHES_BASELINE  ／ ANNOUNCE_NO_FABRICATED_CONTENT（5 条特征串 + DOM 条数）
   ANNOUNCE_EMPTY_STATE_PRESENT     ／ ANNOUNCE_BACK_LEFT
   实测：center="校园活动" ／ itemCount=0 ／ backLabel="返回" ／ 走**真实入口**（更多→校园公告）
   ```
术语口径：`ANNOUNCE_LIST_CONTENT: NOT_EVALUATED`（原版观察到的是"空"；
           **有公告时**渲染成什么样**未观察**，需原版账号在该群里有公告 ⇒ 另一个状态的观察）
```

### ② `scanner`（扫码页）—— 2 条文案缺失是**我有意为之**，如实登记为取舍
```
基线声明了「请将二维码对准扫码框中心」「我的二维码」——**确实不存在于**我们的实现里。
⚠️ 但这是**有意**的：原版这两句的**前提**是"有可用的扫码器"，
   而我们 `SCANNER_FUNCTIONALITY: NOT_IMPLEMENTED`（无摄像头扫码能力）。
   保留它们 = 让 UI 声称一个不存在的能力 ⇒ 属"编造 UI"。
⇒ 处置：**不**为对齐文字而恢复假文案；登记为 `SCANNER_FUNCTIONALITY: NOT_IMPLEMENTED`
   （本项已由审核 66 的 `SCANNER_ENTRY_RESTORATION` 约束覆盖：只能写 `SCANNER_ENTRY_FIDELITY: PASS`，
     **不可**写 `SCANNER_EXPERIENCE: PASS`）。
```

### ③ ⭐ "界面陈述与事实不符"（两处，含一处**编造版本号**）
```
· MoreScreen 页脚：「Campus demo · **数据全部本地 mock** · **无任何网络请求**」
    ⇒ **早已不成立**：应用现在处处走自建后端 API，mock.ts 也已整体退出现代代码
· DrawerPages 的 AboutScreen（版本信息）：
    ①②`<div className="dpcard__version">v2.10.0</div>` —— **编造的版本号**（无出处）
       ⚠️ 24 个基线目录里**没有**本屏 ⇒ 原版「版本信息」页内容**从未被观察**
    ② 「本 demo 为本地复刻版本，**数据全部为 mock，无任何网络请求**。」—— 同上，不成立
⇒ 处置：两处都改为如实描述；AboutScreen 也**删掉编造版本号**（改「版本信息不可用」）
术语口径：`ORIGINAL_VERSION_INFO_PAGE: NOT_EVALUATED`
⚠️ 教训（写进代码注释）：**界面陈述会随时间变成假话** ⇒
   不要在 UI 里写"全部/无/纯"这类**绝对化断言**。
```

## 四、验证与状态

```
· tsc（app）PASS；构建 + 安装成功
· gate-announce-baseline：4 键全 PASS（DEVICE_GATE_EXIT=0）
· 回归：announce ／ wo14 ／ scanner ／ wo20 → 全 DEVICE_GATE_EXIT=0
```

## 五、留给最终裁定 / 后续（**不**在本轮铺开）

```
· 切片 v2 的 FOUND 17 条只证明"文字存在"，**未**证明渲染位置/样式 ⇒ 若口径要求严格 1:1，
  仍需像素级核对（用现有 analyze-baseline-pixels.py；需要"我们自己的同尺寸截图"这一步）
· 未覆盖：**布局/颜色/间距/字体**（像素层）；**未被「」引用**的屏上文字
· known limitation（按审核 65 口径保留）：
    - 原版扫码目标页/流程：BLOCKED_BY_POLICY（相机权限 + 可能业务写入）
    - 原版 media-preview 呈现：BLOCKED_BY_POLICY（真实入口是聊天图片，造数据=写操作）
    - F-004 认证页 picker ／ F-005 ／ F-006：见 FIDELITY-CLOSEOUT-BACKLOG.md
```
