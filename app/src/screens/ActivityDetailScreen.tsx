import { useEffect, useState } from 'react'
import { getActivity, type ApiActivity } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronRight, IconLocation } from '../components/icons'
import { goBack, navigate } from '../router'
import { StatusBadge, formatActivityTime } from './ActivitiesScreen'
import './activities.css'

/**
 * 活动详情（F06 / US-04）。
 *
 * 验收标准逐条落点：
 *   ① 「活动列表和详情中的标题、时间、地点、来源及状态一致」
 *      ⇒ 本页与列表页**渲染同一组字段**（并且用同一个 StatusBadge 与时间格式化函数）。
 *        这一点是刻意做的：如果详情页自己写一套格式化，两边迟早会不一致。
 *   ② 「可从活动详情进入正确的举办地点」
 *      ⇒ 底部「查看地点」按服务端返回的 `place.id` 跳地点详情。
 *        ⚠️ 用 **id** 而不是地名文本 —— 地名可能重复/被改名，按文本跳会跳错地点。
 *   ③ 「缺少必要时间或地点时不能作为正式活动发布」
 *      ⇒ 这是**服务端**的约束（activities.place_id NOT NULL、starts_at NOT NULL，
 *        且 ends_at > starts_at 有 CHECK）。前端不重复实现该规则，只负责显示。
 *   ④ 「学生不能修改活动数据，首版没有报名和支付入口」
 *      ⇒ 本页**没有任何**编辑/报名/支付控件（有意为之，不是还没做）。
 */
export function ActivityDetailScreen({ id }: { id: string }) {
  const [act, setAct] = useState<ApiActivity | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [errText, setErrText] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!id) {
        setErrText('未指定活动（缺少 id 参数）')
        setPhase('error')
        return
      }
      setPhase('loading')
      const r = await getActivity(id)
      if (!alive) return
      if (r.ok) {
        setAct(r.value)
        setPhase('ready')
        return
      }
      // 404 = 这个活动确实不存在；其它失败 = 我们**不知道**是否存在（不许混为一谈）
      if (r.status === 404) {
        setPhase('not_found')
        return
      }
      setErrText(r.reason)
      setPhase('error')
    })()
    return () => {
      alive = false
    }
  }, [id])

  const header = (
    <TopBar
      left={
        <button className="iconbtn" onClick={() => goBack('activities')} aria-label="返回">
          <IconBack size={22} />
        </button>
      }
    />
  )

  if (phase === 'loading') {
    return (
      <Screen header={header}>
        <p className="acts__state">加载中…</p>
      </Screen>
    )
  }

  if (phase === 'not_found') {
    return (
      <Screen header={header}>
        <div className="acts__state" data-act-phase="not_found">
          <p>活动不存在（可能已下架）</p>
          <button className="acts__retry" onClick={() => navigate('activities')}>
            返回活动列表
          </button>
        </div>
      </Screen>
    )
  }

  if (phase === 'error' || !act) {
    return (
      <Screen header={header}>
        <div className="acts__state" data-act-phase="error">
          <p>活动加载失败</p>
          <p className="acts__state-sub">{errText}</p>
          <button className="acts__retry" onClick={() => navigate('activities')}>
            返回活动列表
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen header={header} scroll>
      <section className="actd" data-act-id={act.id} data-act-status={act.effectiveStatus}>
        <div className="actd__titleRow">
          <h2 className="actd__title">{act.title}</h2>
          <StatusBadge status={act.effectiveStatus} />
        </div>

        <dl className="actd__facts">
          <div className="actd__fact">
            <dt>时间</dt>
            <dd data-act-time>{formatActivityTime(act.startsAt, act.endsAt)}</dd>
          </div>
          <div className="actd__fact">
            <dt>地点</dt>
            <dd data-act-place={act.place.id}>{act.place.name}</dd>
          </div>
          <div className="actd__fact">
            <dt>来源</dt>
            <dd data-act-source>{act.source}</dd>
          </div>
        </dl>

        {act.description && <p className="actd__desc">{act.description}</p>}

        {/*
          已取消/已结束的**显式提示**：不能只靠徽标颜色。
          已取消与已结束是不同的后果（取消是人工覆盖，可能改期重发）。
        */}
        {act.effectiveStatus === 'cancelled' && (
          <p className="actd__notice actd__notice--cancelled" data-act-notice="cancelled">
            该活动已取消，请勿按原时间前往。
          </p>
        )}
        {act.effectiveStatus === 'ended' && (
          <p className="actd__notice" data-act-notice="ended">
            该活动已结束。
          </p>
        )}

        {/* ②：从活动详情进入**正确的**举办地点（按 place.id 跳，不按地名） */}
        <button
          className="actd__placeBtn"
          data-act-goto-place={act.place.id}
          onClick={() => navigate('poidetail', { id: act.place.id })}
        >
          <IconLocation size={16} />
          <span>查看地点</span>
          <IconChevronRight size={16} />
        </button>

        {/*
          ④：首版**没有**报名/支付/投稿入口。这里不是"忘了做"，
             而是需求 §3.2 明确：「活动由管理员录入，首版不提供报名、支付和学生投稿」。
             写出来是为了让后续维护者一眼看到这是有意的边界。
        */}
        <p className="actd__nofeature">首版不提供报名、支付入口。</p>
      </section>
    </Screen>
  )
}
