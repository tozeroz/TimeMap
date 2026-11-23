/**
 * 首次注册用户引导 · 宿主组件。
 *
 * 挂载位置：`app/src/App.tsx` 的 `<Shell>` 内、`<TabBar />` 之后 —— 它要盖在所有页面之上，
 * 但又必须活在整个 App 生命周期里（跨路由导航不卸载），所以不做成某个页面的子组件。
 *
 * 状态机（`view`）：
 *   none    不显示（未登录 / 已完成 / 已跳过）
 *   resume  上次没走完：问一句「继续上次的新手引导？」
 *   welcome 欢迎卡（第 1 步，居中，无高亮）
 *   hint    正在给某一提示：遮罩 + 挖空高亮 + 提示卡
 *   paused  用户主动收起（或滚动页面时自动收起）：只留底部「继续引导」小条
 *   end     结束卡
 *
 * 交互原则（方案 §5.2）：
 *   · 高亮区域**可点**（挖洞不盖遮罩），提示卡可点；遮罩其余部分吞掉点击，
 *     避免用户在"看不清的暗区"里误触。
 *   · 用户要自由操作（滚动/拖动/输入）时先收起遮罩 —— 这里用「滚动/按 Esc 自动收起」
 *     与提示卡上的「稍后再说」两个出口实现，收起后底部保留小条可继续。
 *   · **不代填、不代提交**：资料与发帖只"指路"，绝不替用户点提交。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate, useRoute } from '../router'
import { getSession } from '../api/session'
import { GUIDE_HINT_TOTAL, GUIDE_STEPS, guideStepLabel, type GuideHint } from './steps'
import { clearGuide, readGuide, saveGuide, shouldResumeGuide, shouldStartGuide } from './progress'
import './guide.css'

type View = 'none' | 'resume' | 'welcome' | 'hint' | 'paused' | 'end'

const MASK_COLOR = 'rgba(8, 26, 44, 0.66)'
const HOLE_PADDING = 6
const TARGET_TIMEOUT_MS = 6000

export const GUIDE_RESTART_EVENT = 'timemap:guide-restart'

/** 「我的」里「重看新手引导」调用：清掉存档并重新从欢迎卡开始 */
export function restartGuide(): void {
  const userId = getSession()?.user?.id
  if (userId) clearGuide(userId)
  window.dispatchEvent(new CustomEvent(GUIDE_RESTART_EVENT))
}

export function GuideHost() {
  const route = useRoute()
  const [view, setView] = useState<View>('none')
  const [step, setStep] = useState(0)
  const [hintIndex, setHintIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [targetMissing, setTargetMissing] = useState(false)
  /**
   * 误触暗区时的提示语。首轮实测（体验报告 P1-2）：原来把「误触」实现成 busy=true 并
   * 禁用主按钮，可 busy 只在主按钮 onClick 里复位 —— 按钮已禁用，用户就永远点不回去，
   * 只能刷新页面。这里改成"提示一句、按钮照常可用"，1.8 秒后自动消失。
   */
  const [blockedMsg, setBlockedMsg] = useState('')
  useEffect(() => {
    if (!blockedMsg) return
    const timer = window.setTimeout(() => setBlockedMsg(''), 1800)
    return () => window.clearTimeout(timer)
  }, [blockedMsg])
  /**
   * 是否存在更高层级的阻断式模态（典型：地图的「授权地理位置」弹窗，z-index 700）。
   * 方案 §3.5：这类弹窗是**更高层级的模态**，引导必须先让位 —— 否则遮罩会盖住
   * 用户唯一能回答的那个问题（"给不给定位"），点哪儿都没反应。
   * 让位做法：整个引导暂时不渲染；模态关掉后自动恢复（状态都还在）。
   */
  const [blockedByModal, setBlockedByModal] = useState(false)

  const userId = getSession()?.user?.id ?? ''
  const hint: GuideHint | null = useMemo(() => {
    if (view !== 'hint') return null
    return GUIDE_STEPS[step]?.hints[hintIndex] ?? null
  }, [view, step, hintIndex])

  /* ---------- 触发：新账号 / 上次未完成 / 手动重看 ---------- */
  useEffect(() => {
    if (!userId) {
      setView('none')
      return
    }
    if (shouldStartGuide(userId)) {
      setStep(0)
      setHintIndex(0)
      setView('welcome')
      return
    }
    if (shouldResumeGuide(userId)) {
      const saved = readGuide(userId)
      setStep(saved?.step ?? 0)
      setHintIndex(saved?.hint ?? 0)
      setView('resume')
    }
  }, [userId])

  useEffect(() => {
    const onRestart = () => {
      if (!userId) return
      setStep(0)
      setHintIndex(0)
      setRect(null)
      setView('welcome')
      /*
        重看也要落盘：否则用户点完「重看」直接关掉网页，下次进来 shouldResumeGuide()
        因为存档还是 done 而判定「不用再引导」，重看就白点了。
      */
      saveGuide(userId, { status: 'pending', step: 0 })
    }
    window.addEventListener(GUIDE_RESTART_EVENT, onRestart)
    return () => window.removeEventListener(GUIDE_RESTART_EVENT, onRestart)
  }, [userId])

  /* ---------- 焦点：卡片一出现就把焦点送进主按钮 ----------
     否则键盘用户 Tab 会先在地图/列表里绕一圈，读屏也只听到页面其余内容；
     测例 G05（Tab 是否落到 data-guide-action 上）原本就是因此失败。 */
  useEffect(() => {
    if (view !== 'welcome' && view !== 'resume' && view !== 'hint' && view !== 'end') return
    const timer = window.setTimeout(() => {
      /*
        依赖里必须带 blockedByModal：地图首屏会先弹「授权地理位置」，引导先让位（返回 null）、
        弹窗关掉后再挂回来。挂回来时 view/step/hintIndex 都没变，若不带这个依赖，
        焦点就不会再送进去 —— 测例 G05 实测就是这个原因失败（Tab 前 activeElement 还是 BODY）。
      */
      const el = document.querySelector<HTMLButtonElement>(
        '[data-guide-card] .guide__primary:not([disabled])',
      )
      el?.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [blockedByModal, view, step, hintIndex])

  /* ---------- 推进 ---------- */
  const persist = useCallback(
    (nextStep: number, status: 'pending' | 'active' | 'done' | 'skipped', nextHint = 0) => {
      if (!userId) return
      saveGuide(userId, { status, step: nextStep, hint: nextHint })
    },
    [userId],
  )

  /** 误触暗区：只给一句反馈，绝不锁死主按钮（体验报告 P1-2） */
  const onBlocked = useCallback(() => setBlockedMsg('先完成高亮的那一步，再继续。'), [])

  const startFromWelcome = useCallback(() => {
    /*
      欢迎卡本身就是第 1 步（step 0 的唯一提示），点「开始」应当**进入第 2 步**，
      而不是重新渲染一遍欢迎卡 —— 否则用户会看到同一张卡连着弹两次。
    */
    persist(1, 'active')
    setView('hint')
    setStep(1)
    setHintIndex(0)
    if (route.path !== 'map') navigate('map')
  }, [persist, route.path])

  const advance = useCallback(() => {
    const current = GUIDE_STEPS[step]
    if (!current) {
      setView('end')
      return
    }
    if (hintIndex + 1 < current.hints.length) {
      setHintIndex(hintIndex + 1)
      persist(step, 'active', hintIndex + 1)
      return
    }
    if (step + 1 < GUIDE_STEPS.length) {
      const nextStep = step + 1
      setStep(nextStep)
      setHintIndex(0)
      persist(nextStep, 'active')
      return
    }
    persist(step, 'active')
    setView('end')
  }, [hintIndex, persist, step])

  const goBack = useCallback(() => {
    if (hintIndex > 0) {
      setHintIndex(hintIndex - 1)
      persist(step, 'active', hintIndex - 1)
      return
    }
    if (step > 0) {
      const prev = step - 1
      setHintIndex(Math.max(0, GUIDE_STEPS[prev].hints.length - 1))
      setStep(prev)
      /*
        第 2 步退回第 1 步 = 回到**欢迎卡**，而不是把「居中提示卡」甩到地图上：
        欢迎卡是 step 0 的唯一提示，但它渲染在 welcome 视图里；如果继续走 hint 视图，
        用户会看到一张没有高亮目标、还带着「下一步」的卡片，而地图首屏又立刻弹定位授权，
        引导整个被模态挡住 —— 实测（debug_behaviour）就是这样"消失"的。
      */
      if (prev === 0) {
        setRect(null)
        setTargetMissing(false)
        setView('welcome')
        persist(0, 'pending')
        return
      }
      persist(prev, 'active')
    }
  }, [hintIndex, navigate, persist, route.path, step])

  const finish = useCallback(
    (status: 'done' | 'skipped') => {
      persist(step, status)
      setView('none')
      setRect(null)
    },
    [persist, step],
  )

  /* ---------- 路由就位：提示要求的页面不是当前页时切过去 ---------- */
  useEffect(() => {
    if (view !== 'hint' || !hint) return
    const want = hint.route
    const gotQuery = Object.entries(want.query ?? {}).every(([k, v]) => route.query[k] === v)
    if (route.path === want.path && gotQuery) return
    const timer = window.setTimeout(() => {
      navigate(want.path, want.query)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [hint, route.path, route.query, view])

  /* ---------- 目标定位（页面可能异步渲染，所以轮询 + 跟随滚动） ---------- */
  useEffect(() => {
    if (view !== 'hint' || !hint) {
      setRect(null)
      setTargetMissing(false)
      return
    }
    if (!hint.targets.length) {
      setRect(null)
      setTargetMissing(false)
      return
    }
    let cancelled = false
    let element: HTMLElement | null = null
    let matchedSelector = ''
    let lastFoundAt = Date.now()

    /* 找到就记住"是哪个选择器命中的"，之后每次都要回头验证它 —— 页面换版后同一元素
       可能只是丢了属性（例如 data-me-entry 被移除），节点还在但不是我们要指的东西。 */
    const locate = (): boolean => {
      for (const selector of hint.targets) {
        try {
          const next = document.querySelector<HTMLElement>(selector)
          if (next) {
            element = next
            matchedSelector = selector
            lastFoundAt = Date.now()
            return true
          }
        } catch {
          /* 忽略非法选择器 */
        }
      }
      element = null
      matchedSelector = ''
      return false
    }

    const sync = () => {
      if (cancelled) return
      const valid =
        element !== null &&
        element.isConnected &&
        matchedSelector !== '' &&
        element.matches(matchedSelector)
      if (!valid && !locate()) {
        setRect(null)
        /*
          目标消失多久算"没有"：立刻报降级会让异步渲染的页面闪一下，
          所以给 TARGET_TIMEOUT_MS 的宽限；超过就告诉用户"这个入口这次没出现，
          可以先跳过" —— 比把高亮框留在原地/卡片乱飘更诚实。
        */
        if (Date.now() - lastFoundAt > TARGET_TIMEOUT_MS) setTargetMissing(true)
        return
      }
      const probe = element!.getBoundingClientRect()
      const vh = window.innerHeight
      /*
        目标可能比视口还高（首轮实测：发帖页正文框 390×944 > 844 的视口），
        直接按元素矩形画 ring，框会有一大半在屏幕外、页面几乎不压暗。
        先把它滚到视口中部，再把高亮框夹进可视区域。
      */
      if (probe.height > vh * 0.62 || probe.top < 8 || probe.bottom > vh - 8) {
        element!.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
      }
      const next = element!.getBoundingClientRect()
      const hidden = next.width === 0 && next.height === 0
      if (hidden) {
        setRect(null)
        setTargetMissing(true)
        return
      }
      const pad = 12
      const top = Math.max(pad, Math.min(next.top, vh - 140))
      const bottom = Math.min(vh - pad, Math.max(next.bottom, top + 72))
      setRect(new DOMRect(next.left, top, next.width, bottom - top))
      setTargetMissing(false)
    }

    /* 400ms 轮询而不是"找到就停"：SPA 里锚点随时可能被重渲染掉，
       一次性定位会让高亮框停在旧位置（实测把 data-me-entry 删掉后框还在原处）。 */
    const timer = window.setInterval(sync, 400)
    sync()

    const onLayout = () => sync()
    window.addEventListener('scroll', onLayout, true)
    window.addEventListener('resize', onLayout)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('scroll', onLayout, true)
      window.removeEventListener('resize', onLayout)
    }
  }, [hint, view])

  /* ---------- 用户点了高亮目标 → 推进 ---------- */
  useEffect(() => {
    if (view !== 'hint' || !hint?.advanceOnTarget) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      for (const selector of hint.targets) {
        try {
          if (target.closest(selector)) {
            window.setTimeout(() => advance(), 220)
            return
          }
        } catch {
          /* 忽略非法选择器 */
        }
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [advance, hint, view])

  /* ---------- 滚动页面 = 用户想自由操作 → 自动收起遮罩 ---------- */
  useEffect(() => {
    if (view !== 'hint') return
    let lastY = window.scrollY
    const onScroll = () => {
      if (Math.abs(window.scrollY - lastY) < 40) return
      lastY = window.scrollY
      setView('paused')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [view])

  useEffect(() => {
    if (view !== 'hint' && view !== 'resume' && view !== 'welcome' && view !== 'end' && view !== 'paused') {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      /* paused 下按 Esc 应该"放弃本次引导"而不是什么都不做（P3-5）。 */
      if (view === 'hint') setView('paused')
      else finish('skipped')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [finish, view])

  useEffect(() => {
    const sync = () => setBlockedByModal(document.querySelector('[data-blocking-modal]') !== null)
    sync()
    const timer = window.setInterval(sync, 300)
    return () => window.clearInterval(timer)
  }, [view])

  if (view === 'none' || !userId) return null
  if (blockedByModal) return null

  const stepMeta = GUIDE_STEPS[step]
  const hintNo =
    GUIDE_STEPS.slice(1, step).reduce((sum, item) => sum + item.hints.length, 0) + hintIndex + 1

  return (
    <div className="guide" data-guide-view={view} data-guide-step={step} data-guide-hint={hintIndex}>
      {/*
        只有"居中卡片"类视图才需要全屏遮罩。hint 态再铺一层 mask 会有两个问题
        （子代理体验报告 P1-1 / P2-2）：① mask 盖在洞上方，高亮区域里的按钮点不动；
        ② mask 与 panel 两层半透明叠加，洞内只剩 34% 亮度，看不清内容。
        洞外的点击拦截交给 4 块 panel，已经足够。
      */}
      {(view === 'welcome' || view === 'end' || view === 'resume') && (
        <div className="guide__mask" aria-hidden="true" />
      )}
      {view === 'hint' && rect && <FocusFrame rect={rect} />}

      {view === 'hint' && rect && (
        <>
          <MaskPanel rect={rect} edge="top" onBlocked={onBlocked} />
          <MaskPanel rect={rect} edge="bottom" onBlocked={onBlocked} />
          <MaskPanel rect={rect} edge="left" onBlocked={onBlocked} />
          <MaskPanel rect={rect} edge="right" onBlocked={onBlocked} />
        </>
      )}

      {view === 'resume' && (
        <Card centered title="继续上次的新手引导？" body={`上次停在「${GUIDE_STEPS[step]?.label ?? '欢迎'}」。`}>
          <button className="guide__primary" data-guide-action="resume" onClick={() => setView('hint')}>
            继续
          </button>
          <button className="guide__ghost" data-guide-action="skip" onClick={() => finish('skipped')}>
            不再显示
          </button>
        </Card>
      )}

      {view === 'welcome' && (
        <Card
          centered
          title="欢迎来到 TimeMap"
          body="这是北交大的校园记忆地图。一分钟看完主要功能，随时可以跳过。"
          foot={`${guideStepLabel(0)} · 共 ${GUIDE_HINT_TOTAL} 个提示`}
        >
          <button className="guide__primary" data-guide-action="start" onClick={startFromWelcome}>
            开始认识 TimeMap
          </button>
          <button className="guide__ghost" data-guide-action="skip" onClick={() => finish('skipped')}>
            暂时跳过
          </button>
        </Card>
      )}

      {view === 'hint' && hint && (
        <Card
          anchor={rect}
          placement={hint.placement}
          title={hint.title}
          body={hint.body}
          foot={
            blockedMsg ||
            `${stepMeta?.label ?? ''} · ${guideStepLabel(step)}${hintNo > 0 ? ` · 提示 ${hintNo}/${GUIDE_HINT_TOTAL}` : ''}`
          }
          missingTarget={targetMissing}
        >
          <button className="guide__primary" data-guide-action="next" onClick={() => { setBlockedMsg(''); advance() }}>
            {hint.primary ?? '下一步'}
          </button>
          <button className="guide__ghost" data-guide-action="back" onClick={goBack} disabled={step === 0 && hintIndex === 0}>
            上一步
          </button>
          <button className="guide__ghost" data-guide-action="pause" onClick={() => setView('paused')}>
            稍后再说
          </button>
          {/* 目标没出现时的"可以先跳过"必须是真能点的：只写一句提示、没有按钮，等于把用户困住 */}
          {targetMissing && (
            <button className="guide__ghost" data-guide-action="skip" onClick={() => finish('skipped')}>
              跳过引导
            </button>
          )}
        </Card>
      )}

      {view === 'end' && (
        <Card centered title="已经认识主要功能了" body="资料、发帖、活动和实训项目都能在对应页面找到。想再看一遍，可以在「我的 → 重看新手引导」里打开。">
          <button className="guide__primary" data-guide-action="done" onClick={() => finish('done')}>
            开始使用 TimeMap
          </button>
        </Card>
      )}

      {view === 'paused' && (
        <button className="guide__resume" data-guide-action="resume" onClick={() => setView('hint')}>
          继续新手引导 · {guideStepLabel(step)}
        </button>
      )}
    </div>
  )
}

function MaskPanel({ rect, edge, onBlocked }: { rect: DOMRect; edge: 'top' | 'bottom' | 'left' | 'right'; onBlocked: () => void }) {
  const top = Math.max(0, rect.top - HOLE_PADDING)
  const left = Math.max(0, rect.left - HOLE_PADDING)
  const right = Math.min(window.innerWidth, rect.right + HOLE_PADDING)
  const bottom = Math.min(window.innerHeight, rect.bottom + HOLE_PADDING)
  const style: React.CSSProperties =
    edge === 'top'
      ? { left: 0, top: 0, width: '100%', height: top }
      : edge === 'bottom'
        ? { left: 0, top: bottom, width: '100%', height: Math.max(0, window.innerHeight - bottom) }
        : edge === 'left'
          ? { left: 0, top, width: left, height: bottom - top }
          : { left: right, top, width: Math.max(0, window.innerWidth - right), height: bottom - top }
  return <div className="guide__panel" style={{ ...style, background: MASK_COLOR }} onClick={onBlocked} aria-hidden="true" />
}

function FocusFrame({ rect }: { rect: DOMRect }) {
  return (
    <div
      className="guide__ring"
      aria-hidden="true"
      style={{
        left: rect.left - HOLE_PADDING,
        top: rect.top - HOLE_PADDING,
        width: rect.width + HOLE_PADDING * 2,
        height: rect.height + HOLE_PADDING * 2,
      }}
    />
  )
}

function Card(props: {
  title: string
  body: string
  foot?: string
  children: React.ReactNode
  anchor?: DOMRect | null
  placement?: 'top' | 'bottom'
  centered?: boolean
  missingTarget?: boolean
}) {
  const { title, body, foot, children, anchor, placement = 'bottom', centered, missingTarget } = props
  const cardRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [measured, setMeasured] = useState(false)

  useEffect(() => {
    const node = cardRef.current
    if (!node) return
    const height = node.offsetHeight
    const width = Math.min(node.offsetWidth, window.innerWidth - 24)
    if (centered || !anchor) {
      setStyle({ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width })
      setMeasured(true)
      return
    }
    const margin = 12
    const spaceBelow = window.innerHeight - anchor.bottom
    const wantTop = placement === 'top' || spaceBelow < height + margin * 2
    const top = wantTop ? Math.max(margin, anchor.top - height - margin) : Math.min(window.innerHeight - height - margin, anchor.bottom + margin)
    const left = Math.min(Math.max(margin, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - margin)
    setStyle({ left, top, width })
    setMeasured(true)
  }, [anchor, centered, placement, title, body])

  return (
    <div
      className={measured ? 'guide__card is-measured' : 'guide__card'}
      ref={cardRef}
      style={style}
      role="dialog"
      aria-live="polite"
      aria-label={title}
      data-guide-card
    >
      <h2 className="guide__title">{title}</h2>
      <p className="guide__body">{body}</p>
      {missingTarget && <p className="guide__missing" role="status">这一步的入口暂时没显示出来，可以先跳过。</p>}
      <div className="guide__actions">{children}</div>
      {foot && <p className="guide__foot">{foot}</p>}
    </div>
  )
}
