import { useState } from 'react'
import { Screen } from '../components/Shell'
import { INVITE_ADMIN, INVITE_STUDENT, login } from '../data/tmStore'
import './login.css'

/**
 * 登录页（F01 用户入口）。
 *
 * 需求要求：低敏身份标识 + 邀请码控制试用范围；不采集真实密码、身份证、手机号。
 * 演示环境直接给出两枚邀请码：普通学生 / 学生管理员。
 */
export function LoginScreen() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [showPrivacy, setShowPrivacy] = useState(false)

  function submit() {
    const res = login(code, name)
    if (!res.ok) {
      setError(res.error ?? '登录失败')
      return
    }
    setError('')
  }

  return (
    <Screen className="lg">
      <div className="lg__hero">
        <div className="lg__logo" aria-hidden>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" />
            <circle cx="12" cy="10.6" r="2.3" />
          </svg>
        </div>
        <h1 className="lg__title">BJTU TimeMap</h1>
        <p className="lg__sub">北交大校园记忆地图 · 以地点连接校园历史与学生记忆</p>
      </div>

      <div className="lg__card">
        <label className="lg__field">
          <span className="lg__label">邀请码</span>
          <input
            className="lg__input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setError('')
            }}
            placeholder="请输入试用邀请码"
            autoCapitalize="characters"
          />
        </label>
        <label className="lg__field">
          <span className="lg__label">昵称（选填）</span>
          <input
            className="lg__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="给自己起个名字，最多 12 字"
            maxLength={12}
          />
        </label>

        {error && <p className="lg__error">{error}</p>}

        <button className="lg__submit" onClick={submit} disabled={!code.trim()}>
          进入 TimeMap
        </button>

        <div className="lg__hint">
          <span>演示邀请码：</span>
          <button className="lg__code" onClick={() => setCode(INVITE_STUDENT)}>
            {INVITE_STUDENT}（学生）
          </button>
          <button className="lg__code" onClick={() => setCode(INVITE_ADMIN)}>
            {INVITE_ADMIN}（管理员）
          </button>
        </div>
      </div>

      <p className="lg__privacy" onClick={() => setShowPrivacy((v) => !v)}>
        隐私说明：仅使用邀请码识别身份，不采集手机号、密码或身份证信息 {showPrivacy ? '▲' : '▼'}
      </p>
      {showPrivacy && (
        <div className="lg__privacyBody">
          <p>· 本项目为课程演示环境，全部数据保存在你的设备本地，不上传服务器。</p>
          <p>· 不采集身份证照片、教务密码、学籍证明或精确实时轨迹。</p>
          <p>· 微信等第三方授权只用于项目内账号识别，不宣称实现学籍认证。</p>
          <p>· 你发布的内容关联到具体地点并对其他试用者可见，可随时删除。</p>
        </div>
      )}
    </Screen>
  )
}
