import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './login.css'

export function LoginScreen() {
  const [phone, setPhone] = useState('132 4689 2969')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)

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
        <h1 className="login__title">输入手机号</h1>

        <div className="login__field">
          <button className="login__prefix">+86</button>
          <input
            className="login__input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
          />
          <button className="login__clear" onClick={() => setPhone('')}>
            ×
          </button>
        </div>

        {sent && (
          <div className="login__field login__field--code">
            <input
              className="login__input"
              placeholder="请输入验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
            />
          </div>
        )}

        <button
          className="login__submit"
          onClick={() => (sent ? navigate('onboarding') : setSent(true))}
        >
          {sent ? '登录' : '获取验证码'}
        </button>

        <p className="login__agree">
          登录即表示同意 <span className="login__link">用户协议</span> 与{' '}
          <span className="login__link">隐私政策</span>
        </p>
      </div>
    </Screen>
  )
}
