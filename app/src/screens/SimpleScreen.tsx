import type { ReactNode } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack } from '../router'

/** 通用二级页：标题 + 副标题 + 任意内容 */
export function SimpleScreen({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center={title}
        />
      }
      scroll
    >
      <div className="pagepad">
        {subtitle && <p className="para">{subtitle}</p>}
      </div>
      {children}
    </Screen>
  )
}
