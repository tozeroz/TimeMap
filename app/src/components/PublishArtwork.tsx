/** 发布页专用的线性图标与底部校园小径装饰。 */
export function PublishIcon({ name, size = 24 }: {
  name: 'pin' | 'photo' | 'text' | 'sparkles' | 'replace' | 'trash' | 'check' | 'rotate' | 'more'
  size?: number
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'pin' && <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>}
    {name === 'photo' && <><rect x="3" y="3" width="17" height="17" rx="3" /><circle cx="8" cy="8" r="1.6" /><path d="m3 16 5-5 4 4 3-3 5 5" /><circle cx="19" cy="19" r="4" fill="var(--pub-paper, #faf8f3)" /><path d="M19 17v4m-2-2h4" /></>}
    {name === 'text' && <><path d="M5 6V3h14v3M12 3v18m-4 0h8" /></>}
    {name === 'sparkles' && <><path d="m13 3 2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5Z" /><path d="m4 2 .8 2.2L7 5l-2.2.8L4 8l-.8-2.2L1 5l2.2-.8Z" /></>}
    {name === 'replace' && <><path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5" /></>}
    {name === 'trash' && <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>}
    {name === 'check' && <path d="m4 12 5 5L20 6" />}
    {name === 'rotate' && <><path d="M19 8a7 7 0 1 0 1 7M19 3v5h-5" /></>}
    {name === 'more' && <g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></g>}
  </svg>
}

export function CampusTrail() {
  return <svg className="pub__trail" viewBox="0 0 350 42" fill="none" aria-hidden="true">
    <path d="M2 29C60-13 87 52 157 25S253 54 348 17" stroke="#b9cdaa" strokeWidth="1.2" strokeDasharray="5 4" />
    <circle cx="20" cy="20" r="4" fill="#f6a13d" />
    <g stroke="#94ad85" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M309 30c-1-13 3-21 12-25m-13 18c-8-1-12-5-12-11 8 0 12 5 12 11Zm1-6c1-8 5-12 13-13-1 8-5 12-13 13Z" />
      <path d="m298 14 8 7m14-14-9 8" />
    </g>
  </svg>
}
