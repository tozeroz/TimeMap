/** 活动入口图标（旗帜，线性风格与 icons.tsx 一致） */
export function IconFlag({ size = 22, strokeWidth = 1.8 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 21V4" />
      <path d="M5.5 5c2.2-1.6 4.4-1.6 6.6 0s4.4 1.6 6.6 0v8.2c-2.2 1.6-4.4 1.6-6.6 0s-4.4-1.6-6.6 0Z" />
    </svg>
  )
}
