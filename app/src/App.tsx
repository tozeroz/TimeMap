import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { TabBar, type TabKey } from './components/TabBar'
import { useRoute } from './router'
import { CampusScreen } from './screens/CampusScreen'
import { MeScreen } from './screens/MeScreen'
import { MapScreen } from './screens/MapScreen'
import { FeedDetailScreen } from './screens/FeedDetailScreen'
import { CommentsScreen } from './screens/CommentsScreen'
import { MessageScreen } from './screens/MessageScreen'
import { ChatScreen } from './screens/ChatScreen'
import { BoardScreen } from './screens/BoardScreen'
import { DailyScreen } from './screens/DailyScreen'
import { PoiSearchScreen } from './screens/PoiSearchScreen'
import { PublishScreen } from './screens/PublishScreen'
import { LoginScreen } from './screens/LoginScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { AnnounceScreen } from './screens/AnnounceScreen'
import { FeedListScreen } from './screens/FeedListScreen'
import { PoiDetailScreen } from './screens/PoiDetailScreen'
import { MediaPreviewScreen } from './screens/MediaPreviewScreen'
import { ScannerScreen } from './screens/ScannerScreen'
import { LoginSelectScreen } from './screens/LoginSelectScreen'
import { UpgradeDialog } from './screens/UpgradeDialog'
import { MoreScreen } from './screens/MoreScreen'
import { UserProfileScreen } from './screens/UserProfileScreen'
import { ProfileEditScreen } from './screens/ProfileEditScreen'
import {
  AboutScreen,
  AccountScreen,
  BlacklistScreen,
  ContactScreen,
  PrivacyScreen,
  VerifyScreen,
} from './screens/DrawerPages'
import './styles/pages.css'

const TAB_TITLES: Record<string, string> = {
  me: '自定义名称6',
  campus: '校园广场',
  map: '地图',
}

export default function App() {
  const route = useRoute()
  const [root, param] = route.path.split('/')
  const tab: TabKey | null =
    root === 'me' || root === 'campus' || root === 'map' ? (root as TabKey) : null
  // 深色页面：状态栏需要跟着变暗
  const dark = root === 'scanner' || root === 'media'

  useEffect(() => {
    document.title = TAB_TITLES[root] ?? 'Campus'
  }, [root])

  return (
    <Shell dark={dark}>
      {tab === 'campus' && <CampusScreen />}
      {tab === 'me' && <MeScreen />}
      {tab === 'map' && <MapScreen />}

      {/*
        详情页的 id 取法（M3 Slice 1 修正的真实 bug）：
        之前只读路径段 param，而应用自己的跳转用的是 query：
        `navigate('feed', { id })` → `#/feed?id=<uuid>` → param 永远是 undefined
        → 落到默认值 'p1' → **点任何帖子进去看到的都不是那条帖子**。
        现在两种形式都认：先看 query.id，再看路径段；都没有就传空串，
        由页面显示"未指定"(而不是拿一个 mock 默认值假装成功)。
      */}
      {root === 'feed' && <FeedDetailScreen id={route.query.id ?? param ?? ''} />}
      {root === 'comments' && <CommentsScreen id={route.query.id ?? param ?? ''} />}
      {root === 'message' && <MessageScreen />}
      {/*
        M5 WO#8：会话路由的 id 解析（**修掉一个真实缺陷**）。

        原来这里是：`<ChatScreen id={param ?? 't1'} />`
          · 只读 **param（路径段）**，而应用自己的跳转走的是 **query**
            （`navigate('chat', { id })` → `#/chat?id=<uuid>`）→ 永远取不到 → 落到兜底值
          · 兜底值是 **mock 数据里的会话 id 't1'** —— 它会被当成真实参数
            直接打到 `GET /api/threads/t1/messages`，服务端只能 404
        📌 这与第 64-71 行注释里 M3 为 `feed` 修过的是**同一个 bug**（param vs query），
           只是当时没有把 chat 一起修。

        现在按审核记录 44 冻结的规范解析（**不制造第二套 URL 规范**）：
            CANONICAL:     `#/chat?id=<uuid>`   ← 列表点击产生的形式（Gate 验证这个）
            COMPATIBILITY: `#/chat/<uuid>`      ← 仍可解析（旧链接/深链不失效）
            RESOLUTION:    query.id → path param → ''（missing state，**不发任何请求**）
        ⚠️ 兜底值必须是**空串**，让 ChatScreen 进入 missing 并明确显示「未指定会话」；
           **绝不**再回退到任何 mock id（那是"看起来成功"的假状态）。
      */}
      {root === 'chat' && <ChatScreen id={route.query.id ?? param ?? ''} />}
      {/*
        ⚠️ M5 Round 266 修正：这里原先是
            <BoardScreen peerId={param ?? '22222222-2222-4222-8222-222222222222'} />
        即**硬编码兜底到某个具体用户的 UUID**（种子账号 Lemy 的 id）。两个问题：
          ① 与**所有兄弟路由**不一致 —— feed / comments / chat / poidetail / group 一律是
             `route.query.id ?? param ?? ''`（**空串兜底**），只有 board 是孤例
          ② 实际后果：从抽屉页入口（`navigate('board')`，不带参数）进来时，
             peerId 会变成"我自己的 id" ⇒ 服务端按**自指**处理（留言板是双方语义，
             自指无意义）⇒ **板是空的**。这既掩盖了真实行为，也让人误以为"功能没数据"。
        ⇒ 改为与兄弟路由一致的兜底；由 BoardScreen 显示"未指定留言对象"的**明确不可用态**
          （与 WO#12/#14「不回落、不假装有数据」同一纪律）。
      */}
      {root === 'board' && <BoardScreen peerId={route.query.id ?? param ?? ''} />}
      {root === 'daily' && <DailyScreen />}
      {root === 'poi' && <PoiSearchScreen />}
      {root === 'publish' && <PublishScreen />}
      {root === 'login' && <LoginScreen />}
      {root === 'onboarding' && <OnboardingScreen />}
      {root === 'announce' && <AnnounceScreen />}
      {root === 'feedlist' && <FeedListScreen />}
      {root === 'poidetail' && <PoiDetailScreen id={route.query.id ?? param ?? ''} />}
      {/*
        M5 WO#9A：群聊走**同一个 ChatScreen**，只是换一个头部变体。

        为什么不是另写一个群聊页：审核记录 45 明确要求
        "**不要复制三套发送逻辑**到 GroupChatScreen；尽量复用已经通过 Gate 的消息渲染/composer 能力，
         否则后面 direct/group 很快会产生两套行为"。
        群聊与单聊在**消息读写、composer、媒体鉴权**上完全同构，
        差异只在头部（群名/群头像/右侧入口）。
        → 因此这里传入 variant="group"，由 ChatScreen 切换头部，
          消息列表与 composer 全部复用同一份实现（WO#2/WO#5/WO#7 的 Gate 因此继续对群聊生效）。

        id 的解析与 direct 完全一致：route.query.id → path param → ''（missing state）
        ⚠️ 同样**不得**回退到任何 mock id。
      */}
      {root === 'group' && <ChatScreen id={route.query.id ?? param ?? ''} variant="group" />}
      {root === 'scanner' && <ScannerScreen />}
      {root === 'loginselect' && <LoginSelectScreen />}
      {root === 'upgrade' && <UpgradeDialog />}
      {root === 'more' && <MoreScreen />}
      {/*
        M5 WO#12：**去掉了 `?? 'u1'` 这个 mock 回落**。
        原来没有 id 时会渲染 mock 的 u1 —— 那是"查不到就展示另一个人"的典型，
        审核记录 53 冻结的原则是：
            unknown / malformed user id → 明确的不可用态
            **NEVER** → 回落到另一个用户
        因此这里把 undefined 原样传下去，由 UserProfileScreen 的 parseUserId
        判为"不可解析" → 显示不可用态（且**不发任何请求**，也不显示任何用户）。
      */}
      {root === 'user' && <UserProfileScreen id={route.query.id ?? ''} />}
      {root === 'account' && <AccountScreen />}
      {root === 'verify' && <VerifyScreen />}
      {root === 'privacy' && <PrivacyScreen />}
      {root === 'blacklist' && <BlacklistScreen />}
      {root === 'about' && <AboutScreen />}
      {root === 'contact' && <ContactScreen />}
      {root === 'profile-edit' && <ProfileEditScreen />}
      {root === 'media' && (
        <MediaPreviewScreen
          postId={route.query.post}
          startIndex={route.query.i ? Number(route.query.i) : 0}
        />
      )}

      {/*
        ---- M5 WO#13：删除 5 个 **fabricated orphan route**（审核记录 54 批准）----

        被删除的是 interests / tags / bio / school / edit-profile 这五个**静态假页面**。
        删除依据（两条都已实测）：
          ① 它们**没有任何真实导航入口**：全仓递归搜 navigate 到这几个名字 → 零命中；
             而 MeScreen 的五个条目此前**全部** navigate('profile-edit')，从不走这里。
          ② 它们的内容是**硬编码假数据**，其中 App.tsx（原 :177）还写着
             「**12,486 位同学已加入**」—— 那正是 WO#11 从动态列表页判定为编造并移除的数字，
             它在这里**存活了下来**。另 :182-184 是「昵称：自定义名称6 / 学院：计算机与信息技术学院 /
             年级：本科三年级」等无来源断言。

        ⚠️ 边界（审核 54 明确要求区分两层）：
          · 删掉"**编造的 route surface**"是**合理清理**，不必一律登记成 KNOWN_DEVIATION ——
            因为不能因为"将来可能有用"就保留一个**可通过手工 URL 打开**的假业务页面。
          · 但 KNOWN_DEVIATION 需要**原版事实**作参照。我**没有**证据说明原版的
            兴趣/标签/介绍/学校各自进入什么页面，因此这四个目的地记为：
              ORIGINAL_INTEREST_DESTINATION: NOT_EVALUATED
              ORIGINAL_TAG_DESTINATION:      NOT_EVALUATED
              ORIGINAL_BIO_DESTINATION:      NOT_EVALUATED
              ORIGINAL_SCHOOL_DESTINATION:   NOT_EVALUATED
            （见 docs/m5/WO13-PLAN-profile-edit-field-inventory.md）
          · 注意：本次**不是**"仓库里任何地方都不能出现字符串 12,486"——
            审核 54 提醒应检查**可执行/可呈现的 surface**，而不是全仓字符串绝迹
            （mock.ts 里可能仍有未被治理页面的数据）。
      */}

      {tab && <TabBar active={tab} />}
    </Shell>
  )
}
