import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconCamera, IconChevronRight, IconPlus } from '../components/icons'
import { me } from '../data/mock'
import { goBack, navigate } from '../router'
import './profileedit.css'

const CARD_TAGS = ['偶像', '音乐', '球队', '动漫', '影视', '游戏', '运动', '食物']

/**
 * 个人资料（原版：个人页的「我的兴趣 / 我的标签 / 介绍一下自己～ / 我的学校 / 编辑资料」
 * 都指向这个页面）。
 *
 * 结构按原版实测：
 * - 顶栏：返回 +「个人资料」
 * - 卡片1：头像（右下角相机按钮）+ 昵称 / 简介 / 性别 / 标签 四行
 * - 卡片2：学校 + 「未认证」标签 + 说明「认证后，你发布的内容会更容易被校园圈推荐～」
 * - 卡片3：「校园名片」+ 彩色标签（偶像/音乐/球队/动漫/影视/游戏/运动/食物）+ 加号
 */
export function ProfileEditScreen() {
  const [nickname, setNickname] = useState(me.name)
  const [bio, setBio] = useState('介绍一下自己~')
  const [gender, setGender] = useState('编辑性别')
  const [tags, setTags] = useState<string[]>([])
  const [cardTags, setCardTags] = useState<string[]>(['音乐', '运动'])
  const [editing, setEditing] = useState<null | 'nickname' | 'bio' | 'gender'>(null)
  const [draft, setDraft] = useState('')

  function openEdit(kind: 'nickname' | 'bio' | 'gender') {
    setEditing(kind)
    setDraft(kind === 'nickname' ? nickname : kind === 'bio' ? bio : gender)
  }

  function saveEdit() {
    const value = draft.trim()
    if (editing === 'nickname' && value) setNickname(value)
    if (editing === 'bio' && value) setBio(value)
    if (editing === 'gender' && value) setGender(value)
    setEditing(null)
  }

  const TAG_OPTIONS = ['性格开朗', '夜猫子', '图书馆常驻', '食堂测评员', 'INFP', '天秤座']

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="个人资料"
        />
      }
      scroll
    >
      {/* 卡片1：头像与基本信息 */}
      <section className="pe__card">
        <div className="pe__avatarRow">
          <div className="pe__avatarWrap">
            <img className="pe__avatar" src={me.avatar} alt="" />
            <button className="pe__camera" aria-label="更换头像">
              <IconCamera size={14} />
            </button>
          </div>
        </div>

        <button className="pe__row" onClick={() => openEdit('nickname')}>
          <span className="pe__label">昵称</span>
          <span className="pe__value">{nickname}</span>
          <IconChevronRight size={15} />
        </button>
        <button className="pe__row" onClick={() => openEdit('bio')}>
          <span className="pe__label">简介</span>
          <span className="pe__value">{bio}</span>
          <IconChevronRight size={15} />
        </button>
        <button className="pe__row" onClick={() => openEdit('gender')}>
          <span className="pe__label">性别</span>
          <span className="pe__value">{gender}</span>
          <IconChevronRight size={15} />
        </button>
        <button className="pe__row" onClick={() => setEditing('gender')}>
          <span className="pe__label">标签</span>
          <span className="pe__value">{tags.length ? tags.join('、') : '选择标签'}</span>
          <IconChevronRight size={15} />
        </button>
      </section>

      {/* 卡片2：学校 */}
      <section className="pe__card">
        <button className="pe__row" onClick={() => navigate('verify')}>
          <span className="pe__label">学校</span>
          <span className="pe__value">北京交通大学</span>
          <span className="pe__tag">未认证</span>
          <IconChevronRight size={15} />
        </button>
        <p className="pe__hint">认证后，你发布的内容会更容易被校园圈推荐～</p>
      </section>

      {/* 卡片3：校园名片 */}
      <section className="pe__card">
        <div className="pe__cardHead">
          <span className="pe__cardTitle">校园名片</span>
          <IconChevronRight size={15} />
        </div>
        <div className="pe__tags">
          {CARD_TAGS.map((t) => (
            <button
              key={t}
              className={`pe__tagChip ${cardTags.includes(t) ? 'is-on' : ''}`}
              onClick={() =>
                setCardTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
              }
            >
              {t}
            </button>
          ))}
          <button className="pe__tagAdd" aria-label="添加标签">
            <IconPlus size={15} />
          </button>
        </div>
      </section>

      {/* 标签选择（复用同一弹窗） */}
      {editing === 'gender' && (
        <div className="pe__dialog">
          <div className="pe__mask" onClick={() => setEditing(null)} />
          <div className="pe__panel">
            <h3 className="pe__panelTitle">选择标签</h3>
            <div className="pe__options">
              {TAG_OPTIONS.map((t) => (
                <button
                  key={t}
                  className={`pe__option ${tags.includes(t) ? 'is-on' : ''}`}
                  onClick={() =>
                    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                  }
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="pe__options">
              {['男', '女', '不展示'].map((g) => (
                <button key={g} className="pe__option" onClick={() => setGender(g)}>
                  {g}
                </button>
              ))}
            </div>
            <button className="pe__save" onClick={() => setEditing(null)}>
              完成
            </button>
          </div>
        </div>
      )}

      {/* 文本编辑弹窗 */}
      {(editing === 'nickname' || editing === 'bio') && (
        <div className="pe__dialog">
          <div className="pe__mask" onClick={() => setEditing(null)} />
          <div className="pe__panel">
            <h3 className="pe__panelTitle">{editing === 'nickname' ? '修改昵称' : '编辑简介'}</h3>
            <input
              className="pe__input"
              value={draft}
              maxLength={editing === 'nickname' ? 16 : 40}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={editing === 'nickname' ? '输入昵称' : '介绍一下自己~'}
            />
            <div className="pe__panelActions">
              <button className="pe__cancel" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="pe__save" onClick={saveEdit}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  )
}
