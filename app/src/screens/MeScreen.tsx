import { Screen, TopBar } from '../components/Shell'
import {
  IconCamera,
  IconChatBubble,
  IconChevronRight,
  IconEdit,
  IconHeart,
  IconMenu,
  IconShare,
  IconStar,
} from '../components/icons'
import { me, posts } from '../data/mock'
import { navigate } from '../router'
import './me.css'

export function MeScreen() {
  const mine = posts.slice(0, 4)

  return (
    <Screen
      header={
        <TopBar
          left={
            <>
              <button className="iconbtn" aria-label="菜单">
                <IconMenu size={22} />
              </button>
              <button className="iconbtn" aria-label="分享">
                <IconShare size={20} />
              </button>
            </>
          }
          right={
            <button className="iconbtn" onClick={() => navigate('message')} aria-label="消息">
              <IconChatBubble size={22} />
            </button>
          }
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
            <IconEdit size={15} />
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

      <section className="me__prompt">
        <button className="me__capture" onClick={() => navigate('publish')}>
          <IconCamera size={18} />
          <span>拍下眼前的风景</span>
          <IconStar size={16} />
        </button>
        <div className="me__hint">
          <span className="me__hint-spark">✨</span>
          <span className="me__hint-bubble">快来试试吧～</span>
        </div>
      </section>

      <section className="me__mine">
        <h3 className="me__section-title">我的动态</h3>
        <div className="me__grid">
          {mine.map((p) => (
            <button key={p.id} className="me__tile" onClick={() => navigate('feed', { id: p.id })}>
              {p.images.length > 0 ? (
                <img src={p.images[0]} alt="" />
              ) : (
                <span className="me__tile-text">{p.text}</span>
              )}
              <span className="me__tile-likes">
                <IconHeart size={13} />
                {p.likes}
              </span>
            </button>
          ))}
        </div>
      </section>
    </Screen>
  )
}
