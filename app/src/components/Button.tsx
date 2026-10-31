import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './button.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'text' | 'danger'
  size?: 'regular' | 'compact'
  loading?: boolean
  icon?: ReactNode
}

/** loading 保留原标签占位，避免按钮宽度随状态跳变。 */
export function Button({
  variant = 'primary', size = 'regular', loading = false, icon,
  disabled, className = '', children, type = 'button', ...props
}: ButtonProps) {
  return <button {...props} type={type}
    className={`ui-button ui-button--${variant} ui-button--${size} ${className}`}
    disabled={disabled || loading} aria-busy={loading || undefined}>
    <span className="ui-button__content" style={loading ? { opacity: 0 } : undefined}>
      {icon && <span className="ui-button__icon" aria-hidden="true">{icon}</span>}{children}
    </span>
    {loading && <span className="ui-button__loading" role="status"><span className="ui-button__spinner" aria-hidden="true" /><span className="ui-sr-only">正在处理，请稍候</span></span>}
  </button>
}
