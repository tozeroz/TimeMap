import { useEffect, useRef, useState } from 'react'
import { adminLogin, requestLoginCode, verifyLoginCode } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './login.css'

type LegalDocument = 'agreement' | 'privacy' | 'minors'
const legalTitles: Record<LegalDocument, string> = { agreement: '用户协议', privacy: '隐私政策', minors: '未成年人个人信息保护规则' }

function LegalDialog({ document, onClose, onReadMinors }: { document: LegalDocument; onClose: () => void; onReadMinors: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const opener = window.document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); queueMicrotask(() => { if (opener?.isConnected) opener.focus() }) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`./legal/${document}.txt`, { signal: controller.signal })
        if (!response.ok || !response.headers.get('content-type')?.includes('text/plain')) throw new Error('Unavailable')
        const content = await response.text()
        if (!content.trim()) throw new Error('Empty')
        if (!controller.signal.aborted) { setText(content); setPhase('ready') }
      } catch { if (!controller.signal.aborted) setPhase('error') }
    })()
    return () => controller.abort()
  }, [document, revision])
  return <dialog className="login-legal" ref={dialog} aria-labelledby="login-legal-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="login-legal__head"><h2 id="login-legal-title">{legalTitles[document]}</h2><button type="button" aria-label="关闭条款" onClick={onClose}>×</button></div>
    {phase === 'loading' && <p role="status">正在读取条款…</p>}
    {phase === 'error' && <div role="status"><p>条款正文暂未提供或无法读取，请稍后重试。</p><button className="login-legal__retry" onClick={() => { setPhase('loading'); setRevision(v => v + 1) }}>重新读取</button></div>}
    {phase === 'ready' && <div className="login-legal__text">{text}</div>}
    {document === 'agreement' && <button className="login-legal__minors" onClick={onReadMinors}>未成年人个人信息保护规则</button>}
    <button className="login-legal__done" onClick={onClose}>返回登录</button>
  </dialog>
}

/** Reference login surface; both existing login routes share this flow. */
export function LoginScreen() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<'phone' | 'agreement' | 'code' | 'password' | null>(null)
  const [devHint, setDevHint] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [mode, setMode] = useState<'otp' | 'admin'>('otp')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [legal, setLegal] = useState<LegalDocument | null>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
  const agreementInput = useRef<HTMLInputElement>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const alive = useRef(true)
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!cooldownUntil) return
    const tick = () => {
      setNow(Date.now())
      if (Date.now() >= cooldownUntil) window.clearInterval(timer)
    }
    const timer = window.setInterval(tick, 1000)
    window.document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(timer); window.document.removeEventListener('visibilitychange', tick) }
  }, [cooldownUntil])

  function clearError() { setError(''); setErrorField(null) }
  function validate() {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入有效的 11 位中国大陆手机号'); setErrorField('phone'); phoneInput.current?.focus(); return false
    }
    if (!agreed) {
      setError('请先阅读并同意用户协议与隐私政策'); setErrorField('agreement'); agreementInput.current?.focus(); return false
    }
    return true
  }
  function switchMode() {
    if (pending.current) return
    setMode(value => value === 'otp' ? 'admin' : 'otp')
    setPassword(''); setCode(''); setSent(false); setDevHint(''); clearError()
  }
  function begin() { pending.current = true; setBusy(true); clearError() }
  function finish() { pending.current = false; if (alive.current) setBusy(false) }

  async function requestCode() {
    if (pending.current || cooldown > 0 || !validate()) return
    begin()
    try {
      const result = await requestLoginCode(phone)
      if (!alive.current) return
      if (!result.ok) {
        if (result.status === 429) {
          setError('请求太频繁，请稍后再试')
          const seconds = Number(/"retryAfterS"\s*:\s*(\d+)/.exec(result.reason)?.[1])
          if (seconds > 0) { const timestamp = Date.now(); setNow(timestamp); setCooldownUntil(timestamp + seconds * 1000) }
        }
        else if (result.status === 400) { setError('手机号格式不正确，请检查后重试'); setErrorField('phone') }
        else if (result.status === 405 && /read_only_preview/.test(result.reason)) setError('当前连接为只读预览，请切换到可登录模式')
        else if (result.status === 503) setError(/sms_delivery_failed/.test(result.reason) ? '短信通道暂时不可用，请稍后重新获取验证码' : '验证码服务暂时不可用，请稍后重试')
        else setError('验证码发送失败，请检查网络后重试')
        return
      }
      setSent(true); setCode('')
      setDevHint(result.value.delivery === 'dev-sink' ? result.value.delivery_note || '当前为开发投递模式，验证码未发送到手机。' : result.value.sms_sender ? `验证码已发送，发送方显示为「${result.value.sms_sender}」，请注意查收。` : '验证码已发送，请注意查收。')
      const timestamp = Date.now(); setNow(timestamp); setCooldownUntil(timestamp + 60_000)
    } catch { if (alive.current) setError('验证码发送失败，请检查网络后重试') }
    finally { finish() }
  }

  async function submit() {
    if (pending.current || !validate()) return
    if (mode === 'otp' && !sent) { await requestCode(); return }
    if (mode === 'admin' && !password) { setError('请输入管理员密码'); setErrorField('password'); passwordInput.current?.focus(); return }
    if (mode === 'otp' && code.length !== 6) { setError('请输入 6 位验证码'); setErrorField('code'); codeInput.current?.focus(); return }
    begin()
    try {
      const result = mode === 'admin' ? await adminLogin(phone, password) : await verifyLoginCode(phone, code)
      if (!alive.current) return
      if (!result.ok) {
        if (result.status === 429) setError('尝试次数过多，请稍后再试')
        else if ((result.status ?? 0) === 0 || (result.status ?? 0) >= 500) setError('登录服务暂时不可用，请稍后重试')
        else setError(mode === 'admin' ? '手机号或密码不正确' : '验证码不正确或已过期，请重新输入或获取')
        return
      }
      if (mode === 'admin') { setPassword(''); navigate('admin'); return }
      let returnRoute: string | null = null
      try { returnRoute = sessionStorage.getItem('timemap.login.return'); sessionStorage.removeItem('timemap.login.return') } catch { /* Storage may be unavailable; normal login still succeeds. */ }
      if (returnRoute) {
        try {
          const target = JSON.parse(returnRoute)
          if (target.path === 'activity-submit') { navigate('activity-submit', target.query); return }
          if (target.path === 'activities' && target.query?.mode === 'projects') {
            navigate('activities', { mode: 'projects', view: target.query.view === 'popular' ? 'popular' : 'all' }); return
          }
        } catch { /* Ignore malformed return metadata. */ }
      }
      navigate('campus')
    } catch { if (alive.current) setError('登录失败，请检查网络后重试') }
    finally { finish() }
  }

  return <Screen className="login-reference" header={<TopBar
    left={<button className="login-reference__back" aria-label="返回" disabled={busy} onClick={() => goBack('map')}><IconBack size={25} /></button>}
    right={<button className="login-reference__mode" data-login-mode={mode === 'otp' ? 'admin' : 'otp'} disabled={busy} onClick={switchMode}>{mode === 'otp' ? '管理员登录' : '手机号登录'}</button>}
  />} scroll>
    <div className="login-reference__content">
      <div className="login-reference__brand"><svg width="28" height="34" viewBox="0 0 32 40" fill="none" aria-hidden="true"><path d="M16 39S1 25 1 16a15 15 0 0 1 30 0c0 9-15 23-15 23Z" fill="currentColor" /><circle cx="16" cy="16" r="12" fill="#f8f6f2" /><path d="M16 7v10h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg><span>北交时光</span></div>
      <h1 className="login-reference__title">{mode === 'admin' ? '管理员登录' : <>欢迎回到<span>TimeMap</span></>}</h1>
      <p className="login-reference__subtitle">{mode === 'admin' ? '管理校园内容，守护每一段校园记忆' : '用手机号登录，留住校园里的每段时光'}</p>
      <form className="login-reference__form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
        <label className="login-reference__label" htmlFor="login-phone">手机号码</label>
        <div className={`login-reference__field ${errorField === 'phone' ? 'has-error' : ''}`}>
          <span className="login-reference__prefix">+86</span>
          <input id="login-phone" ref={phoneInput} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="请输入手机号" value={phone} onChange={event => { setPhone(event.target.value.replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '').slice(0, 11)); clearError() }} disabled={busy || (sent && mode === 'otp')} aria-invalid={errorField === 'phone'} aria-describedby={errorField === 'phone' ? 'login-error' : undefined} />
        </div>
        {mode === 'admin' && <div className="login-reference__extra"><label className="login-reference__label" htmlFor="login-password">管理员密码</label><div className={`login-reference__field ${errorField === 'password' ? 'has-error' : ''}`}><input id="login-password" ref={passwordInput} data-login-password type="password" autoComplete="current-password" placeholder="请输入管理员密码" value={password} onChange={event => { setPassword(event.target.value); clearError() }} disabled={busy} aria-invalid={errorField === 'password'} aria-describedby={errorField === 'password' ? 'login-error' : undefined} /></div></div>}
        {sent && mode === 'otp' && <div className="login-reference__extra"><div className="login-reference__codeLabel"><label className="login-reference__label" htmlFor="login-code">验证码</label><button type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); setDevHint(''); clearError(); phoneInput.current?.focus() }}>修改手机号</button></div><div className={`login-reference__field ${errorField === 'code' ? 'has-error' : ''}`}><input id="login-code" ref={codeInput} inputMode="numeric" autoComplete="one-time-code" placeholder="请输入验证码" value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); clearError() }} disabled={busy} aria-invalid={errorField === 'code'} aria-describedby={errorField === 'code' ? 'login-error' : undefined} /><button type="button" className="login-reference__resend" disabled={busy || cooldown > 0} onClick={() => void requestCode()}>{cooldown > 0 ? `${cooldown}s 后重试` : '重新获取'}</button></div></div>}
        {error && <p className="login-reference__error" id="login-error" role="alert">{error}</p>}
        {devHint && mode === 'otp' && <p className="login-reference__hint" data-login-hint role="status">{devHint}</p>}
        <button className="login-reference__submit" data-login-submit type="submit" disabled={busy || (mode === 'otp' && !sent && cooldown > 0)}>{busy ? (mode === 'otp' && !sent ? '发送中…' : '登录中…') : mode === 'admin' || sent ? '登录' : cooldown > 0 ? `${cooldown}s 后重新获取` : '获取验证码'}</button>
        <div className="login-reference__agreement"><label className="login-reference__check"><input ref={agreementInput} type="checkbox" checked={agreed} disabled={busy} onChange={event => { setAgreed(event.target.checked); clearError() }} aria-label="同意用户协议与隐私政策" aria-invalid={errorField === 'agreement'} aria-describedby={errorField === 'agreement' ? 'login-error' : undefined} /><span aria-hidden="true" /></label><p>我已阅读并同意 <button type="button" onClick={() => setLegal('agreement')}>用户协议</button> 与 <button type="button" onClick={() => setLegal('privacy')}>隐私政策</button></p></div>
      </form>
    </div>
    {legal && <LegalDialog key={legal} document={legal} onClose={() => setLegal(null)} onReadMinors={() => setLegal('minors')} />}
  </Screen>
}
