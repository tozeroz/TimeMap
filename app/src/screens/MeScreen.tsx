import { Screen, TopBar } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronRight,
  IconEdit,
  IconImage,
  IconMenu,
  IconShare,
} from '../components/icons'
import { me } from '../data/mock'
import { navigate } from '../router'
import './me.css'

/** 个人页：对齐原版 —— 纯白底、无多余模块，中部只有「拍下眼前的风景」+ 提示气泡 */
export function MeScreen() {
  return (
    <Screen
      header={
        <TopBar
          left={
            <>
              <button className="iconbtn" aria-label="菜单">
                <IconMenu size={22} strokeWidth={2.2} />
              </button>
              <button className="iconbtn" aria-label="分享">
                <IconShare size={20} strokeWidth={2.2} />
              </button>
            </>
          }
          right={
            <button className="iconbtn" onClick={() => navigate('message')} aria-label="消息">
              <IconChatBubble size={22} strokeWidth={2.2} />
            </button>
          }
          variant="plain"
        />
      }
      scroll
    >
      <section className="me__profile">
        <div className="me__side me__side--left">
          <button className="me__entry" onClick={() => navigate('interests')}>
            <span>我的兴趣</span>
            <IconChevronRight size={14} />
          </button>
          <button className="me__entry" onClick={() => navigate('tags')}>
            <span>我的标签</span>
            <IconChevronRight size={14} />
          </button>
        </div>

        <div className="me__center">
          <img className="me__avatar" src={me.avatar} alt="" />
          <h2 className="me__name">{me.name}</h2>
          <button className="me__edit" onClick={() => navigate('edit-profile')}>
            <IconEdit size={14} />
            <span>编辑资料</span>
          </button>
        </div>

        <div className="me__side me__side--right">
          <button className="me__entry" onClick={() => navigate('bio')}>
            <span>介绍一下自己～</span>
            <IconChevronRight size={14} />
          </button>
          <button className="me__entry" onClick={() => navigate('school')}>
            <span>我的学校</span>
            <IconChevronRight size={14} />
          </button>
        </div>
      </section>

      {/* 记录入口：原版是「拍下眼前的风景」黑色胶囊 + 蓝色气泡提示 */}
      <section className="me__prompt">
        <button className="me__capture" onClick={() => navigate('publish')}>
          <IconImage size={17} />
          <span>拍下眼前的风景</span>
        </button>
        <div className="me__hint">
          <span className="me__hint-spark">✦</span>
          <span className="me__hint-bubble">快来试试吧～</span>
        </div>
      </section>
    </Screen>
  )
}
