import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { TabBar, type TabKey } from './components/TabBar'
import { useRoute } from './router'
import { getSession } from './data/tmStore'
import { useTm } from './components/TmPostCard'
import { LoginScreen } from './screens/LoginScreen'
import { MeScreen } from './screens/MeScreen'
import { MapScreen } from './screens/MapScreen'
import { ActivitiesScreen } from './screens/ActivitiesScreen'
import { ActivityDetailScreen } from './screens/ActivityDetailScreen'
import { PlaceDetailScreen } from './screens/PlaceDetailScreen'
import { FeedDetailScreen } from './screens/FeedDetailScreen'
import { CommentsScreen } from './screens/CommentsScreen'
import { PublishScreen } from './screens/PublishScreen'
import { AdminScreen } from './screens/AdminScreen'
import { ProfileEditScreen } from './screens/ProfileEditScreen'
import { MoreScreen } from './screens/MoreScreen'
import './styles/pages.css'
import './styles/timemap.css'

const TAB_TITLES: Record<string, string> = {
  map: 'BJTU TimeMap · 地图',
  activities: 'BJTU TimeMap · 活动',
  me: 'BJTU TimeMap · 我的',
}

export default function App() {
  // 订阅 store：登录/退出后要立刻切换登录门禁，不能等下一次路由变化
  useTm()
  const route = useRoute()
  const [root, param] = route.path.split('/')
  /**
   * 详情页的 id 既支持 query（navigate('place', { id }) → #/place?id=xxx），
   * 也支持路径段（#/place/xxx）。原实现只读路径段，而所有跳转都用 query，
   * 结果详情页永远落到兜底 id —— 这里一并修掉。
   */
  const idParam = route.query.id ?? param
  const tab: TabKey | null =
    root === 'map' || root === 'activities' || root === 'me' ? (root as TabKey) : null
  // 深色页面：状态栏需要跟着变暗
  const dark = root === 'scanner' || root === 'media'

  // F01 用户入口：邀请码控制试用范围 —— 未登录一律先到登录页
  const loggedIn = Boolean(getSession())

  useEffect(() => {
    document.title = TAB_TITLES[root] ?? 'BJTU TimeMap'
  }, [root])

  if (!loggedIn) {
    return (
      <Shell dark={dark}>
        <LoginScreen />
      </Shell>
    )
  }

  return (
    <Shell dark={dark}>
      {tab === 'map' && <MapScreen />}
      {tab === 'activities' && <ActivitiesScreen />}
      {tab === 'me' && <MeScreen />}

      {root === 'place' && <PlaceDetailScreen id={idParam ?? 'pl_siyuanbei'} />}
      {root === 'feed' && <FeedDetailScreen id={idParam ?? 'tp1'} />}
      {root === 'comments' && <CommentsScreen id={idParam ?? 'tp1'} />}
      {root === 'publish' && <PublishScreen />}
      {root === 'activity' && <ActivityDetailScreen id={idParam ?? 'ta1'} />}
      {root === 'admin' && <AdminScreen />}
      {root === 'login' && <LoginScreen />}
      {root === 'profile-edit' && <ProfileEditScreen />}
      {root === 'more' && <MoreScreen />}

      {tab && <TabBar active={tab} />}
    </Shell>
  )
}
