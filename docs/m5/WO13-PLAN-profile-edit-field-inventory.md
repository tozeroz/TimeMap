# WO#13 计划：ProfileEditScreen（个人资料页）—— 字段级 inventory 先行

> 时间：2026-09-22 06:31｜Round 263｜依据：审核记录 53「WO#12 完成后回到 ProfileEditScreen，
> 那里仍可能存在 **fake write-success** 风险」＋ 本项目 WO#10/#11/#12 的既有方法
> 状态：**待审核批准**

## 〇、⭐ 结论先行：审核 53 的担心**成立**，而且比预想的大

设备/静态证据（全部可复核）：

```
① **假写成功**（用户可达、可见）：ProfileEditScreen 的 saveEdit() 只 setState、**零网络请求**
   源码：app/src/screens/ProfileEditScreen.tsx:34-40 —— saveEdit() 只按 editing 分支 setNickname/setBio/setGender
   用户看到的值**确实变了** → 会以为"改成功了" = 与 WO#10 的假好友申请**完全同类**
   可达性（**5 个入口**，全部来自 MeScreen）：
     app/src/screens/MeScreen.tsx:53 「我的兴趣」→ navigate('profile-edit')
     :57 「我的标签」→ 同上      :66 「编辑资料」→ 同上（带 IconEdit）
     :73 「介绍一下自己～」→ 同上 :77 「我的学校」→ 同上
   → 所以它不是"死代码"，而是**从「我的」页一步可达的主路径**

② **⚠️ 必须分清两件不同的事**（我第一版把它们混了，很容易导致改错对象）：
   ```
   (i) MeScreen 的 **5 个入口**（我的兴趣/我的标签/编辑资料/介绍一下自己～/我的学校）
       全部 navigate('profile-edit')
       → 这 5 个入口是**基线支持的**（trident-me/baseline.json:38 逐字记了这 5 个标签与位置）
       → **不能删**；它们指向同一个页面这一点，暂记为需要核对的细节（原版是否各指不同页？**无基线**）

   (ii) App.tsx 里**另外 5 个静态路由**（:145 interests ／ :158 tags ／ :169 bio ／ :174 school ／ :180 edit-profile）
       实测：全仓递归搜 navigate('interests'|'tags'|'bio'|'school'|'edit-profile') → **零命中**
       → 即**配了路由但无人导航到**（孤儿路由），内容为硬编码假数据
       → 这才是 §三 层 2 要处置的对象
   ```
   其中 App.tsx:177 写着「**12,486 位同学已加入**」——
   ⚠️ **这正是 WO#11 从动态列表页移除的那个编造数字**：它在那里被删掉了，却在这个孤儿路由里**活了下来**。
   （另：mock.ts:502/503/587 也仍有 12,486 / 38,920；FeedListScreen.tsx 里的出现是**注释**，属记录不属实现）

③ **服务端没有任何"改资料"写接口**：无 PATCH/PUT；POST 清单里也没有 profile/settings 类
     （实测 server/src/index.ts 的 app.patch/app.put 零命中）
   → 即"保存"这件事**根本没有落地的能力**
```

## 一、✅ 逐字段 inventory

| 字段/控件 | 现状 | 权威来源存在？ | 处置 |
|---|---|---|---|
| 头像 | `me.avatar`（mock SVG） | ❌ users 无 avatar 列 | **首字占位**（与 WO#12 一致） |
| 「更换头像」相机按钮 | **没有 onClick** → inert 控件 | ❌ 无上传头像能力 | 按 WO#10/12 判据：**不渲染**（不留 inert 控件） |
| 昵称 | `useState(me.name)`，mutable | ✅ users.display_name **可写**（只要有接口） | **接真实写路径**或明确只读（见 §三） |
| 简介 | `useState('介绍一下自己~')` | ❌ users 无 bio 列 | **只读/不渲染**（不造列） |
| 性别 | `useState('编辑性别')` | ❌ users 无 gender 列 | **只读/不渲染** |
| 标签 | `useState([])` + 硬编码 TAG_OPTIONS | ❌ 无标签表 | **只读/不渲染** |
| 校园名片彩色标签 | 硬编码 `['音乐','运动']` | ❌ 无来源 | **只读/不渲染** |
| 学校 | 卡片2（含「未认证」标签 + 推荐说明） | ⚠️ schools/campuses 空、用户未关联（同 WO#11/12） | **不渲染**（HIDE/DEFER） |
| 5 个孤儿路由 | 静态假内容（含 12,486） | ❌ | **处置见 §三** |

## 二、⚠️ 需要先查清的前置未知（不靠猜）

```
① 原版该屏有没有基线？—— **已查清（两条不同层次的答案）**
   ✅ **入口与 5 个入口名**有基线记录：
      docs/original-baseline/screens/trident-me/baseline.json:38
        "用户区：左「我的兴趣 ›」「我的标签 ›」；中间头像+昵称+「编辑资料」；右「介绍一下自己～ ›」「我的学校 ›」"
      ？:42  "「编辑资料」→ 资料编辑页"
      docs/original-interaction-map.md:51  | 编辑资料 | 资料编辑 |
      → 即：**MeScreen 的 5 个入口是基线支持的**（入口名与位置都对得上）。
        ⚠️ 因此 §三"层 2"里**不能**提议删掉这 5 个入口 —— 那是**有基线的结构**，删了才是偏差。
   ❌ **资料编辑页自身的内容**（三张卡片、头像相机、昵称/简介/性别/标签、校园名片、学校卡的未认证标签…）
      **没有**专属基线：docs/original-baseline/screens/ 下没有 profile-edit / 个人资料 目录
      （实测 26 个屏目录中没有它）。
      ⚠️ 且 ProfileEditScreen.tsx:14-18 的注释写着"结构按原版实测：三张卡片…" ——
         这是一条**无落盘基线支撑的结构主张**。按纪律必须**改标为无据**（或补上原始观察记录），
         不能让"按原版实测"这四个字在没有对应 baseline.json 的情况下继续存在。
   → `ORIGINAL_PROFILE_EDIT_BASELINE: UNAVAILABLE`（入口层次有据；**页面内容层次无据**）

   ℹ️ 另：项目自己的清单**早已标注过这页是写路径**
      docs/m5/UI-DATA-SOURCE-INVENTORY.md:40
        | **ProfileEditScreen** | mock | ❌ 纯 mock（**注意：这里是"写"路径**）|
      本单只是把"注意这里有写路径"落实为"那个写是**假的**"。
```

② 昵称到底该不该可写？
   users.display_name **是真实存在的列**，所以"改昵称"是本项目**第一个真正的写能力**。
   两条路：
     (a) 新增写接口 `PATCH /api/users/me`（只允许 displayName）→ **属新增写能力，需你裁定**
     (b) 不改：把昵称改为**只读显示权威值**，并移除"保存"交互
       → 没有假写成功，但"编辑资料"这个入口名就不成立了（需改文案或移除入口）
   我倾向 (a) —— 因为本页的**主要用途就是改资料**，(b) 等于把这个功能整体后撤；
   且用户明确要求 2 说"需要读写上下文的证据改在我们自己的 demo 里造数"，
   即**在我们自己的库上写是允许且被鼓励的**。但这是产品能力决策，**请你定**。

③ 简介/性别/标签要不要**加列**？
   三者都没有列。**我倾向不加**（加列属新数据模型，且原版是否有这些项**无基线**）。
   若你要加，请明确"加哪些列、为什么"，我不擅自扩模型。

④ App.tsx 的 5 个**孤儿路由**怎么处置？（⚠️ 是 §二.②-(ii) 那 5 个，**不是** MeScreen 的 5 个入口）
   三个选项：(a) 删除（无人可达且含编造数据）
            (b) 保留路由但清空编造内容、标 OUR_DESIGN_CHOICE
            (c) 把它们接成真实入口（需要真实数据支撑，目前没有）
   我倾向 (a) 删除 —— 但**删除页面属可见的功能后撤**，须登记到 KNOWN-DEVIATIONS 并**请你批准**。
   无论选哪个，**App.tsx:177 的「12,486 位同学已加入」都必须消失**（它在别处已被判定为编造）。

⑤ ⚠️ **一处无据的结构主张**（我自己发现的，需处理）
   ProfileEditScreen.tsx:14-18 的注释写着"结构按原版实测：三张卡片…"，
   但 docs/original-baseline/screens/ 下**没有**资料编辑页的基线。
   → 按本项目纪律（不得让"实测/一致"这类词在没有落盘证据时存在），该注释必须
     **改标为"无基线支撑/待核"**，或补上原始观察记录。请确认走哪条。
```

## 三、方案（分层；待裁定后实施）

```
层 1（必做，无争议）：**消除假写成功**
  · 昵称走**权威读取**（GET /api/auth/me 已有 displayName；或复用 WO#12 的 /api/users/:id）
  · 若 §二.② 选 (b)：移除"保存"交互 → 页面变只读；并把"编辑资料"入口文案改准确
  · 若 §二.② 选 (a)：保存**真的发请求**（PATCH /api/users/me）→ 成功后以**服务端返回值**更新界面
    （不是用本地 draft 冒充成功）；失败则**停在失败态并保留用户输入**（不静默丢弃）

层 2：**清掉无来源/编造内容**
  · 头像首字占位；移除 inert 的「更换头像」
  · 简介/性别/标签/校园名片/学校：一律不渲染（除非 §二.③/§二.② 裁定要加列）
  · 处置 5 个孤儿路由（含 12,486）

层 3：基线
  · ORIGINAL_PROFILE_EDIT_BASELINE: UNAVAILABLE / CONFORMANCE: NOT_EVALUATED（除非 §二.① 找到那份观察）
```

## 四、Gate（草案；PREFERRED + REQUIRED + 基线层 + 敏感度）

```
改前（当前状态，应 FAIL）：
  PROFILE_EDIT_NO_FAKE_SAVE        FAIL（saveEdit 零请求却改文案）
  PROFILE_EDIT_SAVE_HITS_SERVER    FAIL（fetchDelta=0）
  PROFILE_EDIT_NO_INERT_CONTROLS   FAIL（「更换头像」无 onClick）
  NO_FABRICATED_MEMBER_COUNT       FAIL（App.tsx:177 的 12,486）
  PROFILE_EDIT_NAME_FROM_AUTHORITY FAIL（走 mock me.name）

改后（若选 §二.②(a)）：
  PROFILE_EDIT_SAVE_HITS_SERVER      真发 PATCH；请求体只含 displayName
  PROFILE_EDIT_SAVE_REFLECTS_SERVER  界面显示值 == 服务端返回/再读到的值
  PROFILE_EDIT_SAVE_FAILURE_KEEPS_INPUT  失败时**不静默丢弃**用户输入、且**不显示成功**
  PROFILE_EDIT_NO_FAKE_SUCCESS_ON_FAILURE  受控 stub 失败 → 不得出现"已保存"
  PROFILE_EDIT_NO_INERT_CONTROLS / NO_FABRICATED_MEMBER_COUNT / NO_SOURCELESS_FIELDS
  ORPHAN_PROFILE_ROUTES_DISPOSED   5 个孤儿路由已按裁定处置（且页面里不得再有 12,486）
基线层：ORIGINAL_PROFILE_EDIT_CONFORMANCE: NOT_EVALUATED（显式记录）
敏感度：
  · 把 save 改回"只 setState" → PROFILE_EDIT_SAVE_HITS_SERVER 必须 FAIL
  · 让 PATCH 返回 500 → PROFILE_EDIT_NO_FAKE_SUCCESS_ON_FAILURE 必须 FAIL
回归：WO#12 他人主页 / WO#11 feed / WO#10 message / WO#8 / WO#9A / WO#9B层A / WO#7 + server gate
前置：VISUAL_TARGET_VALIDITY / ARTIFACT_PROVENANCE / API_E2E_ORIGIN_VALIDITY / **Gate 互斥锁**
```

## 五、需要审核裁定

```
1. §二.② 昵称要不要**新增写接口 PATCH /api/users/me**（本项目第一个写能力）？
   选 (a) 接真实写路径 ／ 选 (b) 改为只读并撤掉"编辑资料"入口。
2. §二.③ 简介/性别/标签 要不要**加列**？（我倾向不加，不擅自扩数据模型）
3. §二.④ 5 个孤儿路由：删除 ／ 清空编造内容保留 ／ 接成真实入口？（我倾向删除，需登记后撤）
4. §二.⑤ 那处**无据的结构主张**（ProfileEditScreen.tsx:14-18 的"结构按原版实测"）：
   改标为"无基线支撑/待核"，还是你另有一份观察记录可供我补成正式基线？
5. 严重度：本单的"假写成功"是**从「我的」页一步可达**的，是否也需要**插队**（与 WO#12 同级）？
```
