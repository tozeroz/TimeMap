import { useState } from 'react'
import { Screen } from '../components/Shell'
import { campusInfo } from '../data/mock'
import { navigate } from '../router'
import './onboarding.css'

const STEPS = [
  { title: '选择你的学校', desc: '找到同校的同学，从校园广场开始' },
  { title: '填一个昵称', desc: '名字会显示在你的主页和动态上' },
  { title: '选几个兴趣标签', desc: '我们会按标签为你推荐内容' },
]

export function OnboardingScreen() {
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<string[]>([])

  const interests = ['摄影', '美食', '读书', '音乐', '运动', '旅行', '电影', '宠物']

  function toggle(t: string) {
    setPicked((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  const isLast = step === STEPS.length - 1

  return (
    <Screen className="ob" scroll={false}>
      <div className="ob__body">
        <div className="ob__dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`ob__dot ${i === step ? 'is-active' : ''}`} />
          ))}
        </div>

        <h1 className="ob__title">{STEPS[step].title}</h1>
        <p className="ob__desc">{STEPS[step].desc}</p>

        {step === 0 && (
          <div className="ob__school">
            <div className="ob__school-name">{campusInfo.name}</div>
            <div className="ob__school-meta">
              {campusInfo.region} · {campusInfo.members} 位同学
            </div>
            <span className="ob__picked">已选择</span>
          </div>
        )}

        {step === 1 && (
          <div className="ob__field">
            <input className="ob__input" defaultValue="自定义名称6" />
          </div>
        )}

        {step === 2 && (
          <div className="ob__chips">
            {interests.map((t) => (
              <button
                key={t}
                className={`ob__chip ${picked.includes(t) ? 'is-on' : ''}`}
                onClick={() => toggle(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ob__foot">
        <button
          className="ob__next"
          onClick={() => (isLast ? navigate('campus') : setStep((s) => s + 1))}
        >
          {isLast ? '进入校园' : '下一步'}
        </button>
        {!isLast && (
          <button className="ob__skip" onClick={() => navigate('campus')}>
            跳过
          </button>
        )}
      </div>
    </Screen>
  )
}
