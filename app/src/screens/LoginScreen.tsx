import { useRef, useState } from 'react'
import { requestLoginCode, verifyLoginCode } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './login.css'

/**
 * 手机号登录页（原版 `com.kairuotu.account.login.activity.CampusSnsLoginActivity`）。
 *
 * 1:1 依据（M3 Slice 0A 实测，见 docs/m3/SLICE0-LOGIN-SEMANTICS.md）：
 *   - 标题「输入手机号」、固定国家码「+86」、手机号输入框（原版 id: phone_number）
 *   - 主按钮「获取验证码」（原版 id: next_step）、左上返回（原版 id: btnBack）
 *   - 原版**没有密码**、**没有第三方登录入口**
 *
 * ⚠️ 诚实声明（审核记录 08）：
 *   验证码页本身**没有取得原版证据** —— 取证时手机号框里预填着一个真实号码，
 *   点「获取验证码」会给该号码真发短信，因此主动停止（BLOCKED_BY_ETHICS）。
 *   所以本页的验证码态只能算"合理推断"，Gate 里记为
 *   `OTP_UI_FUNCTIONAL: PASS` + `OTP_UI_VISUAL_CONFORMANCE: NOT_EVALUATED`。
 */
export function LoginScreen() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 服务端返回的投递方式；本项目没有短信通道，会在 dev sink 下留一条提示 */
  const [devHint, setDevHint] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const timerRef = useRef<number | null>(null)

  function startCooldown(seconds: number) {
    setCooldown(seconds)
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setCooldown((v) => {
        if (v <= 1 && timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        return v > 1 ? v - 1 : 0
      })
    }, 1000)
  }

  async function requestCode() {
    if (busy || cooldown > 0) return
    setError('')
    setBusy(true)
    try {
      const r = await requestLoginCode(phone)
      if (!r.ok) {
        setError(r.status === 429 ? '请求太频繁，请稍后再试' : '手机号格式不正确或服务暂不可用')
        return
      }
      setSent(true)
      /*
        服务端会如实告诉我们**投递方式**，我们照着显示，不假装：
        · delivery === 'dev-sink' ⇒ 没接短信通道，码在服务器上（照实说）
        · delivery === 'sms'      ⇒ 真发了短信。此时再告诉用户**短信发送方名称**
          （来自服务端的 sms_sender）—— 因为我们的短信签名是阿里云系统赠送的
          （PNVS 不支持自定义），短信里显示的是「【恒创联众】…」而不是本 App 的名字；
          提示出发送方，用户才知道该查收哪条短信。
      */
      setDevHint(
        r.value.delivery === 'dev-sink'
          ? r.value.delivery_note
          : r.value.sms_sender
            ? `验证码已发送，发送方显示为「${r.value.sms_sender}」，请注意查收。`
            : '',
      )
      startCooldown(60)
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (busy) return
    if (!sent) {
      await requestCode()
      return
    }
    setError('')
    setBusy(true)
    try {
      const r = await verifyLoginCode(phone, code)
      if (!r.ok) {
        setError(r.status === 429 ? '尝试次数过多，请稍后再试' : '验证码不正确或已过期')
        return
      }
      navigate('campus')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('loginselect')} aria-label="返回">
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
            /* 占位文字属**推断**：原版观测时输入框已有值，placeholder 未观察到 */
            placeholder="请输入手机号"
            disabled={sent}
          />
          {!sent && (
            <button className="login__clear" onClick={() => setPhone('')} aria-label="清空">
              ×
            </button>
          )}
        </div>

        {sent && (
          <div className="login__field login__field--code">
            <input
              className="login__input"
              placeholder="请输入验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoFocus
            />
            <button
              className="login__resend"
              onClick={requestCode}
              disabled={cooldown > 0 || busy}
            >
              {cooldown > 0 ? `${cooldown}s` : '重新获取'}
            </button>
          </div>
        )}

        {error && <p className="login__error">{error}</p>}
        {devHint && (
          <p className="login__devhint" data-login-hint>
            {devHint}
          </p>
        )}

        <button
          className="login__submit"
          onClick={submit}
          disabled={busy || (!sent && !phone) || (sent && code.length !== 6)}
        >
          {busy ? '请稍候…' : sent ? '登录' : '获取验证码'}
        </button>

        <p className="login__agree">
          登录即表示同意 <span className="login__link">用户协议</span> 与{' '}
          <span className="login__link">隐私政策</span>
        </p>
      </div>
    </Screen>
  )
}
