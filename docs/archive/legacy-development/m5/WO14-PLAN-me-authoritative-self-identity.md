# WO#14 计划：MeScreen 权威自身身份（`WO14_ME_AUTHORITATIVE_SELF_IDENTITY`）

> 时间：2026-09-22 07:30｜Round 264｜依据：审核记录 55
> 「建议下一单：WO14_ME_AUTHORITATIVE_SELF_IDENTITY … **仍然先 inventory，而不是直接改**」
> 状态：**inventory 已完成；实施待批准**

## 〇、⭐ 结论先行：同一块屏幕上**同时显示两个不同的身份**

设备实测（`scripts/m5/diagnose-wo14-me-identity.mjs`，走真实路径）：

```
「我的」页 DOM 实测：
  centerName = "自定义名称6"                      ← 来自 mock（app/src/data/mock.ts 的 me.name）
  authWho    = "已登录 Lemy · +8613800000002"     ← 来自**权威** session.user.displayName
  avatar     = <img src="data:image/svg+xml;…">   ← mock 生成的 SVG 头像

判定（改前，全部 FAIL）：
  ME_DISPLAY_NAME_CONSISTENCY        FAIL  ← 中间大名字与下方登录行**不是同一个人**
  PROFILE_EDIT_TO_ME_CONTINUITY      FAIL  ← 改完昵称后中心名与登录行**都不跟随**
  NO_MOCK_SELF_IDENTITY              FAIL  ← 中心名字仍是 mock 的「自定义名称6」
  ME_AVATAR_PLACEHOLDER              FAIL  ← 仍是 mock 生成的 <img>
```

**为什么这比"某处显示假数据"更严重**：这不是"两个页面不一致"，而是
**同一屏上两个身份并存** —— 用户抬头看到「自定义名称6」，低头看到「已登录 Lemy」。
审核 55 预判的"跨页面 identity inconsistency"实际以**更直接的形式**成立：**同屏自相矛盾**。

## 一、根因（两处**互相独立**的缺陷，不是一个）

```
① 中心名字/头像走 mock（源码）
   app/src/screens/MeScreen.tsx:74   <h2 className="me__name">{me.name}</h2>
   app/src/screens/MeScreen.tsx:73   <img className="me__avatar" src={me.avatar} />
   app/src/data/mock.ts 的 me = { id:'u_me', name:'自定义名称6', avatar: avatar('我',…),
                                  school/mbti/zodiac/college/major/grade … }
   → 这些字段**都没有权威来源**（users 表只有 display_name；其余无列）

② 登录行读了**陈旧缓存**（行为）
   app/src/api/session.ts 的 getSession() 有**模块级 cache**：
       if (cache === undefined) cache = parse(localStorage.getItem(KEY))
   MeScreen 用 `useState(() => getSession())` **只在挂载时读一次**。
   而 WO#13 的 PATCH 成功后，**没有任何代码把新 displayName 写回 session 缓存**。
   → 实测：改名前 cachedName == serverName == "Lemy"（缓存原本是同步的）；
          改名后回到「我的」，登录行**仍显示 Lemy**（旧缓存），
          而服务端此时已是新值 —— 即 `PATCH` 只改了库，**没改客户端会话缓存**。
   ⚠️ 这一条与 mock 无关，**即使把中心名字接上权威来源**，
      只要不修缓存同步，登录行仍会滞后 —— 两个缺陷必须**分别**修。
```

## 二、逐字段 inventory（审核 55 要求的形式）

| field | current source | /api/auth/me 有权威来源？ | 处置 |
|---|---|---|---|
| 显示名（中心大字） | **mock** `me.name` = 自定义名称6 | ✅ `displayName` | **wire**（走权威） |
| 显示名（登录行） | session 缓存 `user.displayName` | ✅ 同一字段 | **wire 到新鲜读取**（修缓存同步） |
| 头像（中心） | **mock** `avatar('我',…)` → SVG data URI | ❌ users 无 avatar 列 | **首字 placeholder**（与 WO#12/#13 同一冻结；**不加列**） |
| school / mbti / zodiac / college / major / grade | mock（中心头像旁未渲染，但 mock 对象里有） | ❌ 无列 | **不渲染**（本就未渲染；确保不被"顺手接上"） |
| 手机号（登录行） | session `user.phone` | ✅ `/api/auth/me` 返回 phone | 现状保留（**注意**：那是"自己的"手机号，可显示；且已有 `me__authWho`） |
| 「我的兴趣/我的标签/介绍一下自己～/我的学校」 | 已按 WO#13 改为**不可点 + 待核对** | — | 本次**不动**（审核 54 已冻结；目的地 NOT_EVALUATED） |
| 「编辑资料」 | → ProfileEditScreen | 有基线 | **不动** |

**reload / relogin 语义**（审核 55 明确要求查）：
```
· 冷启动：localStorage 有 session → MeScreen 挂载即读缓存 → 显示缓存里的 displayName
· 重新进入 #/me：React 组件重挂载 → 重新 getSession()（仍读**同一缓存**）
· 退出登录再登录：logout() → clearSession()；再登录会 setSession(新值) → **此路径下是准的**
  ⇒ 只有"改资料"这条路径会留下陈旧缓存
```

**ProfileEdit 修改后是否同步**：❌ **不同步**（实测，见 §一 ②）。

## 三、方案（待批准）

```
层 1  显示名走权威（两处**都**要）
  · 中心大字 + 登录行统一由**同一个**权威值渲染（避免再次出现"同屏两个身份"）
  · 权威来源：`GET /api/auth/me`（返回 displayName + phone；已存在，无需新接口）
  · 未登录 / 读不到 → 明确不可用态，**不回落 mock**（与 WO#12/#13 同一纪律）

层 1b 会话缓存同步（独立的第二个缺陷）
  · ProfileEdit 的 PATCH 成功后，把**服务端返回值**写回 session（新增一个
    `updateSessionUser({displayName})` 之类的窄接口，而不是让页面各自 setItem）
  · 这样 MeScreen 无论走缓存还是重新读取，看到的都一致
  · ⚠️ 不做"全局事件总线"这类过度设计 —— 只补一个窄函数

层 2  头像改**首字占位**（与 WO#12/#13 一致）；**不加列**
  · 「拍下眼前的风景」「我的第一条语音」「三横线抽屉」等**一律不动**

层 3  基线
  · ORIGINAL_ME_SELF_IDENTITY: 无基线（trident-me 只记了入口文案与位置，
    未记"个人页自身上显示什么名字"）→ 记 NOT_EVALUATED，**不做一致性主张**
```

## 四、Gate（草案；含审核 55 指定的 5 条 + 检测性设计）

```
改前（当前状态，应 FAIL）—— 已在 §〇 实测到 4 条 FAIL：
  ME_DISPLAY_NAME_CONSISTENCY     FAIL（同屏两个身份）
  PROFILE_EDIT_TO_ME_CONTINUITY   FAIL（改完不跟随）
  NO_MOCK_SELF_IDENTITY           FAIL（中心名仍是 mock）
  ME_AVATAR_PLACEHOLDER           FAIL（mock SVG）

改后（新增/收紧）：
  ME_IDENTITY_FROM_SESSION        中心显示名 == `GET /api/auth/me` 的 displayName（权威）
  ME_DISPLAY_NAME_CONSISTENCY     **同屏两处身份必须一致**（中心大字与登录行逐字相同）
  PROFILE_EDIT_TO_ME_CONTINUITY   ProfileEdit 改昵称 → 回「我的」**中心与登录行都跟随**
  ME_AVATAR_PLACEHOLDER           头像是首字占位（`data-me-avatar-placeholder`），不是 mock <img>
  NO_MOCK_SELF_IDENTITY           不得出现 mock 专有昵称（复用 WO#10 fixture 的 mockOnlyDisplayNames）
  ME_NO_FALLBACK_ON_UNAVAILABLE   未登录/读到失败 → 明确不可用，不得回落 mock（与 WO#12 同一原则）
  ORIGINAL_ME_SELF_IDENTITY_CONFORMANCE: NOT_EVALUATED（显式记录）

敏感度（REQUIRED）：
  · 把中心名字改回 `me.name` → NO_MOCK_SELF_IDENTITY 与 ME_DISPLAY_NAME_CONSISTENCY 必须 FAIL
  · 去掉缓存同步（PATCH 后不写回 session）→ PROFILE_EDIT_TO_ME_CONTINUITY 必须 FAIL
    （⭐ 这一条很关键：它证明"接权威来源"与"修缓存同步"是**两个独立**的必要修复）

回归：WO#13 profile-edit ／ WO#12 他人主页 ／ WO#11 feed ／ WO#10 message ／
      WO#8 ／ WO#9A ／ WO#9B层A ／ WO#7 + server gate
前置：VISUAL_TARGET_VALIDITY ／ ARTIFACT_PROVENANCE ／ API_E2E_ORIGIN_VALIDITY ／ Gate 互斥锁
```

## 五、需要批准的裁定点

```
1. 批准本计划？（inventory 已完成，见 §〇/§一/§二）
2. §三层 1b：是否同意**补一个窄函数把 PATCH 结果写回 session 缓存**
   （而不是引入全局状态/事件总线）？我倾向窄函数：改动最小、可机械验证。
3. §二：手机号在「我的」页继续显示（现状如此）—— 那是**自己的**号，
   与"他人主页不暴露 phone"（WO#12 冻结）不冲突。请确认这个区分成立。
4. §三层 3：ORIGINAL_ME_SELF_IDENTITY 记 NOT_EVALUATED（无基线）—— 认可吗？
```
