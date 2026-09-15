import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './onboarding.css'

/**
 * 新手引导（原版 CampusOnBoardingActivity）。
 * 按原版实测：左上返回；标题「告诉大家，怎么称呼你？」；
 * 输入框提示语「你是...」；底部按钮「就这样」。
 */
export function OnboardingScreen() {
  const [name, setName] = useState('')

  function done() {
    navigate('campus')
  }

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('login')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
        />
      }
      scroll
    >
      <div className="ob">
        <h1 className="ob__title">告诉大家，怎么称呼你？</h1>
        <div className="ob__field">
          <input
            className="ob__input"
            placeholder="你是..."
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <p className="ob__tip">昵称会显示在你的主页和动态上，之后可以随时修改</p>
      </div>

      <div className="ob__foot">
        <button className="ob__next" onClick={done}>
          就这样
        </button>
      </div>
    </Screen>
  )
}
