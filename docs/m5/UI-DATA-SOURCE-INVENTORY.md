# UI → 权威数据源清单（mock 驱动面盘点）

> 建立于 2026-09-22（审核记录 44 要求："这份源码审计应该形成一个 UI→authoritative-data-source
> inventory，后续挑工作单时优先检查'高频页面仍由 mock 驱动'的项目"）
>
> **用途**：挑下一个工作单时，优先看"高频页面仍是 mock"的条目。
> 不是要求一口气全部接线 —— 而是让"哪些用户可见数据是假的"**始终可见**，
> 否则同一个问题会在 FeedList / Map / UserProfile 等页面重复出现。

## 一、盘点方法（可复现）

```bash
# 每个屏幕是否引用 mock 数据 / 是否引用 api
for f in app/src/screens/*.tsx; do
  m=$(grep -c "from '\.\./data/mock'" "$f" || true)
  a=$(grep -c "from '\.\./api/" "$f" || true)
  printf '%-32s mock=%s api=%s\n' "$(basename $f)" "$m" "$a"
done
```

## 二、当前状态（2026-09-22，WO#8 之后）

| 屏幕 | 数据源 | 状态 |
|---|---|---|
| ChatScreen | api | ✅ 全真实 |
| FeedDetailScreen | api | ✅ 全真实 |
| LoginScreen | api | ✅ 全真实 |
| PoiDetailScreen | api | ✅ 全真实 |
| PublishScreen | api | ✅ 全真实 |
| **MessageScreen** | **api + 分区 mock** | ⚠️ **会话列表已接真实后端（WO#8）**；邀请卡的学校/学院/年级/头像、更多同学+好友申请 仍是 mock → `MOCK_NOT_WIRED` |
| BoardScreen | api + mock | ⚠️ 混合（留言板已接真实；仍有 mock 残留，待盘点具体区块） |
| CampusScreen | api + mock | ⚠️ 混合（动态已接真实；头部卡片等仍 mock） |
| MeScreen | api + mock | ⚠️ 混合（登录态真实；资料字段 mock） |
| **GroupChatScreen** | mock | ❌ **纯 mock** → WO#9A（群聊垂直切片） |
| **FeedListScreen** | mock | ❌ **纯 mock**（高频：动态列表） |
| **MapScreen** | mock | ❌ **纯 mock**（高频：地图；真实定位已在别处实现，见 AUDIT 附六） |
| **UserProfileScreen** | mock | ❌ 纯 mock（高频：看别人主页） |
| **CommentsScreen** | mock | ❌ 纯 mock |
| **PoiSearchScreen** | mock | ❌ 纯 mock |
| **ProfileEditScreen** | mock | ❌ 纯 mock（**注意：这里是"写"路径**） |
| **MediaPreviewScreen** | mock | ❌ 纯 mock |
| **ScannerScreen** | mock | ❌ 纯 mock |
| **UpgradeDialog** | mock | ❌ 纯 mock |
| AnnounceScreen / DailyScreen / DrawerPages / LoginSelectScreen / MoreScreen / OnboardingScreen / SimpleScreen | 无数据 | —— 静态页，不涉及 |

**统计**：26 屏 → 纯 api 5 ／ 分区或混合 4（含 MessageScreen）／ **纯 mock 10** ／ 静态 7

## 三、优先级建议（按"高频 + 用户可感知 + 修法明确"排）

```
P1  GroupChatScreen   → WO#9A（群聊垂直切片；后端无 group 会话，属缺失的 conformance capability）
P2  FeedListScreen    → 动态列表纯 mock：打开 App 第一眼就能看到假数据
P3  UserProfileScreen → 从动态点进作者主页看的是假资料（与真实动态数据矛盾）
P4  MapScreen         → 地图点位纯 mock
P5  其余（Comments / PoiSearch / ProfileEdit / MediaPreview / Scanner / Upgrade）
```

**⚠️ 特别标注**：`ProfileEditScreen` 是**写路径**（改资料）却纯 mock ——
它比只读页面更危险（用户以为改成功了，实际什么都没发生）。
虽然它不涉及第三方 App（是我们自己的 demo），但**假成功**与本次修掉的
"mock id 漏进真实 API"属同一类问题。建议在 P1/P2 之后优先处理。

## 四、维护规则（写死，避免清单过期）

```
1. 新增屏幕时：必须在此表登记它的数据源
2. 把某屏从 mock 接成真实时：更新本表该行，并在对应 WO 里记录
3. 若某区块仍是 mock 且**以真实业务数据的样子暴露给用户**：
   必须二选一（审核记录 44）——
     (a) 隐藏/禁用该区块，或
     (b) 另立接线单，并在本表 + NEXT-ACTIONS 登记
   **不允许**只写一句"这是 mock"就放过去
4. 不要为了"过 Gate"在正式 UI 上到处加"这是 mock"的可见标签 ——
   那本身会制造新的 1:1 偏差（审核记录 44）
```

## 五、机器可读快照（由 scripts/m5/ui-data-source-inventory.mjs --write 生成）

<!-- BEGIN:MACHINE-SNAPSHOT -->
扫描范围：app/src/screens（26 个文件）
统计：api-only=13 ／ mock+api=1 ／ mock-only=5 ／ types-only=0 ／ none=7

| AnnounceScreen.tsx | none | — | — | — |
| BoardScreen.tsx | mock+api | boardEmojis | — | getBoardNotes, postBoardNote, relativeTime |
| CampusScreen.tsx | api-only | — | FeedPost | isLoggedIn, likePost, listPosts, listSchoolCampuses, listSchools, readSnapshot, toFeedPost, unlikePost |
| ChatScreen.tsx | api-only | — | — | fetchMediaBlobUrl, getSession, getThread, getThreadMessages, postThreadImageMessage, postThreadTextMessage, postThreadVoiceMessage, relativeTime, uploadMedia |
| CommentsScreen.tsx | mock-only | comments, posts | — | — |
| DailyScreen.tsx | none | — | — | — |
| DrawerPages.tsx | none | — | — | — |
| FeedDetailScreen.tsx | api-only | — | — | avatarFor, createComment, getComments, getPost, isLoggedIn, likePost, mediaUrl, readSnapshot, relativeTime, unlikePost |
| FeedListScreen.tsx | api-only | — | FeedPost | listPosts, readSnapshot, toFeedPost |
| LoginScreen.tsx | api-only | — | — | requestLoginCode, verifyLoginCode |
| LoginSelectScreen.tsx | none | — | — | — |
| MapScreen.tsx | api-only | — | — | listPosts, mediaUrl |
| MeScreen.tsx | api-only | — | — | logout, me |
| MediaPreviewScreen.tsx | mock-only | posts | — | — |
| MessageScreen.tsx | api-only | — | — | getSession, getThreads, relativeTime |
| MoreScreen.tsx | none | — | — | — |
| OnboardingScreen.tsx | none | — | — | — |
| PoiDetailScreen.tsx | api-only | — | — | avatarFor, getPlace, relativeTime |
| PoiSearchScreen.tsx | mock-only | pois | — | — |
| ProfileEditScreen.tsx | api-only | — | — | me, patchMyDisplayName, updateSessionUser |
| PublishScreen.tsx | api-only | — | — | createPost, toFeedPost |
| ScannerScreen.tsx | mock-only | scannerHints | — | — |
| SchoolSearchScreen.tsx | api-only | — | — | listSchoolCampuses, listSchools |
| SimpleScreen.tsx | none | — | — | — |
| UpgradeDialog.tsx | mock-only | upgradeInfo | — | — |
| UserProfileScreen.tsx | api-only | — | FeedPost | getThreads, getUser, listPosts, toFeedPost |
<!-- END:MACHINE-SNAPSHOT -->
