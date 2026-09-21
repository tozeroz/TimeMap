import { useState } from 'react'
import { Screen } from '../components/Shell'
import { navigate } from '../router'
import './login.css'

/**
 * 登录入口（原版 CampusLoginActivity / campusx://login/select）。
 *
 * 1:1 依据（M3 Slice 0A 实测，见 docs/m3/SLICE0-LOGIN-SEMANTICS.md）：
 *   - 整页是品牌拼贴 + 居中「Campus」标识 + 底部黑色胶囊按钮「登录 Campus」
 *     （原版 id: cl_phone_login，内含手机图标 iv_phone + 文本 tv_phone）
 *   - 按钮下方是**未勾选的协议复选框**（原版 id: cb_agreement）
 *     +「我已阅读并同意《用户协议》《隐私政策》《未成年人个人信息保护规则》」
 *   - **未勾选就点「登录 Campus」时，原版不是禁用按钮、也不是闪一下提示，
 *     而是弹出一个模态弹窗**：
 *         请阅读并同意以下条款
 *         《用户协议》《隐私政策》《未成年人个人信息保护规则》
 *         [同意并继续]        ← 原版 id: btn_agree，位置贴近底部
 *     点「同意并继续」后既视为同意、也直接进入下一步（手机号页）。
 *
 * 这条行为是 M3 补采证据后修正的：此前实现成"提示 1.6 秒"，与原版不一致。
 */
export function LoginSelectScreen() {
  const [agreed, setAgreed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  function login() {
    if (!agreed) {
      setDialogOpen(true)
      return
    }
    navigate('login')
  }

  /** 原版行为：点「同意并继续」= 同意 + 继续进入手机号页 */
  function agreeAndContinue() {
    setAgreed(true)
    setDialogOpen(false)
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

          <div className="ls__agree">
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
        </div>
      </div>

      {/* 协议弹窗：与原版一致（未勾选点登录时出现，点「同意并继续」= 同意 + 进入下一步） */}
      {dialogOpen && (
        <div className="ls__dialogMask" onClick={() => setDialogOpen(false)}>
          <div className="ls__dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <p className="ls__dialogTitle">请阅读并同意以下条款</p>
            <p className="ls__dialogBody">
              <span className="login__link">《用户协议》</span>
              <span className="login__link">《隐私政策》</span>
              <span className="login__link">《未成年人个人信息保护规则》</span>
            </p>
            <button className="ls__dialogBtn" onClick={agreeAndContinue}>
              同意并继续
            </button>
          </div>
        </div>
      )}
    </Screen>
  )
}
