import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './login.css'

export function LoginScreen() {
  /**
   * 手机号默认为空。
   *
   * 早先这里硬编码了 '132 4689 2969' —— 那是从原版 APK 截图里抄下来的**真实手机号**
   * （M0 之所以要在 login-sns 的截图与控件树上打码，就是因为原版输入框里留着这个号码，
   * 它是上一位使用者输入后被 app 记住的本地状态）。
   * 写进我们自己的源码有两个问题：一是泄漏真实个人信息，二是行为上也不对
   * （"记住上次号码"属于本地状态，不该是代码里的默认值）。
   */
  const [phone, setPhone] = useState('')
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
            /* 占位文字属**推断**：原版观测时输入框已有值，placeholder 未观察到。
               这里只补一个不影响布局的占位，避免空框无任何提示。 */
            placeholder="请输入手机号"
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
