import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './login.css'

/** 登录方式选择（对应原版 campusx://login/select） */
export function LoginSelectScreen() {
  const methods = [
    { key: 'phone', label: '手机号登录', desc: '使用手机号 + 验证码', primary: true },
    { key: 'sns', label: '微信登录', desc: '使用微信授权快速登录' },
    { key: 'qq', label: 'QQ 登录', desc: '使用 QQ 授权快速登录' },
  ]

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
        />
      }
      scroll
    >
      <div className="login">
        <h1 className="login__title">登录 Campus</h1>
        <p className="login__lead">用校园身份加入，找到同校的同学</p>

        <div className="ls__methods">
          {methods.map((m) => (
            <button
              key={m.key}
              className={`ls__method ${m.primary ? 'is-primary' : ''}`}
              onClick={() => navigate(m.key === 'phone' ? 'login' : 'onboarding')}
            >
              <span className="ls__method-label">{m.label}</span>
              <span className="ls__method-desc">{m.desc}</span>
            </button>
          ))}
        </div>

        <p className="login__agree">
          登录即表示同意 <span className="login__link">用户协议</span> 与{' '}
          <span className="login__link">隐私政策</span>
        </p>
      </div>
    </Screen>
  )
}
