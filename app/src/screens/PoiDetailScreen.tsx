import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconHeart, IconLocation, IconMore } from '../components/icons'
import { me, poiDetail, posts, users } from '../data/mock'
import { goBack, navigate } from '../router'
import './poidetail.css'

/** 地点详情（对应原版 campusx://feed/poi/detail）：某个地点下的动态聚合 */
export function PoiDetailScreen() {
  const here = posts.slice(0, 3)

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="地点"
          right={
            <button className="iconbtn" aria-label="更多">
              <IconMore size={20} />
            </button>
          }
        />
      }
      scroll
    >
      <section className="pd__card">
        <img className="pd__cover" src={posts[0].images[0]} alt="" />
        <div className="pd__info">
          <h2 className="pd__name">{poiDetail.name}</h2>
          <p className="pd__addr">
            <IconLocation size={15} />
            <span>{poiDetail.address}</span>
          </p>
          <div className="pd__stats">
            <span>
              <strong>{poiDetail.posts}</strong> 条动态
            </span>
            <span>
              <strong>{poiDetail.visitors}</strong> 人来过
            </span>
            <span className="pd__cat">{poiDetail.category}</span>
          </div>
        </div>
      </section>

      <section className="pd__actions">
        <button className="pd__action" onClick={() => navigate('publish')}>
          在这里发动态
        </button>
        <button className="pd__action pd__action--ghost" onClick={() => navigate('board')}>
          给这里留言
        </button>
      </section>

      <section className="pd__who">
        <h3 className="pd__section">最近来过</h3>
        <div className="pd__avatars">
          {[users.u1, users.u2, users.u3, users.u5, users.u7, me].map((u) => (
            <img key={u.id} className="pd__avatar" src={u.avatar} alt={u.name} />
          ))}
        </div>
      </section>

      <section className="pd__feed">
        <h3 className="pd__section">这里的动态</h3>
        {here.map((p) => (
          <button key={p.id} className="pd__item" onClick={() => navigate('feed', { id: p.id })}>
            <img className="pd__thumb" src={p.images[0] ?? p.author.avatar} alt="" />
            <div className="pd__item-main">
              <p className="pd__item-text">{p.text}</p>
              <div className="pd__item-meta">
                <img className="pd__item-avatar" src={p.author.avatar} alt="" />
                <span>{p.author.name}</span>
                <span className="pd__item-likes">
                  <IconHeart size={13} />
                  {p.likes}
                </span>
              </div>
            </div>
          </button>
        ))}
      </section>
    </Screen>
  )
}
