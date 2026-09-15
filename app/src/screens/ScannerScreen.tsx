import { useEffect, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconImage } from '../components/icons'
import { scannerHints } from '../data/mock'
import { goBack, navigate } from '../router'
import './scanner.css'

/**
 * 扫码（对应原版 campusx://scanner）。
 * 纯本地 demo 没有摄像头，用取景框 + 扫描线动画还原交互观感，
 * 扫描几秒后「识别成功」，跳到对应的结果页。
 */
export function ScannerScreen() {
  const [hint, setHint] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const t1 = window.setInterval(() => setHint((i) => (i + 1) % scannerHints.length), 2200)
    const t2 = window.setTimeout(() => setDone(true), 5200)
    return () => {
      window.clearInterval(t1)
      window.clearTimeout(t2)
    }
  }, [])

  return (
    <Screen className="scan" scroll={false}>
      <TopBar
        variant="plain"
        left={
          <button className="iconbtn scan__btn" onClick={() => goBack('campus')} aria-label="关闭">
            <IconClose size={22} />
          </button>
        }
        right={
          <button className="iconbtn scan__btn" aria-label="相册">
            <IconImage size={20} />
          </button>
        }
      />

      <div className="scan__stage">
        <div className="scan__frame">
          <span className="scan__corner scan__corner--tl" />
          <span className="scan__corner scan__corner--tr" />
          <span className="scan__corner scan__corner--bl" />
          <span className="scan__corner scan__corner--br" />
          {!done && <span className="scan__line" />}
          {done && <span className="scan__ok">识别成功</span>}
        </div>

        <p className="scan__hint">{scannerHints[hint]}</p>
      </div>

      <div className="scan__foot">
        <button className="scan__result" onClick={() => navigate('onboarding')} disabled={!done}>
          {done ? '查看扫描结果' : '正在识别…'}
        </button>
        <p className="scan__tip">将二维码放入框内，即可自动识别</p>
      </div>
    </Screen>
  )
}
