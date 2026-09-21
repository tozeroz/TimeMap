# WO#12 计划：UserProfileScreen（他人主页）—— 字段级 inventory 先行

> 时间：2026-09-22 05:42｜Round 262｜依据：审核 50/51/52 的方法（先 inventory、字段级判断、基线核对）
> 状态：**待审核批准**

## 〇、⭐ 先说结论：本单有一个**高严重度的假身份缺陷**（设备实测确认）

```
设备实测（scripts/m5/diagnose-user-profile-identity.mjs）：
  在校园页点第一张卡片的**作者行**「Lemy」（真实用户）
  → 跳到 #/user?id=u%3A22222222-2222-4222-8222-222222222222   （URL **正确**带上了真实 id）
  → 资料页显示：「**蒸柿煮捞呆**」                               ← **完全不同的编造人物**
  → 页面文本："蒸柿煮捞呆 北京交通大学 关注 私信 TA 的动态 · 1 蒸柿煮捞呆 草头娃娃，听说浇水能长草… 128"

根因（源码）：
  app/src/screens/UserProfileScreen.tsx:14
      const user = users[id] ?? users.u1          ← 回落成 mock 的 u1
  而传进来的 id 形如 `u:<uuid>`（app/src/api/client.ts 的 toFeedPost：
      id: p.authorId ? `u:${p.authorId}` : `api:${p.author}`）
  两者**永不可能**匹配 → 必然回落 u1。

为什么这比"显示假数据"更严重：
  用户点真实作者，看到的是**另一个人的名字、资料、动态**——
  这不是"未接线"，而是**编造了一个身份**。与 WO#8 修的"mock id 漏进真实 API"同一类，
  但后果更重（那次是进不去会话；这次是**看错人**）。
```

**另一处设备实测确认的问题**：
```
「私信」按钮 → #/chat?id=t1（**硬编码 mock 会话 id**）
  且 bodyHasInvalid = true —— 进入 WO#9B 为 ChatScreen 设的 "invalid" 状态（0 请求、隐藏 composer）
→ 该入口通向**死路**（用户点了什么也不会发生）
```

## 一、✅ 逐字段 inventory（实测）

### 1.1 现状：整页 mock

```
UserProfileScreen.tsx
  行 4 : import { postsByUser, users } from '../data/mock'      ← **整页读 mock**
  行 14: const user = users[id] ?? users.u1                     ← **假身份回落**（见 §〇）
  行 15: const mine = postsByUser(user.id)                      ← 动态也来自 mock
  行 16: const [followed, setFollowed] = useState(false)         ← 关注是**纯本地假状态**
  行 66: navigate('chat', { id: 't1' })                         ← **硬编码 mock 会话 id**
```

### 1.2 逐字段判定

| field | mock 现状 | 权威来源存在？ | 处置 |
|---|---|---|---|
| 身份（id） | URL 已带真实 `u:<uuid>` | ⚠️ **URL 有，但查表失败** | **必须修**：解析 `u:<uuid>` → 用真实 id 查 |
| 昵称 | `user.name`（mock） | ✅ 有（`users.display_name`） | **接线**（需一个"按 id 查用户"的接口，见 §二） |
| 头像 | `user.avatar`（mock SVG） | ❌ users 无 avatar 列 | **首字占位**（与全局一致） |
| MBTI / 星座 | `user.mbti` / `user.zodiac` | ❌ 无列 | **不渲染**（不造列） |
| 学校 | `user.school` | ❌ schools/campuses 空（同 WO#11） | **不渲染**（HIDE/DEFER） |
| 学院 / 专业 / 年级 | `user.college` / `major` / `grade` | ❌ 无列 | **不渲染** |
| TA 的动态 | `postsByUser(mockId)` | ✅ `GET /api/posts`（可按作者过滤？需确认接口能力） | **接线**（若接口不支持按作者过滤，则用全量过滤，并标注） |
| 动态条数「· N」 | mock | ✅ 可由上面的结果算 | **接线** |
| 关注 | 纯本地 `useState`（**假成功**） | ❌ 无关注关系表/接口 | **必须处理**（同 WO#10 判据：不得留着"点了没反应/假成功"） |
| 私信 | `navigate('chat', { id: 't1' })` | ⚠️ 有真实会话能力，但**需要"我与 TA 的会话"** | 需确认：是否有"按 peer 找/建会话"的接口；若无 → **按 WO#11 的不可用处理**（隐藏或明确不可用） |

## 二、⚠️ 本单的前置未知（需先查清，不能靠猜）

```
① **有没有"按 id 查用户资料"的接口？**
   现有路由（实测）：/api/auth/me（只返回自己）、/api/board-notes/:userId、
   /api/posts（含 author/authorId）、/api/threads（含 peerName）…
   → **没有** GET /api/users/:id。这是本单能不能"接线昵称"的**前提**。
   两种出路：(a) 新增只读接口 GET /api/users/:id（最小字段：id/displayName）
             (b) 不加接口，改为**不显示**他人昵称（明确不可用）——
                 但那样"他人主页"就没有意义了，属重大功能缺口。
   → 需你裁定走哪条（我倾向 (a)，且**只暴露最小身份字段**，与 WO#9B 的 members[] 同一口径）。

② **GET /api/posts 支持按作者过滤吗？**（`?authorId=`）
   若不支持：可拉全量后本地过滤（当前 4 条帖子的规模可行），
   但必须**标注**为"客户端过滤"，并说明规模变大后的风险。

③ **"与我与 TA 的会话"如何解析？**
   /api/threads 返回每个会话的 kind/title/peerName/memberCount ——
   可据 peerName 匹配？但 **peerName 只在 kind='direct' 且有对方时才返回**（WO#8 的实现）。
   更稳的做法是**按 peer 的 userId 匹配**，而 /api/threads **当前不返回 peerId**。
   → 需确认：是否要给 /api/threads 增加 peerId（只读、最小字段）。
   若无 peerId，"私信"无法可靠定位会话 → 只能"不可用"。

④ **原版该屏的基线**：`docs/original-baseline/screens/` 下**没有** user/profile 屏
   （只有 trident-me = 「我的」tab，不是他人主页）。
   → 按纪律 ②：必须**显式记录"该屏无可用基线"**，不做任何一致性主张
     （`ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED`）。
```

## 三、方案（分层）

```
层 1（本单做）：**修假身份 + 接线真实昵称与动态**
  · 解析 `u:<uuid>` / `api:<name>` 两种 id 形态，**不再回落 mock**
    （无法解析时显示明确"用户不存在/不可用"，而不是编一个人）
  · 昵称走权威来源（取决于 §二.① 的裁定）
  · TA 的动态走 GET /api/posts（客户端按 authorId 过滤，并标注）
  · 头像首字占位；MBTI/星座/学校/学院/专业/年级**不渲染**

层 2（本单做）：**处理两处假交互**
  · 「关注」：无关注能力 → 按 WO#10 判据**不渲染**（或明确不可用），不保留假成功
  · 「私信」：取决于 §二.③；能可靠定位会话则接线，否则**不渲染/明确不可用**
```

## 四、Gate（PREFERRED + REQUIRED；按新纪律含"基线逐条核对"层）

```
改前（当前状态，应 FAIL）：
  USER_PROFILE_IDENTITY_FROM_ROUTE   FAIL（点真实作者显示 mock u1「蒸柿煮捞呆」）
  USER_PROFILE_NO_MOCK_IDENTITY      FAIL
  USER_PROFILE_MSGDEST_REACHABLE     FAIL（→ #/chat?id=t1 → invalid 死路）
  USER_PROFILE_NO_FAKE_FOLLOW        FAIL（关注是纯本地假状态）

改后：
  USER_PROFILE_IDENTITY_FROM_ROUTE   显示的人 == 被点作者（设备实测：点「Lemy」→ 显示「Lemy」）
  USER_PROFILE_NO_MOCK_IDENTITY      DOM 里不得出现 mock 专有昵称（复用 WO#10 fixture 的 mockOnlyDisplayNames）
  USER_PROFILE_NO_SOURCELESS_FIELDS  不渲染 MBTI/星座/学校/学院/专业/年级
  USER_PROFILE_AVATAR_PLACEHOLDER    头像为首字占位
  USER_PROFILE_MSGDEST_REACHABLE     「私信」要么通向**真实会话**，要么**不存在**（不得通向 invalid）
  USER_PROFILE_NO_FAKE_FOLLOW        不存在纯本地假成功的「关注」
  USER_PROFILE_NO_FAKE_AUTHORITATIVE_NUMBERS  不得出现编造的统计数字
基线核对：
  ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED（**该屏无原版基线** —— 显式记录，不得跳过）
回归：WO#11 feed / WO#10 message / WO#8 会话列表 / WO#9A 群聊 / WO#9B 层A / WO#7 发送
     + server gate（先部署 + sha256 + 账本）
敏感度：
  · 把回落改回 `?? users.u1` → USER_PROFILE_IDENTITY_FROM_ROUTE 必须 FAIL；恢复 → PASS
  · 把私信改回 `id: 't1'` → USER_PROFILE_MSGDEST_REACHABLE 必须 FAIL；恢复 → PASS
前置：VISUAL_TARGET_VALIDITY / ARTIFACT_PROVENANCE / API_E2E_ORIGIN_VALIDITY
类型：scripts/m5/check-types.sh 必须 PASS（真实叶子配置）
```

## 五、需要审核裁定

```
1. **严重度排序**：本单发现的"点真实作者显示编造人物"是否需要**插队**到 UserProfileScreen 之外
   （例如先单独出一个 P0 小单只修身份解析），还是并入本单一起？
   我倾向并入本单 —— 因为它与本屏的其它问题是同一处的连锁（都源于"整页 mock + 回落"）。
2. §二.① 是否允许**新增只读接口 `GET /api/users/:id`**（最小字段 id/displayName，成员/公开口径待定）？
   若不新增，则"他人主页"只剩头像占位 + 动态，昵称无法显示 —— 请指出你希望怎么处理。
3. §二.③ 是否允许给 **GET /api/threads 增加 `peerId`**（只读最小字段），以便"私信"可靠定位会话？
   若不允许，"私信"按"无可靠目的地 → 不渲染"处理，对吗？
4. §二.④ 该屏**无原版基线**，我按纪律显式记为 NOT_EVALUATED、不做一致性主张 —— 认可吗？
```
