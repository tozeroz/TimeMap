import { useState } from 'react'
import { Screen } from '../components/Shell'
import { navigate } from '../router'
import './login.css'

/**
 * 登录入口（原版 CampusLoginActivity）。
 * 按原版实测：整页是品牌拼贴 + 居中「Campus」标识 + 底部一个黑色胶囊按钮「登录 Campus」，
 * 按钮下方是**未勾选的协议复选框** +「我已阅读并同意《用户协议》《隐私政策》《未成年人个人信息保护规则》」。
 */
export function LoginSelectScreen() {
  const [agreed, setAgreed] = useState(false)
  const [warn, setWarn] = useState(false)

  function login() {
    if (!agreed) {
      setWarn(true)
      window.setTimeout(() => setWarn(false), 1600)
      return
    }
    navigate('login')
  }

  return (
    <Screen scroll={false}>
      <div className="ls">
        {/* 品牌拼贴区 */}
        <div className="ls__hero">
          <span className="ls__deco ls__deco--1" aria-hidden />
          <span className="ls__deco ls__deco--2" aria-hidden />
          <span className="ls__deco ls__deco--3" aria-hidden />
          <span className="ls__deco ls__deco--4" aria-hidden />
          <span className="ls__deco ls__deco--5" aria-hidden />
          <span className="ls__deco ls__deco--6" aria-hidden />

          <div className="ls__brand">
            <span className="ls__brandMark" aria-hidden>
              e
            </span>
            <span className="ls__brandText">Campus</span>
          </div>
        </div>

        {/* 主操作区 */}
        <div className="ls__foot">
          <button className="ls__login" onClick={login}>
            {/* 手机图标按原版做成横向圆角矩形（此前画得过窄） */}
            <svg width="22" height="15" viewBox="0 0 22 15" fill="none" aria-hidden>
              <rect x="1" y="1" width="20" height="13" rx="3.4" fill="#fff" />
              <rect x="8.4" y="11" width="5.2" height="1.4" rx="0.7" fill="#111" />
            </svg>
            <span>登录 Campus</span>
          </button>

          <div className={`ls__agree ${warn ? 'is-warn' : ''}`}>
            <button
              className={`ls__check ${agreed ? 'is-on' : ''}`}
              onClick={() => setAgreed((v) => !v)}
              aria-label="同意协议"
            >
              {agreed && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4">
                  <path d="m5 12.5 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span className="ls__agreeText">
              我已阅读并同意<span className="login__link">《用户协议》</span>
              <span className="login__link">《隐私政策》</span>
              <span className="login__link">《未成年人个人信息保护规则》</span>
            </span>
          </div>
          {warn && <p className="ls__warn">请先阅读并同意相关协议</p>}
        </div>
      </div>
    </Screen>
  )
}
