import { useState } from 'react'
import { createFeedback, failText, type FeedbackCategory } from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconCheck } from '../components/icons'
import { goBack, navigate, useRoute } from '../router'
import { APP_VERSION } from '../version'
import './feedback.css'

/**
 * 意见反馈（043）：发现的问题 / 想加的功能，直接交给管理员。
 *
 * 设计约束（刻意很小）：
 *   · 只做"提交一条"。不提供服务端分页的"我的反馈列表" —— 本轮需求是让反馈能到达
 *     管理员，多一个列表就多一套分页/状态语义，属于范围扩散。
 *   · **带上提交时所在页面**（`location.hash`，由侧边栏入口传进来）与前端版本号：
 *     bug 报告最缺的就是"在哪个页面、哪个版本上出的问题"，让用户手打这两项基本收不到。
 *   · 正文 5–1000 字：太短的多半是误触，太长的说明该拆成多条。前后端同一口径。
 *   · 登录后才可提交（防止刷屏，也让管理员知道是谁报的）；未登录时给明确入口，
 *     不把表单藏起来装死。
 *   · 提交成功后显示明确结果与"再提一条"，不假装跳转到某个不存在的列表。
 */

const CATEGORIES: Array<{ key: FeedbackCategory; label: string; hint: string }> = [
  { key: 'bug', label: '发现问题', hint: '页面报错、按钮点不动、数据显示不对' },
  { key: 'feature', label: '功能建议', hint: '希望增加或改进的功能' },
  { key: 'other', label: '其他', hint: '账号、体验、其他想说的' },
]

const MIN = 5
const MAX = 1000
const count = (text: string) => Array.from(text).length

export function FeedbackScreen() {
  const route = useRoute()
  const user = getSession()?.user
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [done, setDone] = useState(false)

  // 从侧边栏进来时带了 `from`（提交前所在页面的 hash），这里原样上报，便于管理员复现
  const pageContext = (route.query.from || '').slice(0, 200)
  const trimmed = content.trim()
  const length = count(trimmed)
  const canSubmit = length >= MIN && length <= MAX && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (length < MIN) {
      setFieldError(`再多写几个字吧（至少 ${MIN} 字）`)
      return
    }
    if (length > MAX) {
      setFieldError(`最多 ${MAX} 字，请精简一下`)
      return
    }
    setFieldError('')
    setError('')
    setBusy(true)
    const result = await createFeedback({
      category,
      content: trimmed,
      contact: contact.trim() || undefined,
      pageContext: pageContext || undefined,
      appVersion: APP_VERSION,
    })
    setBusy(false)
    if (!result.ok) {
      // 会话过期与服务端拒绝分开说：前者能自己恢复（重新登录），后者要说清哪里不合规
      setError(result.status === 401 ? '登录已过期，请重新登录后再提交；内容不会丢。' : failText(result))
      return
    }
    setDone(true)
  }

  function again() {
    setDone(false)
    setContent('')
    setContact('')
    setFieldError('')
    setError('')
  }

  const header = (
    <TopBar
      variant="plain"
      left={
        <button className="iconbtn" aria-label="返回" onClick={() => goBack('me')}>
          <IconBack />
        </button>
      }
      center="意见反馈"
    />
  )

  if (!user) {
    return (
      <Screen className="fb" header={header}>
        <div className="fb__content">
          <h1>有问题？想法？直接说。</h1>
          <p className="fb__lede">登录后可以把问题和建议直接发给管理员，方便跟进。</p>
          <div className="fb__state" data-fb-login>
            <p>提交反馈需要先登录。</p>
            <button className="fb__primary" onClick={() => navigate('login')}>
              登录 TimeMap
            </button>
          </div>
        </div>
      </Screen>
    )
  }

  if (done) {
    return (
      <Screen className="fb" header={header}>
        <div className="fb__content">
          <div className="fb__state fb__state--done" data-fb-done>
            <span className="fb__ok" aria-hidden="true">
              <IconCheck size={26} />
            </span>
            <h2>已收到，谢谢！</h2>
            <p>管理员会在管理端看到这条反馈。如果留了联系方式，必要时会联系你。</p>
            <div className="fb__actions">
              <button className="fb__primary" onClick={again}>
                再提一条
              </button>
              <button className="fb__ghost" onClick={() => navigate('me')}>
                返回我的
              </button>
            </div>
          </div>
        </div>
      </Screen>
    )
  }

  return (
    <Screen className="fb" header={header}>
      <form className="fb__content" onSubmit={submit} noValidate>
        <h1>有问题？想法？直接说。</h1>
        <p className="fb__lede">管理员会在管理端看到你提交的内容；带 * 的是必填。</p>

        <fieldset className="fb__group">
          <legend>
            反馈类型 <b aria-hidden="true">*</b>
          </legend>
          <div className="fb__chips" role="radiogroup" aria-label="反馈类型">
            {CATEGORIES.map((item) => (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={category === item.key}
                className={`fb__chip${category === item.key ? ' is-on' : ''}`}
                data-fb-category={item.key}
                onClick={() => setCategory(item.key)}
              >
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="fb__group">
          <label htmlFor="fb-content">
            具体说说 <b aria-hidden="true">*</b>
          </label>
          <textarea
            id="fb-content"
            className="fb__textarea"
            data-fb-content
            rows={6}
            maxLength={MAX}
            placeholder={
              category === 'bug'
                ? '在哪个页面、做了什么操作、看到了什么；能复现的话最好写出步骤。'
                : category === 'feature'
                  ? '你想要的功能解决什么问题？希望它在哪个页面出现？'
                  : '想说的都可以写在这里。'
            }
            value={content}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'fb-error' : undefined}
            onChange={(e) => {
              setContent(e.target.value)
              if (fieldError) setFieldError('')
            }}
          />
          <div className="fb__meta">
            <span>至少 {MIN} 字</span>
            <span className={length > MAX ? 'is-over' : ''} data-fb-count>
              {length} / {MAX}
            </span>
          </div>
          {fieldError && (
            <p className="fb__error" id="fb-error" role="alert" data-fb-field-error>
              {fieldError}
            </p>
          )}
        </fieldset>

        <fieldset className="fb__group">
          <label htmlFor="fb-contact">
            联系方式 <span className="fb__optional">（选填）</span>
          </label>
          <input
            id="fb-contact"
            className="fb__input"
            data-fb-contact
            type="text"
            maxLength={100}
            placeholder="邮箱 / 微信 / 手机号，方便管理员追问"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </fieldset>

        {/* 自动附带的复现信息：让用户手打"在哪个页面"基本收不到，这里直接读路由与版本 */}
        <div className="fb__attach" data-fb-context>
          <span>自动附加</span>
          <code>{pageContext || '（未记录页面）'}</code>
          <code>v{APP_VERSION}</code>
        </div>

        {error && (
          <p className="fb__error" role="alert" data-fb-error>
            {error}
          </p>
        )}

        <button className="fb__primary" type="submit" disabled={!canSubmit} data-fb-submit>
          {busy ? '提交中…' : '提交给管理员'}
        </button>
        <p className="fb__footnote">提交后可在管理端「用户反馈」里被看到与处理。</p>
      </form>
    </Screen>
  )
}
