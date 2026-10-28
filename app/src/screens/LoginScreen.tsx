import { useRef, useState } from 'react'
import { adminLogin, requestLoginCode, verifyLoginCode } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './login.css'

/**
 * 手机号登录页（原版 `com.kairuotu.account.login.activity.CampusSnsLoginActivity`）。
 *
 * 1:1 依据（M3 Slice 0A 实测，见 docs/pending/m3/SLICE0-LOGIN-SEMANTICS.md）：
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
  /**
   * 登录方式：短信验证码（学生/管理员都能用） | 管理员密码（017）。
   *
   * 为什么要有密码这条路：管理端原先只有短信一条凭据路径，而实测线上短信通道故障
   * ⇒ 谁也登不进去 ⇒ 管理端完全不可达。密码是**第二条**路，不是替换掉短信。
   */
  const [mode, setMode] = useState<'otp' | 'admin'>('otp')
  const [password, setPassword] = useState('')
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
        /*
          ⚠️ 不能把失败原因一律说成"手机号格式不正确"（2026-09-26 实测踩到）。
          服务端对**不同的失败**给了不同的 status 与 error：
            · 400 invalid_phone        → 号确实不合法（这才是"格式不正确"）
            · 429 too_many_requests    → 请求太频繁（服务端带 retry-after）
            · 503 sms_delivery_failed  → **短信通道故障**（服务端刻意**不**回退到 dev sink，
                                          避免把"渠道坏了"表现成"用户收到了码"）
            · 503 login_disabled       → 服务端没配 LOGIN_CODE_HMAC_KEY
            · 503 delivery_unavailable → dev sink 不可写
          把 503 说成"格式不正确"会让人反复检查手机号，而真实原因在别处 ——
          这正是"界面把明确的故障说成了另一件事"。
          ⇒ 这里按 status + 服务端返回的 error 区分，并对 5xx 明确说"是服务端/通道的问题，不是你的号"。
        */
        let msg: string
        if (r.status === 429) {
          msg = '请求太频繁，请稍后再试'
        } else if (r.status === 400) {
          msg = '手机号格式不正确（仅支持中国大陆 +86，且需 1[3-9] 开头）'
        } else if (r.status === 503) {
          // 从 reason body 里尽力取服务端给的原因码（request() 把原文截在 reason 里）
          const reason = /sms_delivery_failed/.test(r.reason)
            ? '短信通道发送失败'
            : /login_disabled/.test(r.reason)
              ? '服务端未配置登录密钥'
              : /delivery_unavailable/.test(r.reason)
                ? '服务端验证码投递不可用'
                : '服务暂时不可用'
          msg = `验证码发送失败：${reason}（这是服务端/短信通道的问题，不是手机号的问题）`
        } else {
          msg = `获取验证码失败：${r.reason}`
        }
        setError(msg)
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
    /*
      管理员密码登录（017）。与 OTP 路径分开处理：
      服务端对"手机号不存在 / 不是管理员 / 密码错"返回**完全相同**的 401，
      所以这里**必须**统一提示 —— 若按状态码猜原因（比如提示"该账号不是管理员"），
      就等于把服务端刻意抹平的信息又暴露出来。
    */
    if (mode === 'admin') {
      setError('')
      setBusy(true)
      try {
        const r = await adminLogin(phone, password)
        if (!r.ok) {
          setError(
            r.status === 429
              ? '尝试次数过多，请稍后再试'
              : r.status === 400
                ? '请输入手机号与密码'
                : '手机号或密码不正确',
          )
          return
        }
        // 管理员登录成功 → 直接进管理端（这就是他来的目的）
        navigate('admin')
      } finally {
        setBusy(false)
      }
      return
    }

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
        <h1 className="login__title">{mode === 'admin' ? '管理员登录' : '输入手机号'}</h1>

        {/* 登录方式切换：短信验证码（默认） | 管理员密码 */}
        <div className="login__modes" role="tablist">
          <button
            className={`login__mode ${mode === 'otp' ? 'is-active' : ''}`}
            data-login-mode="otp"
            role="tab"
            aria-selected={mode === 'otp'}
            onClick={() => {
              setMode('otp')
              setError('')
            }}
          >
            短信验证码
          </button>
          <button
            className={`login__mode ${mode === 'admin' ? 'is-active' : ''}`}
            data-login-mode="admin"
            role="tab"
            aria-selected={mode === 'admin'}
            onClick={() => {
              setMode('admin')
              setError('')
            }}
          >
            管理员密码
          </button>
        </div>

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

        {/* 管理员密码模式：密码输入框（替代验证码框） */}
        {mode === 'admin' && (
          <div className="login__field login__field--code">
            <input
              className="login__input"
              data-login-password
              type="password"
              placeholder="请输入管理员密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
          </div>
        )}

        {sent && mode === 'otp' && (
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
        {devHint && mode === 'otp' && (
          <p className="login__devhint" data-login-hint>
            {devHint}
          </p>
        )}

        <button
          className="login__submit"
          data-login-submit
          onClick={submit}
          disabled={
            busy ||
            (mode === 'admin'
              ? !phone || !password
              : (!sent && !phone) || (sent && code.length !== 6))
          }
        >
          {busy ? '请稍候…' : mode === 'admin' ? '登录' : sent ? '登录' : '获取验证码'}
        </button>

        {mode === 'admin' && (
          <p className="login__agree">
            管理员账号的密码由运维在服务器上用 <code>admin.mjs set-password</code> 设置；
            本页没有默认密码。
          </p>
        )}

        <p className="login__agree">
          登录即表示同意 <span className="login__link">用户协议</span> 与{' '}
          <span className="login__link">隐私政策</span>
        </p>
      </div>
    </Screen>
  )
}
