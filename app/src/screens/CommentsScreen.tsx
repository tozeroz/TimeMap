import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconHeart } from '../components/icons'
import { comments, posts } from '../data/mock'
import { goBack } from '../router'

/** 单条评论的详情页：复刻原 app 的「评论详情」 */
export function CommentsScreen({ id }: { id: string }) {
  const post = posts.find((p) => p.id === id) ?? posts[0]
  const root = comments[0]

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('feed')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="评论详情"
        />
      }
      footer={
        <div className="feed__bar">
          <input className="feed__input" placeholder="回复…" />
        </div>
      }
      scroll
    >
      <div className="feed__post">
        <p className="feed__text">{post.text}</p>
      </div>

      <section className="feed__comments">
        <div className="cmt">
          <img className="cmt__avatar" src={root.author.avatar} alt="" />
          <div className="cmt__body">
            <div className="cmt__name">{root.author.name}</div>
            <p className="cmt__text">{root.text}</p>
            <div className="cmt__meta">
              <span>{root.time}</span>
            </div>
          </div>
          <span className="cmt__likes">
            <IconHeart size={14} />
            {root.likes}
          </span>
        </div>

        <h3 className="feed__comments-title">全部回复</h3>
        {comments.slice(1).map((c) => (
          <div key={c.id} className="cmt">
            <img className="cmt__avatar" src={c.author.avatar} alt="" />
            <div className="cmt__body">
              <div className="cmt__name">{c.author.name}</div>
              <p className="cmt__text">{c.text}</p>
              <div className="cmt__meta">
                <span>{c.time}</span>
              </div>
            </div>
            <span className="cmt__likes">
              <IconHeart size={14} />
              {c.likes}
            </span>
          </div>
        ))}
      </section>
    </Screen>
  )
}
