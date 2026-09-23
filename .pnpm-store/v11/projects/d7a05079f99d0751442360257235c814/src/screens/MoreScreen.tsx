import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronRight } from '../components/icons'
import { goBack, navigate } from '../router'
import './more.css'

/**
 * 更多入口（对应个人页左上角的「三横线」菜单图标）。
 * 原版这里是抽屉式菜单；demo 用独立页面等价实现，
 * 目的是让每个二级页面都能从界面里走到，而不是只能靠 URL。
 */
const ENTRIES: Array<{ label: string; desc: string; to: string }> = [
  { label: '校园圈', desc: '同校动态列表', to: 'feedlist' },
  { label: '今日打卡', desc: '记录今天的小事', to: 'daily' },
  { label: '留言板', desc: '仅双方可见', to: 'board' },
  { label: '聊天', desc: '私聊与群聊', to: 'message' },
  { label: '地点搜索', desc: '给动态添加地点', to: 'poi' },
  { label: '扫码', desc: '扫描校园卡 / 群邀请', to: 'scanner' },
  { label: '校园公告', desc: '通知与规范', to: 'announce' },
  { label: '登录方式', desc: '手机号 / 第三方', to: 'loginselect' },
  { label: '检查更新', desc: '发现新版本', to: 'upgrade' },
]

export function MoreScreen() {
  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="更多"
        />
      }
      scroll
    >
      <div className="list">
        {ENTRIES.map((e) => (
          <button key={e.to} className="row" onClick={() => navigate(e.to)}>
            <div className="row__main">
              <div className="row__title">{e.label}</div>
              <div className="row__sub">{e.desc}</div>
            </div>
            <IconChevronRight size={16} />
          </button>
        ))}
      </div>
      <p className="more__foot">Campus demo · 数据全部本地 mock · 无任何网络请求</p>
    </Screen>
  )
}
