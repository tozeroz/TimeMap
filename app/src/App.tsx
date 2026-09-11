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
import { SimpleScreen } from './screens/SimpleScreen'
import { FeedListScreen } from './screens/FeedListScreen'
import { PoiDetailScreen } from './screens/PoiDetailScreen'
import { GroupChatScreen } from './screens/GroupChatScreen'
import { MediaPreviewScreen } from './screens/MediaPreviewScreen'
import { ScannerScreen } from './screens/ScannerScreen'
import { LoginSelectScreen } from './screens/LoginSelectScreen'
import { UpgradeDialog } from './screens/UpgradeDialog'
import { MoreScreen } from './screens/MoreScreen'
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

      {root === 'feed' && <FeedDetailScreen id={param ?? 'p1'} />}
      {root === 'comments' && <CommentsScreen id={param ?? 'p1'} />}
      {root === 'message' && <MessageScreen />}
      {root === 'chat' && <ChatScreen id={param ?? 't1'} />}
      {root === 'board' && <BoardScreen />}
      {root === 'daily' && <DailyScreen />}
      {root === 'poi' && <PoiSearchScreen />}
      {root === 'publish' && <PublishScreen />}
      {root === 'login' && <LoginScreen />}
      {root === 'onboarding' && <OnboardingScreen />}
      {root === 'announce' && <AnnounceScreen />}
      {root === 'feedlist' && <FeedListScreen />}
      {root === 'poidetail' && <PoiDetailScreen />}
      {root === 'group' && <GroupChatScreen />}
      {root === 'scanner' && <ScannerScreen />}
      {root === 'loginselect' && <LoginSelectScreen />}
      {root === 'upgrade' && <UpgradeDialog />}
      {root === 'more' && <MoreScreen />}
      {root === 'media' && (
        <MediaPreviewScreen
          postId={route.query.post}
          startIndex={route.query.i ? Number(route.query.i) : 0}
        />
      )}

      {root === 'interests' && (
        <SimpleScreen title="我的兴趣" subtitle="选择你感兴趣的内容，我们会为你推荐">
          <div className="chips">
            {['摄影', '美食', '读书', '音乐', '运动', '旅行', '电影', '宠物', '手作', '考研'].map(
              (t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ),
            )}
          </div>
        </SimpleScreen>
      )}
      {root === 'tags' && (
        <SimpleScreen title="我的标签" subtitle="标签会展示在你的主页">
          <div className="chips">
            {['INFP', '天秤座', '夜猫子', '食堂测评员', '图书馆常驻'].map((t) => (
              <span key={t} className="chip chip--blue">
                {t}
              </span>
            ))}
          </div>
        </SimpleScreen>
      )}
      {root === 'bio' && (
        <SimpleScreen title="介绍一下自己" subtitle="一句话让别人认识你">
          <p className="para">喜欢傍晚的操场和图书馆四楼的窗边位，偶尔写点东西。</p>
        </SimpleScreen>
      )}
      {root === 'school' && (
        <SimpleScreen title="我的学校" subtitle="北京交通大学">
          <p className="para">海淀区西直门外上园村 3 号</p>
          <p className="para">12,486 位同学已加入</p>
        </SimpleScreen>
      )}
      {root === 'edit-profile' && (
        <SimpleScreen title="编辑资料" subtitle="修改后立即生效">
          <p className="para">昵称：自定义名称6</p>
          <p className="para">学院：计算机与信息技术学院</p>
          <p className="para">年级：本科三年级</p>
        </SimpleScreen>
      )}

      {tab && <TabBar active={tab} />}
    </Shell>
  )
}
